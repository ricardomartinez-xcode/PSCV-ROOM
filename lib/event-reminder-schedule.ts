const MEXICO_CITY_UTC_OFFSET_HOURS = 6;
const DEFAULT_REMINDER_TIME = "08:00:00";

export function offsetDateKey(dueDate: string, daysOffset: number) {
  const [year, month, day] = dueDate.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1, day + daysOffset));
  return target.toISOString().slice(0, 10);
}

export function mexicoCityDateKey(date = new Date()) {
  return new Date(date.getTime() - MEXICO_CITY_UTC_OFFSET_HOURS * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export function sameMexicoCityDate(first: string, second: string) {
  const firstDate = new Date(first);
  const secondDate = new Date(second);
  if (Number.isNaN(firstDate.getTime()) || Number.isNaN(secondDate.getTime())) {
    return first === second;
  }
  return mexicoCityDateKey(firstDate) === mexicoCityDateKey(secondDate);
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
  const reminderDate = offsetDateKey(dueDate, daysOffset);
  const today = mexicoCityDateKey(now);
  if (reminderDate < today) return null;

  const scheduled = toMexicoCityScheduledDate(dueDate, daysOffset);
  return scheduled.toISOString();
}
