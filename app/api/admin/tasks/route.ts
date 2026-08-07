import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requirePermission } from "@/lib/server/authz";
import { executeDataQuery } from "@/lib/server/d1-data";
import { syncEventReminders } from "@/lib/server/event-reminders";
import { dispatchTaskPushNotificationsInBackground } from "@/lib/server/push-delivery";

const taskCreateSchema = z.object({
  title: z.string().trim().min(1),
  course_id: z.string().nullable(),
  task_type_id: z.string().nullable(),
  due_date: z.string().min(1),
  due_time: z.string().min(1),
  item_kind: z.enum(["task", "event"]).default("task"),
  starts_at: z.string().nullable().optional(),
  ends_at: z.string().nullable().optional(),
  location: z.string().trim().nullable().optional(),
  status: z.string().min(1),
  priority: z.string().min(1),
  visible_to_students: z.boolean(),
  material_needed: z.string().nullable(),
  material_url: z.string().nullable(),
  platform_url: z.string().nullable(),
  notes: z.string().nullable(),
  image_id: z.string().nullable().optional(),
  image_url: z.string().url().nullable().optional(),
});

type CreatedTaskRow = {
  id?: string;
  title?: string;
  due_date?: string;
  due_time?: string | null;
  task_type_id?: string | null;
  item_kind?: "task" | "event";
  starts_at?: string | null;
  ends_at?: string | null;
  status?: string;
  visible_to_students?: boolean | number;
};

function enabled(value: boolean | number | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  return value === true || value === 1;
}

export async function POST(request: Request) {
  try {
    const profile = await requirePermission(request, "tasks:edit");
    const input = taskCreateSchema.parse(await request.json());
    if (input.item_kind === "event" && (!input.starts_at || !input.ends_at || input.ends_at <= input.starts_at)) return NextResponse.json({ error: "El evento requiere un fin posterior al inicio." }, { status: 400 });
    const result = await executeDataQuery(request, {
      table: "tasks",
      action: "insert",
      values: {
        ...input,
        created_by: profile.id,
        updated_by: profile.id,
      },
      single: true,
    });
    if (result.error) throw new Error(result.error.message);

    const task = result.data as CreatedTaskRow | null;
    if (task?.id) {
      await syncEventReminders({
        taskId: task.id,
        title: task.title ?? input.title,
        dueDate: task.due_date ?? input.due_date,
        dueTime: task.due_time ?? input.due_time,
        taskTypeId: task.task_type_id ?? input.task_type_id,
        itemKind: task.item_kind ?? input.item_kind,
        startsAt: task.starts_at ?? input.starts_at,
        endsAt: task.ends_at ?? input.ends_at,
        status: task.status ?? input.status,
        visibleToStudents: enabled(
          task.visible_to_students,
          input.visible_to_students,
        ),
        actorId: profile.id,
      });
      await dispatchTaskPushNotificationsInBackground([task.id]);
    }

    return NextResponse.json({ ok: true, task: result.data });
  } catch (error) {
    return errorResponse(error);
  }
}
