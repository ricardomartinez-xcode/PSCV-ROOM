import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const reminders = source("../lib/server/event-reminders.ts");
const createRoute = source("../app/api/admin/tasks/route.ts");
const patchRoute = source("../app/api/admin/tasks/[id]/route.ts");
const generateRoute = source("../app/api/admin/notifications/generate/route.ts");
const push = source("../lib/server/web-push.ts");
const pushDelivery = source("../lib/server/push-delivery.ts");
const automaticReminders = source("../lib/server/automatic-reminders.ts");
const emailDelivery = source("../lib/server/reminder-email-delivery.ts");
const migration = source("../migrations/0011_idempotent_activity_reminders.sql");
const deliveryMigration = source("../migrations/0012_email_delivery_claims.sql");

test("task mutations pass status and student visibility to reminder sync", () => {
  for (const route of [createRoute, patchRoute]) {
    assert.match(route, /status:/);
    assert.match(route, /visibleToStudents:/);
    assert.match(route, /dispatchTaskPushNotificationsInBackground/);
  }
});

test("new and regenerated reminders target their tasks before the global fallback", () => {
  assert.match(generateRoute, /dispatchTaskPushNotificationsInBackground\(rows\.map\(\(row\) => row\.id\)\)/);
  assert.match(pushDelivery, /export async function processTaskPushNotifications/);
  assert.match(pushDelivery, /entity_id IN \(\$\{placeholders\}\)/);
  assert.match(pushDelivery, /processPushNotificationsByIds\(env, notificationIds\)/);
  assert.match(automaticReminders, /processTaskPushNotifications/);
});

test("same reminder occurrences preserve inbox state and changed ones reset delivery", () => {
  assert.match(reminders, /sameMexicoCityDate/);
  assert.match(reminders, /decision === "preserve"/);
  assert.match(reminders, /read_at = NULL/);
  assert.match(reminders, /DELETE FROM push_deliveries WHERE notification_id/);
  assert.match(reminders, /DELETE FROM notification_email_deliveries WHERE notification_id/);
  assert.match(reminders, /await db\.batch/);
  assert.match(reminders, /INSERT OR IGNORE INTO notifications/);
});

test("email delivery claims due reminders before contacting the external provider", () => {
  const claim = emailDelivery.indexOf("INSERT INTO notification_email_deliveries");
  const send = emailDelivery.indexOf("await deliverAnnouncementEmails");
  assert.ok(claim > -1 && send > claim);
  assert.match(emailDelivery, /status = 'pending'/);
  assert.match(emailDelivery, /status = 'delivered'/);
  assert.match(emailDelivery, /changedRows\(claim\) === 0/);
  assert.match(deliveryMigration, /ADD COLUMN status TEXT NOT NULL DEFAULT 'delivered'/);
});

test("terminal and hidden task handling is enforced in the persistence layer", () => {
  assert.match(reminders, /isTerminalReminderStatus\(input\.status\)/);
  assert.match(reminders, /role <> 'student'/);
  assert.match(reminders, /dismissIneligibleRecipients/);
});

test("manual generation enforces one day and reports coherent counters", () => {
  assert.match(generateRoute, /const windowDays = 1/);
  assert.match(generateRoute, /synchronized: rows\.length/);
  assert.match(generateRoute, /inserted: totals\.created/);
  for (const counter of ["created", "updated", "preserved", "dismissed"]) {
    assert.match(generateRoute, new RegExp(counter));
  }
});

test("push wakes survive at least 24 hours and task reminders deep-link", () => {
  assert.match(push, /PUSH_TTL_SECONDS = 24 \* 60 \* 60/);
  assert.match(push, /TTL: String\(PUSH_TTL_SECONDS\)/);
  assert.match(reminders, /taskReminderActionUrl\(input\.taskId\)/);
});

test("migration cleans legacy kinds and enforces one active logical reminder", () => {
  assert.match(migration, /due_soon_hours = 24/);
  assert.match(migration, /task_reminder_3_days/);
  assert.match(migration, /task_reminder_2_days/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_active_activity_reminder/);
});
