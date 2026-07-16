export const LEGACY_TASK_REMINDER_KINDS = [
  "task_reminder_3_days",
  "task_reminder_2_days",
] as const;

export const ACTIVITY_REMINDER_KINDS = [
  "event_reminder_day_before",
  "task_reminder_1_day",
  "task_reminder_day_of",
] as const;

export type ActivityReminderKind =
  (typeof ACTIVITY_REMINDER_KINDS)[number];

export const EVENT_REMINDER_SCHEDULES = [
  { kind: "event_reminder_day_before", daysOffset: -1 },
] as const satisfies ReadonlyArray<{
  kind: ActivityReminderKind;
  daysOffset: number;
}>;

export const TASK_REMINDER_SCHEDULES = [
  { kind: "task_reminder_1_day", daysOffset: -1 },
  { kind: "task_reminder_day_of", daysOffset: 0 },
] as const satisfies ReadonlyArray<{
  kind: ActivityReminderKind;
  daysOffset: number;
}>;

export function isTerminalReminderStatus(status: string) {
  return status === "Entregado" || status === "Cancelado";
}

export function activityReminderId(
  taskId: string,
  profileId: string,
  kind: ActivityReminderKind,
) {
  return `activity-reminder:${taskId}:${profileId}:${kind}`;
}

export function taskReminderActionUrl(taskId: string) {
  return `/?task=${encodeURIComponent(taskId)}`;
}

export type ReminderWriteDecision = "create" | "preserve" | "reschedule";

export function reminderWriteDecision(
  hasExisting: boolean,
  sameOccurrence: boolean,
): ReminderWriteDecision {
  if (!hasExisting) return "create";
  return sameOccurrence ? "preserve" : "reschedule";
}
