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

function targetDateKey(dueDate: string, daysOffset: number) {
  const [year, month, day] = dueDate.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1, day + daysOffset));
  return target.toISOString().slice(0, 10);
}

function mexicoCityDateKey(date: Date) {
  return new Date(date.getTime() - MEXICO_CITY_UTC_OFFSET_HOURS * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function toMexicoCityScheduledDate(dueDate: string, daysOffset: number) {
  const [year, month, day] = dueDate.split("-").map(Number);
  const [hour, minute, second] = DEFAULT_REMINDER_TIME.split(":").map(Number);
  return new Date(Date.UTC(
    year,
    month - 1,
    day + daysOffset,
    hour + MEXICO_CITY_UTC_OFFSET_HOURS,
    minute,
    second,
  ));
}

export function resolveEventReminderSchedule(
  dueDate: string,
  daysOffset: number,
  now = new Date(),
) {
  const reminderDate = targetDateKey(dueDate, daysOffset);
  const today = mexicoCityDateKey(now);
  if (reminderDate < today) return null;

  const scheduled = toMexicoCityScheduledDate(dueDate, daysOffset);
  return scheduled.getTime() <= now.getTime() ? now.toISOString() : scheduled.toISOString();
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

  if (taskTypeName !== EVENT_TASK_TYPE_NAME) return;

  const now = new Date();
  const dayBefore = resolveEventReminderSchedule(input.dueDate, -1, now);
  const dayOf = resolveEventReminderSchedule(input.dueDate, 0, now);

  if (dayBefore) {
    await insertReminder(input, "event_reminder_day_before", dayBefore);
  }
  if (dayOf) {
    await insertReminder(input, "event_reminder_day_of", dayOf);
  }
}

export async function dismissEventReminders(taskId: string) {
  await dismissExistingEventReminders(taskId);
}
