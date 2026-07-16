import assert from "node:assert/strict";
import test from "node:test";
import { resolveEventReminderSchedule } from "../lib/event-reminder-schedule.ts";

const now = new Date("2026-07-10T15:00:00.000Z");

test("does not create yesterday's reminder for an event happening today", () => {
  assert.equal(resolveEventReminderSchedule("2026-07-10", -1, now), null);
  assert.equal(resolveEventReminderSchedule("2026-07-10", 0, now), "2026-07-10T14:00:00.000Z");
});

test("keeps a canonical occurrence for a late day-before reminder", () => {
  assert.equal(resolveEventReminderSchedule("2026-07-11", -1, now), "2026-07-10T14:00:00.000Z");
  assert.equal(resolveEventReminderSchedule("2026-07-11", 0, now), "2026-07-11T14:00:00.000Z");
});

test("does not schedule reminders for historical events", () => {
  assert.equal(resolveEventReminderSchedule("2026-07-09", -1, now), null);
  assert.equal(resolveEventReminderSchedule("2026-07-09", 0, now), null);
});
