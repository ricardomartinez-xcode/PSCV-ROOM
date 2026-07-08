import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requirePermission } from "@/lib/server/authz";
import { d1First, d1Run, executeDataQuery } from "@/lib/server/d1-data";
import { dismissEventReminders, syncEventReminders } from "@/lib/server/event-reminders";

const taskPatchSchema = z.object({
  title: z.string().min(1).optional(),
  course_id: z.string().nullable().optional(),
  task_type_id: z.string().nullable().optional(),
  due_date: z.string().min(1).optional(),
  due_time: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  priority: z.string().min(1).optional(),
  visible_to_students: z.boolean().optional(),
  material_needed: z.string().nullable().optional(),
  material_url: z.string().nullable().optional(),
  platform_url: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

type TaskRow = Record<string, unknown> & {
  id: string;
  title: string;
  due_date: string;
  due_time?: string | null;
  task_type_id?: string | null;
};

async function getTaskRow(id: string) {
  return d1First<TaskRow>("SELECT * FROM tasks WHERE id = ? LIMIT 1", [id]);
}

async function writeAudit(input: {
  actorId: string;
  action: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}) {
  await d1Run(
    `INSERT INTO audit_log (id, actor_id, action, entity, entity_id, before_data, after_data)
     VALUES (?, ?, ?, 'tasks', ?, ?, ?)`,
    [
      crypto.randomUUID(),
      input.actorId,
      input.action,
      input.entityId,
      input.before ? JSON.stringify(input.before) : null,
      input.after ? JSON.stringify(input.after) : null,
    ],
  );
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await requirePermission(request, "tasks:edit");
    const result = await executeDataQuery(request, {
      table: "tasks",
      action: "select",
      filters: [{ op: "eq", column: "id", value: id }],
      maybeSingle: true,
    });
    if (result.error) throw new Error(result.error.message);
    if (!result.data) return NextResponse.json({ error: "Tarea no encontrada." }, { status: 404 });
    return NextResponse.json({ ok: true, task: result.data });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const profile = await requirePermission(request, "tasks:edit");
    const patch = taskPatchSchema.parse(await request.json());
    const before = await getTaskRow(id);
    if (!before) return NextResponse.json({ error: "Tarea no encontrada." }, { status: 404 });

    const result = await executeDataQuery(request, {
      table: "tasks",
      action: "update",
      filters: [{ op: "eq", column: "id", value: id }],
      values: { ...patch, updated_by: profile.id, updated_at: new Date().toISOString() },
      single: true,
    });
    if (result.error) throw new Error(result.error.message);

    const after = ((result.data as TaskRow | null) ?? (await getTaskRow(id))) as TaskRow | null;
    if (after) {
      await syncEventReminders({
        taskId: after.id,
        title: after.title,
        dueDate: after.due_date,
        dueTime: after.due_time,
        taskTypeId: after.task_type_id,
        actorId: profile.id,
      });
    }

    await writeAudit({ actorId: profile.id, action: "task.update", entityId: id, before, after: result.data });
    return NextResponse.json({ ok: true, task: result.data });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const profile = await requirePermission(request, "tasks:delete");
    const before = await getTaskRow(id);
    if (!before) return NextResponse.json({ error: "Tarea no encontrada." }, { status: 404 });

    const archivedAt = new Date().toISOString();
    const result = await executeDataQuery(request, {
      table: "tasks",
      action: "update",
      filters: [{ op: "eq", column: "id", value: id }],
      values: { archived_at: archivedAt, updated_by: profile.id, updated_at: archivedAt },
      single: true,
    });
    if (result.error) throw new Error(result.error.message);

    await dismissEventReminders(id);
    await writeAudit({ actorId: profile.id, action: "task.archive", entityId: id, before, after: result.data });
    return NextResponse.json({ ok: true, task: result.data });
  } catch (error) {
    return errorResponse(error);
  }
}
