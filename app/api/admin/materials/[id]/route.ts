import { NextResponse } from "next/server";
import { z } from "zod";
import { getD1, getMaterialsBucket } from "@/lib/server/cloudflare";
import { d1First } from "@/lib/server/d1-data";
import { HttpError, errorResponse, requirePermission } from "@/lib/server/authz";

type Context = { params: Promise<{ id: string }> };
type Row = { id: string; title: string; provider: string | null; r2_key: string | null; section_id: string | null; visibility: string };
const editSchema = z.object({
  title: z.string().trim().min(1).max(240),
  sectionId: z.string().uuid().nullable(),
  visibility: z.enum(["visible", "hidden"]),
}).strict();
const deleteSchema = z.object({
  scope: z.literal("r2-and-d1"),
  confirm: z.literal("ELIMINAR_RECURSO"),
}).strict();

async function readMaterial(id: string) {
  const row = await d1First<Row>(
    "SELECT id,title,provider,r2_key,section_id,visibility FROM materials WHERE id = ? LIMIT 1", [id],
  );
  if (!row) throw new HttpError(404, "Material no encontrado.");
  return row;
}
export async function PATCH(request: Request, context: Context) {
  try {
    const profile = await requirePermission(request, "materials:manage");
    const { id } = await context.params;
    const input = editSchema.parse(await request.json());
    const original = await readMaterial(id);
    const db = await getD1();
    if (input.sectionId) {
      const section = await db.prepare("SELECT id FROM material_sections WHERE id = ? AND active = 1")
        .bind(input.sectionId).first();
      if (!section) throw new HttpError(400, "Sección no válida.");
    }
    const now = new Date().toISOString();
    await db.batch([
      db.prepare("UPDATE materials SET title = ?, section_id = ?, visibility = ?, updated_at = ? WHERE id = ?")
        .bind(input.title, input.sectionId, input.visibility, now, id),
      db.prepare("INSERT INTO audit_log (id, actor_id, action, entity, entity_id, before_data, after_data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), profile.id, "material.updated", "materials", id,
          JSON.stringify({ title: original.title, sectionId: original.section_id, visibility: original.visibility }),
          JSON.stringify(input), now),
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    const profile = await requirePermission(request, "materials:manage");
    await requirePermission(request, "r2:manage");
    const { id } = await context.params;
    const input = deleteSchema.parse(await request.json());
    const original = await readMaterial(id);
    if (!original.r2_key || original.provider !== "r2" || input.scope !== "r2-and-d1") {
      throw new HttpError(409, "La eliminación conjunta solo está disponible para objetos R2 indexados.");
    }
    const db = await getD1();
    const references = await db.prepare("SELECT COUNT(*) AS total FROM task_materials WHERE material_id = ?")
      .bind(id).first<{ total: number }>();
    const bucket = await getMaterialsBucket();
    // Delete from the authoritative bucket FIRST; never delete just the D1 index,
    // since reconciliation would import the object again.
    await bucket.delete(original.r2_key);
    const now = new Date().toISOString();
    await db.batch([
      db.prepare("DELETE FROM task_materials WHERE material_id = ?").bind(id),
      db.prepare("DELETE FROM materials WHERE id = ?").bind(id),
      db.prepare("INSERT INTO audit_log (id, actor_id, action, entity, entity_id, before_data, after_data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), profile.id, "material.deleted.r2_and_d1", "materials", id,
          JSON.stringify({ title: original.title, linkedTasks: references?.total ?? 0 }), JSON.stringify({ scope: input.scope }), now),
    ]);
    return NextResponse.json({ ok: true, unlinkedTasks: references?.total ?? 0 });
  } catch (error) { return errorResponse(error); }
}
