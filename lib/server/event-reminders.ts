import { d1First, d1Run } from "@/lib/server/d1-data";

const EVENT_TASK_TYPE_NAME = "Evento";
const EVENT_REMINDER_KINDS = ["event_reminder_day_before", "event_reminder_day_of"] as const;
const MEXICO_CITY_UTC_OFFSET_HOURS = 6;
const DEFAULT_REMINDER_TIME = "08:00:00";

type EventReminderKind = (typeof EVENT_REMINDER_KINDS)[number];

type TaskTypeRow = {
  name: string;
};

type SyncEventReminderInput = {
  taskId: string;
  title: string;
  dueDate: string;
  dueTime?: string | null;
  taskTypeId?: string | null;
  actorId?: string | null;
};

function toMexicoCityScheduledIso(dueDate: string, daysOffset: number) {
  const [year, month, day] = dueDate.split("-").map(Number);
  const base = new Date(Date.UTC(year, month - 1, day, MEXICO_CITY_UTC_OFFSET_HOURS, 0, 0));
  base.setUTCDate(base.getUTCDate() + daysOffset);
  return base.toISOString();
}

function displayDateTime(input: Pick<SyncEventReminderInput, "dueDate" | "dueTime">) {
  const time = input.dueTime?.slice(0, 5) || "todo el día";
  return `${input.dueDate} · ${time}`;
}

async function getTaskTypeName(taskTypeId?: string | null) {
  if (!taskTypeId) return null;
  const row = await d1First<TaskTypeRow>("SELECT name FROM task_types WHERE id = ? LIMIT 1", [taskTypeId]);
  return row?.name ?? null;
}

async function dismissExistingEventReminders(taskId: string) {
  const placeholders = EVENT_REMINDER_KINDS.map(() => "?").join(", ");
  await d1Run(
    `UPDATE notifications
        SET dismissed_at = COALESCE(dismissed_at, ?)
      WHERE entity = 'tasks'
        AND entity_id = ?
        AND kind IN (${placeholders})
        AND dismissed_at IS NULL`,
    [new Date().toISOString(), taskId, ...EVENT_REMINDER_KINDS],
  );
}

async function insertReminder(input: SyncEventReminderInput, kind: EventReminderKind, scheduledFor: string) {
  const isDayBefore = kind === "event_reminder_day_before";
  await d1Run(
    `INSERT INTO notifications (
        id,
        profile_id,
        kind,
        priority,
        title,
        body,
        entity,
        entity_id,
        action_url,
        scheduled_for,
        created_by
      ) VALUES (?, NULL, ?, 'high', ?, ?, 'tasks', ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      kind,
      isDayBefore ? `Mañana: ${input.title}` : `Hoy: ${input.title}`,
      isDayBefore
        ? `Recordatorio de evento programado para mañana (${displayDateTime(input)}).`
        : `El evento está programado para hoy (${displayDateTime(input)}).`,
      input.taskId,
      "/",
      scheduledFor,
      input.actorId ?? null,
    ],
  );
}

export async function syncEventReminders(input: SyncEventReminderInput) {
  const taskTypeName = await getTaskTypeName(input.taskTypeId);
  await dismissExistingEventReminders(input.taskId);

  if (taskTypeName !== EVENT_TASK_TYPE_NAME) {
    return;
  }

  await insertReminder(input, "event_reminder_day_before", toMexicoCityScheduledIso(input.dueDate, -1));
  await insertReminder(input, "event_reminder_day_of", toMexicoCityScheduledIso(input.dueDate, 0));
}

export async function dismissEventReminders(taskId: string) {
  await dismissExistingEventReminders(taskId);
}
