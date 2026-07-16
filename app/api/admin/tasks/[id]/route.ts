import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requirePermission } from "@/lib/server/authz";
import { getD1 } from "@/lib/server/cloudflare";
import { d1All, d1First, d1Run, executeDataQuery } from "@/lib/server/d1-data";
import { dismissEventReminders, syncEventReminders } from "@/lib/server/event-reminders";
import { dispatchTaskPushNotificationsInBackground } from "@/lib/server/push-delivery";
import { taskRejectsBucketMaterials } from "@/lib/server/task-material-links";

const taskPatchSchema = z.object({
  title: z.string().min(1).optional(),
  course_id: z.string().nullable().optional(),
  task_type_id: z.string().nullable().optional(),
  due_date: z.string().min(1).optional(),
  due_time: z.string().min(1).optional(),
  item_kind: z.enum(["task", "event"]).optional(),
  starts_at: z.string().nullable().optional(),
  ends_at: z.string().nullable().optional(),
  location: z.string().trim().nullable().optional(),
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
  item_kind?: "task" | "event";
  starts_at?: string | null;
  ends_at?: string | null;
  status: string;
  visible_to_students: boolean | number;
  task_type_name?: string | null;
};

function enabled(value: boolean | number) {
  return value === true || value === 1;
}

async function getTaskRow(id: string) {
  return d1First<TaskRow>(
    `SELECT t.*, tt.name AS task_type_name
       FROM tasks t
       LEFT JOIN task_types tt ON tt.id = t.task_type_id
      WHERE t.id = ?
      LIMIT 1`,
    [id],
  );
}

async function clearEventMaterials(task: TaskRow, actorId: string) {
  if (!taskRejectsBucketMaterials(task.item_kind, task.task_type_name)) return 0;
  const links = await d1All<{ material_id: string }>(
    "SELECT material_id FROM task_materials WHERE task_id = ?",
    [task.id],
  );
  if (!links.length) return 0;
  const db = await getD1();
  await db.batch([
    db.prepare("DELETE FROM task_materials WHERE task_id = ?").bind(task.id),
    ...links.map((link) => db.prepare(
      `INSERT INTO audit_log (id, actor_id, action, entity, entity_id, before_data, after_data)
       VALUES (?, ?, 'task.material.unlink', 'task_materials', ?, ?, NULL)`,
    ).bind(
      crypto.randomUUID(),
      actorId,
      `${task.id}:${link.material_id}`,
      JSON.stringify({ task_id: task.id, material_id: link.material_id, reason: "event_conversion" }),
    )),
  ]);
  return links.length;
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
    const nextKind=patch.item_kind??before.item_kind??"task";const nextStart=patch.starts_at===undefined?before.starts_at:patch.starts_at;const nextEnd=patch.ends_at===undefined?before.ends_at:patch.ends_at;if(nextKind==="event"&&(!nextStart||!nextEnd||nextEnd<=nextStart))return NextResponse.json({error:"El evento requiere un fin posterior al inicio."},{status:400});

    const result = await executeDataQuery(request, {
      table: "tasks",
      action: "update",
      filters: [{ op: "eq", column: "id", value: id }],
      values: { ...patch, updated_by: profile.id, updated_at: new Date().toISOString() },
      single: true,
    });
    if (result.error) throw new Error(result.error.message);

    const after = await getTaskRow(id);
    if (after) {
      await clearEventMaterials(after, profile.id);
      await syncEventReminders({
        taskId: after.id,
        title: after.title,
        dueDate: after.due_date,
        dueTime: after.due_time,
        taskTypeId: after.task_type_id,
        itemKind: after.item_kind,
        startsAt: after.starts_at,
        endsAt: after.ends_at,
        status: after.status,
        visibleToStudents: enabled(after.visible_to_students),
        actorId: profile.id,
      });
      await dispatchTaskPushNotificationsInBackground([after.id]);
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
