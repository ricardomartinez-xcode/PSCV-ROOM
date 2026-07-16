import assert from "node:assert/strict";
import test from "node:test";
import {
  activityReminderId,
  isTerminalReminderStatus,
  reminderWriteDecision,
  taskReminderActionUrl,
} from "../lib/activity-reminder-plan.ts";
import {
  mexicoCityDateKey,
  offsetDateKey,
  sameMexicoCityDate,
} from "../lib/event-reminder-schedule.ts";

test("logical reminder IDs are stable per task, recipient, and kind", () => {
  const id = activityReminderId("task/a", "profile:b", "task_reminder_1_day");
  assert.equal(id, "activity-reminder:task/a:profile:b:task_reminder_1_day");
  assert.equal(
    activityReminderId("task/a", "profile:b", "task_reminder_1_day"),
    id,
  );
  assert.notEqual(
    activityReminderId("task/a", "profile:b", "task_reminder_day_of"),
    id,
  );
});

test("same occurrence preserves state while a changed occurrence reschedules", () => {
  assert.equal(reminderWriteDecision(false, false), "create");
  assert.equal(reminderWriteDecision(true, true), "preserve");
  assert.equal(reminderWriteDecision(true, false), "reschedule");
});

test("terminal task states stop reminder generation", () => {
  assert.equal(isTerminalReminderStatus("Entregado"), true);
  assert.equal(isTerminalReminderStatus("Cancelado"), true);
  assert.equal(isTerminalReminderStatus("Pendiente"), false);
});

test("task deep links are safe and retain the task identifier", () => {
  assert.equal(taskReminderActionUrl("task/a b"), "/?task=task%2Fa%20b");
});

test("Mexico City calendar helpers keep the reconciliation window stable", () => {
  assert.equal(mexicoCityDateKey(new Date("2026-07-16T05:59:59.000Z")), "2026-07-15");
  assert.equal(mexicoCityDateKey(new Date("2026-07-16T06:00:00.000Z")), "2026-07-16");
  assert.equal(offsetDateKey("2026-12-31", 1), "2027-01-01");
  assert.equal(
    sameMexicoCityDate("2026-07-16T14:00:00.000Z", "2026-07-16T23:10:00.000Z"),
    true,
  );
});
