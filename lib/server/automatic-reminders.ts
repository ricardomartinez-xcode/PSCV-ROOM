import { ACTIVITY_REMINDER_KINDS, syncEventReminders } from "@/lib/server/event-reminders";

type Row = {
  id: string;
  title: string;
  due_date: string;
  due_time: string;
  task_type_id: string | null;
  item_kind: "task" | "event" | null;
  starts_at: string | null;
  ends_at: string | null;
};
type CountRow = { total: number };

export async function ensureAutomaticReminders(env: CloudflareEnv) {
  const start = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + 120 * 86400000).toISOString().slice(0, 10);
  const rows = await env.DB.prepare(
    `SELECT id, title, due_date, due_time, task_type_id, item_kind, starts_at, ends_at
       FROM tasks
      WHERE archived_at IS NULL
        AND status NOT IN ('Entregado', 'Cancelado')
        AND due_date BETWEEN ? AND ?
      ORDER BY due_date
      LIMIT 500`,
  ).bind(start, end).all<Row>();

  const active = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM app_profiles WHERE active = 1",
  ).first<CountRow>();
  const expectedRecipients = Number(active?.total ?? 0);
  let synchronized = 0;

  for (const row of rows.results ?? []) {
    const placeholders = ACTIVITY_REMINDER_KINDS.map(() => "?").join(",");
    const existing = await env.DB.prepare(
      `SELECT COUNT(DISTINCT profile_id) AS total
         FROM notifications
        WHERE entity = 'tasks'
          AND entity_id = ?
          AND kind IN (${placeholders})
          AND profile_id IS NOT NULL
          AND dismissed_at IS NULL`,
    ).bind(row.id, ...ACTIVITY_REMINDER_KINDS).first<CountRow>();

    if (expectedRecipients > 0 && Number(existing?.total ?? 0) === expectedRecipients) continue;

    await syncEventReminders({
      taskId: row.id,
      title: row.title,
      dueDate: row.due_date,
      dueTime: row.due_time,
      taskTypeId: row.task_type_id,
      itemKind: row.item_kind ?? "task",
      startsAt: row.starts_at,
      endsAt: row.ends_at,
    });
    synchronized += 1;
  }

  return { scanned: rows.results?.length ?? 0, synchronized };
}
