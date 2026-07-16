import { NextResponse } from "next/server";
import { z } from "zod";
import { seedTasks } from "@/lib/seed";
import { getSql } from "@/lib/server/db";
import { calculateDaysRemaining, deriveReaderVisibility, deriveStatus } from "@/lib/task-utils";
import type { TaskStatus } from "@/lib/domain";
import { errorResponse, requirePermission, requireProfile } from "@/lib/server/authz";

const taskSchema = z.object({
  course: z.string().min(1),
  dueDate: z.string().min(10),
  dueTime: z.string().default("23:59"),
  title: z.string().min(1),
  materialNeeded: z.string().optional(),
  materialUrl: z.string().url().optional().or(z.literal("")),
  deliveryType: z.string().min(1),
  status: z.string().min(1).default("Pendiente"),
  notes: z.string().optional(),
  platformUrl: z.string().url().optional().or(z.literal("")),
});

type TaskRow = {
  id: string;
  course: string;
  due_date: string;
  due_time: string;
  title: string;
  material_needed: string | null;
  material_url: string | null;
  delivery_type: string;
  status: TaskStatus;
  notes: string | null;
  platform_url: string | null;
  calendar_event_id: string | null;
  last_sync_at: string | null;
  visible_to_students: boolean | number;
};

export async function GET(request: Request) {
  try {
    const profile = await requireProfile(request);
    const sql = getSql();
    if (!sql) {
      return NextResponse.json({ source: "demo", tasks: seedTasks });
    }

    const rows = await sql<TaskRow>`
    select
      t.id,
      coalesce(c.name, 'Sin materia') as course,
      t.due_date,
      t.due_time,
      t.title,
      t.material_needed,
      t.material_url,
      coalesce(tt.name, 'Tarea') as delivery_type,
      t.status,
      t.notes,
      t.platform_url,
      t.calendar_event_id,
      t.last_sync_at,
      t.visible_to_students
    from tasks t
    left join courses c on c.id = t.course_id
    left join task_types tt on tt.id = t.task_type_id
    where t.archived_at is null
    order by t.due_date asc, t.due_time asc
  `;

    const visibleRows = profile.role === "student"
      ? rows.filter((row) => row.visible_to_students === true || row.visible_to_students === 1)
      : rows;
    return NextResponse.json({
      source: "d1",
      tasks: visibleRows.map((row) => {
      const dueDate = String(row.due_date);
      const daysRemaining = calculateDaysRemaining(dueDate);
      const status = deriveStatus(row.status, daysRemaining);
      return {
        id: row.id,
        course: row.course,
        dueDate,
        dueTime: String(row.due_time).slice(0, 5),
        title: row.title,
        materialNeeded: row.material_needed ?? "",
        materialUrl: row.material_url ?? "",
        deliveryType: row.delivery_type,
        status,
        daysRemaining,
        notes: row.notes ?? "",
        platformUrl: row.platform_url ?? "",
        calendarEventId: row.calendar_event_id ?? "",
        lastSync: row.last_sync_at ? new Date(String(row.last_sync_at)).toISOString() : "",
        visibleToReaders: deriveReaderVisibility({ status }),
      };
      }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requirePermission(request, "tasks:edit");
    const sql = getSql();
    if (!sql) {
      return NextResponse.json(
        { error: "D1 no está configurado. En modo demo la UI usa localStorage." },
        { status: 501 },
      );
    }

    const payload = taskSchema.parse(await request.json());
    const [course] = await sql<{ id: string }>`
    select id from courses where name = ${payload.course} limit 1
  `;
    const [taskType] = await sql<{ id: string }>`
    select id from task_types where name = ${payload.deliveryType} limit 1
  `;
    const id = crypto.randomUUID();
    const [task] = await sql<{ id: string }>`
    insert into tasks (
      id, course_id, task_type_id, due_date, due_time, title, material_needed, material_url,
      status, notes, platform_url
    ) values (
      ${id}, ${course?.id ?? null}, ${taskType?.id ?? null}, ${payload.dueDate}, ${payload.dueTime}, ${payload.title},
      ${payload.materialNeeded ?? null}, ${payload.materialUrl || null},
      ${payload.status}, ${payload.notes ?? null}, ${payload.platformUrl || null}
    )
    returning id
  `;

    return NextResponse.json({ ok: true, id: task.id }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
