import { requireProfile, errorResponse, HttpError } from "@/lib/server/authz";
import { fetchTaskImage, isR2ImageId } from "@/lib/server/task-image-r2";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    await requireProfile(request);
    const { id } = await context.params;
    if (!isR2ImageId(id)) throw new HttpError(404, "Imagen no encontrada.");
    const object = await fetchTaskImage(id);
    if (!object?.body) throw new HttpError(404, "Imagen no encontrada.");
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    const contentType = headers.get("content-type") || "application/octet-stream";
    if (!["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"].includes(contentType)) {
      throw new HttpError(415, "Formato de imagen no admitido.");
    }
    return new Response(object.body, { headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    } });
  } catch (error) {
    return errorResponse(error);
  }
}
