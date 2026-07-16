import {
  mexicoCityDateKey,
  offsetDateKey,
} from "@/lib/event-reminder-schedule";
import {
  syncEventReminders,
  type ReminderSyncResult,
} from "@/lib/server/event-reminders";

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

export async function ensureAutomaticReminders(env: CloudflareEnv) {
  const start = mexicoCityDateKey();
  const end = offsetDateKey(start, 1);
  const rows = await env.DB.prepare(
    `SELECT id, title, due_date, due_time, task_type_id, item_kind,
            starts_at, ends_at, status, visible_to_students
       FROM tasks
      WHERE archived_at IS NULL
        AND due_date BETWEEN ? AND ?
      ORDER BY due_date, due_time
      LIMIT 500`,
  ).bind(start, end).all<Row>();

  const totals: ReminderSyncResult = {
    created: 0,
    updated: 0,
    preserved: 0,
    dismissed: 0,
  };
  const activities = rows.results ?? [];

  // The write path is idempotent, so every at-least-once cron invocation can
  // reconcile both expected kinds instead of relying on an incomplete count.
  for (const row of activities) {
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
    }));
  }

  return {
    scanned: activities.length,
    synchronized: activities.length,
    window: { start, end },
    ...totals,
  };
}
