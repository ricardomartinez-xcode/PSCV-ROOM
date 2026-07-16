import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  EVENT_REMINDER_SCHEDULES,
  TASK_REMINDER_SCHEDULES,
} from "../lib/activity-reminder-plan.ts";

const worker = readFileSync(new URL("../custom-worker.ts", import.meta.url), "utf8");
const automaticReminders = readFileSync(
  new URL("../lib/server/automatic-reminders.ts", import.meta.url),
  "utf8",
);

test("only active activity reminder kinds are generated", () => {
  assert.deepEqual(TASK_REMINDER_SCHEDULES, [
    { kind: "task_reminder_1_day", daysOffset: -1 },
    { kind: "task_reminder_day_of", daysOffset: 0 },
  ]);
  assert.deepEqual(EVENT_REMINDER_SCHEDULES, [
    { kind: "event_reminder_day_before", daysOffset: -1 },
  ]);
});

test("cron reconciles before delivery", () => {
  const reconciliation = worker.indexOf("await runScheduledJob(\n    \"automatic-reminders\"");
  const delivery = worker.indexOf("await Promise.all");
  assert.ok(reconciliation >= 0);
  assert.ok(delivery > reconciliation);
});

test("cron reconciles the complete today-and-tomorrow window idempotently", () => {
  assert.match(automaticReminders, /offsetDateKey\(start, 1\)/);
  assert.doesNotMatch(automaticReminders, /COUNT\(DISTINCT profile_id\)/);
  assert.match(automaticReminders, /for \(const row of activities\)/);
});

const shell = readFileSync(new URL("../components/app-shell-v5.tsx", import.meta.url), "utf8");
test("UI separates tasks from events", () => {
  assert.match(shell, /itemKind: "task" \| "event"/);
  assert.match(shell, /Fecha de inicio/);
  assert.match(shell, /Fecha de fin/);
  assert.match(shell, /Crear evento/);
  assert.match(shell, /eventRow/);
});
