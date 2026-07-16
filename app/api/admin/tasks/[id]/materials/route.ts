import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError, requirePermission } from "@/lib/server/authz";
import { getD1 } from "@/lib/server/cloudflare";
import { d1All, d1First } from "@/lib/server/d1-data";
import {
  diffTaskMaterialIds,
  taskRejectsBucketMaterials,
  uniqueMaterialIds,
} from "@/lib/server/task-material-links";

const materialIdSchema = z.string().trim().min(1);

const materialLinkSchema = z.object({
  materialId: materialIdSchema.optional(),
  materialIds: z.array(materialIdSchema).min(1).max(50).optional(),
}).superRefine((value, ctx) => {
  if (!value.materialId && !value.materialIds?.length) {
    ctx.addIssue({ code: "custom", message: "Se requiere al menos un material." });
  }
});

const materialSetSchema = z.object({
  materialIds: z.array(materialIdSchema).max(50),
});

type RouteContext = { params: Promise<{ id: string }> };
type MaterialLinkPayload = z.infer<typeof materialLinkSchema>;
type TaskKindRow = {
  id: string;
  item_kind: string | null;
  task_type_name: string | null;
};

async function parsePayload<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.infer<T>> {
  const body = await request.json().catch(() => {
    throw new HttpError(400, "El cuerpo JSON no es válido.");
  });
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(400, result.error.issues[0]?.message ?? "Payload de materiales inválido.");
  }
  return result.data;
}

function materialIdsFromPayload(payload: MaterialLinkPayload) {
  return uniqueMaterialIds(payload.materialIds ?? (payload.materialId ? [payload.materialId] : []));
}

async function requireMaterialCompatibleTask(taskId: string, allowEmptyCleanup = false) {
  const task = await d1First<TaskKindRow>(
    `SELECT t.id, t.item_kind, tt.name AS task_type_name
     FROM tasks t
     LEFT JOIN task_types tt ON tt.id = t.task_type_id
     WHERE t.id = ?
     LIMIT 1`,
    [taskId],
  );
  if (!task) throw new HttpError(404, "Actividad no encontrada.");
  if (!allowEmptyCleanup && taskRejectsBucketMaterials(task.item_kind, task.task_type_name)) {
    throw new HttpError(409, "Los eventos no admiten materiales del bucket.");
  }
  return task;
}

async function requireExistingMaterials(materialIds: string[]) {
  if (!materialIds.length) return;
  const rows = await d1All<{ id: string }>(
    `SELECT id FROM materials
     WHERE visibility = 'visible'
       AND id IN (${materialIds.map(() => "?").join(",")})`,
    materialIds,
  );
  const existing = new Set(rows.map((row) => row.id));
  const missing = materialIds.filter((id) => !existing.has(id));
  if (missing.length) {
    throw new HttpError(400, `Material no encontrado: ${missing.join(", ")}`);
  }
}

async function currentMaterialIds(taskId: string) {
  const rows = await d1All<{ material_id: string }>(
    "SELECT material_id FROM task_materials WHERE task_id = ? ORDER BY material_id",
    [taskId],
  );
  return rows.map((row) => row.material_id);
}

function serializeMaterial(row: Record<string, unknown>) {
  if (!row.r2_key) return row;
  const id = encodeURIComponent(String(row.id));
  const previewUrl = `/api/materials/${id}/file?mode=preview`;
  const downloadUrl = `/api/materials/${id}/file?mode=download`;
  return {
    ...row,
    r2_key: "protected",
    public_url: downloadUrl,
    preview_url: previewUrl,
    source_url: downloadUrl,
    download_url: downloadUrl,
  };
}

async function linkedMaterials(taskId: string) {
  const rows = await d1All<Record<string, unknown>>(
    `SELECT m.*
     FROM task_materials tm
     JOIN materials m ON m.id = tm.material_id
     WHERE tm.task_id = ?
       AND m.visibility = 'visible'
     ORDER BY m.title ASC`,
    [taskId],
  );
  return rows.map((row) => ({ materials: serializeMaterial(row) }));
}

