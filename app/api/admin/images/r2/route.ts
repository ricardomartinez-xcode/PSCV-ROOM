import { NextResponse } from "next/server";
import { errorResponse, HttpError, requirePermission } from "@/lib/server/authz";
import { saveTaskImage } from "@/lib/server/task-image-r2";

export async function POST(request: Request) {
  try {
    const data = await request.formData();
    const category = data.get("category");
    if (category !== "task" && category !== "event" && category !== "announcement") {
      throw new HttpError(400, "Categoría de imagen inválida.");
    }
    await requirePermission(request, category === "announcement" ? "notifications:manage" : "tasks:edit");
    const file = data.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Selecciona una imagen válida.");
    const stored = await saveTaskImage(file);
    const image = { ...stored, url: new URL(stored.url, request.url).toString() };
    return NextResponse.json({ ok: true, image }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
