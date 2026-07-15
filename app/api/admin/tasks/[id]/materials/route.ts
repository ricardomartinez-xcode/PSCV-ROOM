import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requirePermission } from "@/lib/server/authz";
import { d1All, d1Run } from "@/lib/server/d1-data";

const materialLinkSchema = z.object({
  materialId: z.string().min(1).optional(),
  materialIds: z.array(z.string().min(1)).min(1).max(50).optional(),
}).superRefine((value, ctx) => {
  if (!value.materialId && !value.materialIds?.length) {
    ctx.addIssue({ code: "custom", message: "Se requiere al menos un material." });
  }
});

type RouteContext = { params: Promise<{ id: string }> };

async function audit(actorId: string, action: string, taskId: string, materialId: string, before: boolean) {
  await d1Run(
    `INSERT INTO audit_log (id, actor_id, action, entity, entity_id, before_data, after_data)
     VALUES (?, ?, ?, 'task_materials', ?, ?, ?)`,
    [
      crypto.randomUUID(),
      actorId,
      action,
      `${taskId}:${materialId}`,
      before ? JSON.stringify({ task_id: taskId, material_id: materialId }) : null,
      before ? null : JSON.stringify({ task_id: taskId, material_id: materialId }),
    ],
  );
}

function materialIdsFromPayload(payload: z.infer<typeof materialLinkSchema>) {
  return [...new Set(payload.materialIds ?? [payload.materialId!])];
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await requirePermission(request, "tasks:edit");
    const rows = await d1All<Record<string, unknown>>(
      `SELECT m.*
       FROM task_materials tm
       JOIN materials m ON m.id = tm.material_id
       WHERE tm.task_id = ?
       ORDER BY m.title ASC`,
      [id],
    );
    return NextResponse.json({ ok: true, materials: rows.map((row) => ({ materials: row })) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const profile = await requirePermission(request, "tasks:edit");
    const payload = materialLinkSchema.parse(await request.json());
    const materialIds = materialIdsFromPayload(payload);

    for (const materialId of materialIds) {
      await d1Run(
        `INSERT INTO task_materials (task_id, material_id) VALUES (?, ?)
         ON CONFLICT (task_id, material_id) DO NOTHING`,
        [id, materialId],
      );
      await audit(profile.id, "task.material.link", id, materialId, false);
    }

    return NextResponse.json({ ok: true, linked: materialIds.length });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const profile = await requirePermission(request, "tasks:edit");
    const payload = materialLinkSchema.parse(await request.json());
    const materialIds = materialIdsFromPayload(payload);

    for (const materialId of materialIds) {
      await d1Run("DELETE FROM task_materials WHERE task_id = ? AND material_id = ?", [id, materialId]);
      await audit(profile.id, "task.material.unlink", id, materialId, true);
    }

    return NextResponse.json({ ok: true, unlinked: materialIds.length });
  } catch (error) {
    return errorResponse(error);
  }
}
