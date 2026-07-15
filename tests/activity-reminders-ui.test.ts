import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const worker = readFileSync(new URL("../custom-worker.ts", import.meta.url), "utf8");
const reminders = readFileSync(new URL("../lib/server/event-reminders.ts", import.meta.url), "utf8");

test("only active activity reminder kinds are generated", () => {
  for (const kind of [
    "task_reminder_1_day",
    "task_reminder_day_of",
    "event_reminder_day_before",
  ]) {
    assert.match(reminders, new RegExp(kind));
  }
  assert.doesNotMatch(reminders, /["\t] task_reminder_3_days\b|["\t] task_reminder_2_days\b/);
});

test("cron reconciles before delivery", () => assert.match(worker, /ensureAutomaticReminders/));

const shell = readFileSync(new URL("../components/app-shell-v5.tsx", import.meta.url), "utf8");
test("UI separates tasks from events", () => {
  assert.match(shell, /itemKind: "task" \| "event"/);
  assert.match(shell, /Fecha de inicio/);
  assert.match(shell, /Fecha de fin/);
  assert.match(shell, /Crear evento/);
  assert.match(shell, /eventRow/);
});
