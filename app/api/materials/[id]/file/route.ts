import { NextResponse } from "next/server";
import { errorResponse, requireProfile, type ServerProfile } from "@/lib/server/authz";
import { getNativeR2Object, resolveNativeR2ObjectKey } from "@/lib/server/r2-native";
import { d1First, d1Run } from "@/lib/server/d1-data";

const isDebug = process.env.R2_DEBUG === "1";

type RouteContext = { params: Promise<{ id: string }> };

type MaterialFileRow = {
  id: string;
  title: string;
  provider: string | null;
  r2_key: string | null;
  file_name: string | null;
  content_type: string | null;
  visibility: string | null;
};

const INLINE_PREVIEW_TYPES = new Set([
  "application/pdf",
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function canReadHiddenMaterial(profile: ServerProfile) {
  return profile.role === "owner"
    || (profile.role === "admin" && (profile.can_manage_materials === 1 || profile.can_manage_r2 === 1));
}

function canPreviewInline(contentType: string) {
  return INLINE_PREVIEW_TYPES.has(contentType.split(";", 1)[0].trim().toLowerCase());
}

function wantsHtmlFallback(request: Request) {
  const accept = request.headers.get("accept") ?? "";
  const destination = request.headers.get("sec-fetch-dest") ?? "";
  return destination === "iframe" || destination === "document" || accept.includes("text/html");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function unavailableFileResponse(request: Request, message: string, status = 404) {
  if (!wantsHtmlFallback(request)) return NextResponse.json({ error: message }, { status });

  const safeMessage = escapeHtml(message);

  return new NextResponse(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f8fafc;color:#0f172a;display:grid;place-items:center;min-height:100vh;padding:18px;box-sizing:border-box}.box{max-width:420px;border:1px solid #d8e0ea;background:#fff;border-radius:12px;padding:16px;box-shadow:0 14px 30px rgba(15,23,42,.08)}strong{display:block;margin-bottom:6px}p{margin:0;color:#64748b;font-size:14px;line-height:1.45}</style></head><body><div class="box"><strong>Preview no disponible</strong><p>${safeMessage}</p></div></body></html>`,
    {
      status,
      headers: {
        "cache-control": "private, no-store",
        "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'",
        "content-type": "text/html; charset=utf-8",
        "cross-origin-resource-policy": "same-origin",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const profile = await requireProfile(request);
    const { id } = await context.params;
    const requestUrl = new URL(request.url);
    const mode = requestUrl.searchParams.get("mode") === "download" ? "download" : "preview";

    const data = await d1First<MaterialFileRow>(
      "SELECT id, title, provider, r2_key, file_name, content_type, visibility FROM materials WHERE id = ? LIMIT 1",
      [id],
    );
    if (!data || (data.visibility !== "visible" && !canReadHiddenMaterial(profile))) {
      return unavailableFileResponse(request, "Material no encontrado.", 404);
    }
    if (!data.r2_key) return unavailableFileResponse(request, "Este material no tiene asset R2 asociado.", 404);

    let resolvedKey = data.r2_key;
    try {
      resolvedKey = await resolveNativeR2ObjectKey({ key: data.r2_key, fileName: data.file_name, title: data.title });

      if (resolvedKey !== data.r2_key) {
        await d1Run(
          "UPDATE materials SET r2_key = ?, updated_at = ? WHERE id = ?",
          [resolvedKey, new Date().toISOString(), data.id],
        );
      }

      const object = await getNativeR2Object(resolvedKey);
      if (!object?.body) return unavailableFileResponse(request, "Objeto R2 no encontrado.", 404);

      const headers = new Headers();
      object.writeHttpMetadata(headers);
      const contentType = headers.get("content-type") || data.content_type || "application/octet-stream";
      if (mode === "preview" && !canPreviewInline(contentType)) {
        return unavailableFileResponse(
          request,
          "Este formato no admite una vista previa segura. Usa Descargar para abrirlo en tu dispositivo.",
          415,
        );
      }

      headers.set("cache-control", "private, no-store");
      headers.set("content-disposition", `${mode === "download" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(data.file_name || data.title || "material")}`);
      headers.set("content-security-policy", "sandbox; default-src 'none'; frame-ancestors 'self'");
      headers.set("content-type", contentType);
      headers.set("cross-origin-resource-policy", "same-origin");
      headers.set("etag", object.httpEtag);
      headers.set("x-content-type-options", "nosniff");
      return new Response(object.body, { headers });
    } catch (readError) {
      if (isDebug && canReadHiddenMaterial(profile)) {
        return NextResponse.json(
          {
            error: readError instanceof Error ? readError.message : "No se pudo resolver el objeto R2.",
            materialId: data.id,
            r2Key: data.r2_key,
            fileName: data.file_name,
            title: data.title,
          },
          { status: 404 },
        );
      }
      return unavailableFileResponse(
        request,
        "El archivo no está disponible temporalmente. Inténtalo de nuevo o avisa a un administrador.",
        404,
      );
    }
  } catch (error) {
    return errorResponse(error);
  }
}