function auditStatement(
  db: D1Database,
  actorId: string,
  action: string,
  taskId: string,
  materialId: string,
  before: boolean,
) {
  return db.prepare(
    `INSERT INTO audit_log (id, actor_id, action, entity, entity_id, before_data, after_data)
     VALUES (?, ?, ?, 'task_materials', ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    actorId,
    action,
    `${taskId}:${materialId}`,
    before ? JSON.stringify({ task_id: taskId, material_id: materialId }) : null,
    before ? null : JSON.stringify({ task_id: taskId, material_id: materialId }),
  );
}

async function addTaskMaterials(taskId: string, materialIds: string[], actorId: string) {
  const current = new Set(await currentMaterialIds(taskId));
  const toAdd = materialIds.filter((materialId) => !current.has(materialId));
  if (!toAdd.length) return toAdd;

  const db = await getD1();
  await db.batch(toAdd.flatMap((materialId) => [
    db.prepare(
      `INSERT INTO task_materials (task_id, material_id) VALUES (?, ?)
       ON CONFLICT (task_id, material_id) DO NOTHING`,
    ).bind(taskId, materialId),
    auditStatement(db, actorId, "task.material.link", taskId, materialId, false),
  ]));
  return toAdd;
}

async function removeTaskMaterials(taskId: string, materialIds: string[], actorId: string) {
  const current = new Set(await currentMaterialIds(taskId));
  const toRemove = materialIds.filter((materialId) => current.has(materialId));
  if (!toRemove.length) return toRemove;

  const db = await getD1();
  await db.batch(toRemove.flatMap((materialId) => [
    db.prepare("DELETE FROM task_materials WHERE task_id = ? AND material_id = ?").bind(taskId, materialId),
    auditStatement(db, actorId, "task.material.unlink", taskId, materialId, true),
  ]));
  return toRemove;
}

async function replaceTaskMaterials(taskId: string, materialIds: string[], actorId: string) {
  const currentIds = await currentMaterialIds(taskId);
  const { toAdd, toRemove, changed } = diffTaskMaterialIds(currentIds, materialIds);

  if (changed) {
    const db = await getD1();
    const statements: D1PreparedStatement[] = [
      db.prepare("DELETE FROM task_materials WHERE task_id = ?").bind(taskId),
      ...materialIds.map((materialId) => db.prepare(
        "INSERT INTO task_materials (task_id, material_id) VALUES (?, ?)",
      ).bind(taskId, materialId)),
      ...toRemove.map((materialId) => auditStatement(
        db,
        actorId,
        "task.material.unlink",
        taskId,
        materialId,
        true,
      )),
      ...toAdd.map((materialId) => auditStatement(
        db,
        actorId,
        "task.material.link",
        taskId,
        materialId,
        false,
      )),
    ];
    await db.batch(statements);
  }

  return { added: toAdd.length, removed: toRemove.length };
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await requirePermission(request, "tasks:edit");
    return NextResponse.json({ ok: true, materials: await linkedMaterials(id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const profile = await requirePermission(request, "tasks:edit");
    const payload = await parsePayload(request, materialLinkSchema);
    const materialIds = materialIdsFromPayload(payload);
    await requireMaterialCompatibleTask(id);
    await requireExistingMaterials(materialIds);
    const added = await addTaskMaterials(id, materialIds, profile.id);

    return NextResponse.json({
      ok: true,
      linked: added.length,
      materials: await linkedMaterials(id),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const profile = await requirePermission(request, "tasks:edit");
    const payload = await parsePayload(request, materialSetSchema);
    const materialIds = uniqueMaterialIds(payload.materialIds);
    // Empty replacement is a cleanup operation, including for legacy events
    // that may already have links. Non-empty event sets remain forbidden.
    await requireMaterialCompatibleTask(id, materialIds.length === 0);
    await requireExistingMaterials(materialIds);
    const result = await replaceTaskMaterials(id, materialIds, profile.id);

    return NextResponse.json({
      ok: true,
      linked: materialIds.length,
      ...result,
      materials: await linkedMaterials(id),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const profile = await requirePermission(request, "tasks:edit");
    const payload = await parsePayload(request, materialLinkSchema);
    const materialIds = materialIdsFromPayload(payload);
    const removed = await removeTaskMaterials(id, materialIds, profile.id);

    return NextResponse.json({
      ok: true,
      unlinked: removed.length,
      materials: await linkedMaterials(id),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
