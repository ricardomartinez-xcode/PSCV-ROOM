import { NextResponse } from "next/server";
import { z } from "zod";
import {
  mexicoCityDateKey,
  offsetDateKey,
} from "@/lib/event-reminder-schedule";
import { errorResponse, requirePermission } from "@/lib/server/authz";
import { d1All } from "@/lib/server/d1-data";
import {
  syncEventReminders,
  type ReminderSyncResult,
} from "@/lib/server/event-reminders";

const schema = z.object({
  // Accept the previous client value during rollout, but always enforce the
  // product rule of reconciling only today and tomorrow.
  windowDays: z.number().int().min(1).max(120).optional(),
});

type Row = {
  id: string;
  title: string;
  due_date: string;
  due_time: string;
  task_type_id: string | null;
  item_kind: "task" | "event" | null;
  starts_at: string | null;
  ends_at: string | null;
  status: string;
  visible_to_students: boolean | number | string;
};

function enabled(value: boolean | number | string) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function merge(target: ReminderSyncResult, source: ReminderSyncResult) {
  target.created += source.created;
  target.updated += source.updated;
  target.preserved += source.preserved;
  target.dismissed += source.dismissed;
}

export async function POST(request: Request) {
  try {
    const profile = await requirePermission(request, "notifications:manage");
    await schema.parseAsync(await request.json().catch(() => ({})));

    const windowDays = 1;
    const start = mexicoCityDateKey();
    const end = offsetDateKey(start, windowDays);
    const rows = await d1All<Row>(
      `SELECT id, title, due_date, due_time, task_type_id, item_kind,
              starts_at, ends_at, status, visible_to_students
         FROM tasks
        WHERE archived_at IS NULL
          AND due_date BETWEEN ? AND ?
        ORDER BY due_date, due_time`,
      [start, end],
    );

    const totals: ReminderSyncResult = {
      created: 0,
      updated: 0,
      preserved: 0,
      dismissed: 0,
    };
    for (const row of rows) {
      merge(totals, await syncEventReminders({
        taskId: row.id,
        title: row.title,
        dueDate: row.due_date,
        dueTime: row.due_time,
        taskTypeId: row.task_type_id,
        itemKind: row.item_kind ?? "task",
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        status: row.status,
        visibleToStudents: enabled(row.visible_to_students),
        actorId: profile.id,
      }));
    }

    return NextResponse.json({
      ok: true,
      windowDays,
      window: { start, end },
      scanned: rows.length,
      synchronized: rows.length,
      inserted: totals.created,
      ...totals,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
