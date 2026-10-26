import { NextResponse } from "next/server";
import { getD1, getMaterialsBucket } from "@/lib/server/cloudflare";
import { errorResponse, HttpError, requirePermission } from "@/lib/server/authz";
import { validateMaterialUpload } from "@/lib/material-file-policy";

type Context = { params: Promise<{ id: string }> };
export async function PUT(request: Request, context: Context) {
  try {
    const profile = await requirePermission(request, "materials:manage");
    await requirePermission(request, "r2:manage");
    const { id } = await context.params;
    const db = await getD1();
    const record = await db.prepare("SELECT id, r2_key, provider, file_name FROM materials WHERE id = ?")
      .bind(id).first<{ id: string; r2_key: string | null; provider: string; file_name: string | null }>();
    if (!record?.r2_key || record.provider !== "r2") throw new HttpError(404, "Recurso R2 no encontrado.");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Selecciona un archivo.");
    const validated = validateMaterialUpload({ fileName: file.name, contentType: file.type, size: file.size });
    if (!validated.ok) throw new HttpError(400, validated.error);
    // Require the same extension to avoid a misleading existing R2 key.
    const extension = (name: string) => name.trim().split(".").at(-1)?.toLowerCase() ?? "";
    if (extension(file.name) !== extension(record.r2_key)) {
      throw new HttpError(400, "El reemplazo debe conservar la extensión original. Para otro formato, sube un recurso nuevo.");
    }
    const bucket = await getMaterialsBucket();
    // An overwrite preserves the R2 key and task links.
    await bucket.put(record.r2_key, await file.arrayBuffer(),
      { httpMetadata: { contentType: validated.contentType } });
    const now = new Date().toISOString();
    await db.batch([
      db.prepare("UPDATE materials SET file_name = ?, content_type = ?, size_bytes = ?, r2_missing_at = NULL, updated_at = ? WHERE id = ?")
        .bind(file.name, validated.contentType, file.size, now, id),
      db.prepare("INSERT INTO audit_log (id, actor_id, action, entity, entity_id, before_data, after_data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), profile.id, "material.file_replaced", "materials", id,
          JSON.stringify({ fileName: record.file_name }), JSON.stringify({ fileName: file.name, bytes: file.size }), now),
    ]);
    return NextResponse.json({ ok: true, size: file.size });
  } catch (error) { return errorResponse(error); }
}
