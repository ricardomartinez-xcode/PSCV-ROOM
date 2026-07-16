import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { notificationActionUrl } from "../lib/notification-action.ts";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const adminNoticeRoute = source("../app/api/admin/notifications/route.ts");
const pushDelivery = source("../lib/server/push-delivery.ts");
const providers = source("../components/providers.tsx");
const serviceWorker = source("../public/sw.js");
const appShell = source("../components/app-shell-v5.tsx");

function functionBlock(name: string, nextName: string) {
  const start = appShell.indexOf(`function ${name}`);
  const end = appShell.indexOf(`function ${nextName}`, start + 1);
  assert.ok(start >= 0, `${name} must exist`);
  assert.ok(end > start, `${name} must end before ${nextName}`);
  return appShell.slice(start, end);
}

test("manual notices persist a per-recipient popup URL and queue targeted Web Push", () => {
  assert.equal(notificationActionUrl("notice id/21"), "/?notification=notice%20id%2F21");
  assert.match(adminNoticeRoute, /const id = crypto\.randomUUID\(\)/);
  assert.match(adminNoticeRoute, /action_url: notificationActionUrl\(id\)/);
  assert.match(adminNoticeRoute, /INSERT INTO notifications[\s\S]*action_url/);
  assert.match(adminNoticeRoute, /row\.action_url/);
  assert.match(
    adminNoticeRoute,
    /dispatchPushNotificationsInBackground\(rows\.map\(\(row\) => row\.id\)\)/,
  );
  assert.match(pushDelivery, /processPushNotificationsByIds/);
  assert.match(pushDelivery, /context\.ctx\.waitUntil\(delivery/);
});

test("foreground polling attempts every fresh system notification", () => {
  assert.doesNotMatch(providers, /document\.visibilityState/);
  assert.doesNotMatch(providers, /fresh\.slice\(/);
  assert.match(providers, /fresh\.map\(showSystemNotification\)/);
  assert.match(providers, /notificationActionUrl\(notification\.id\)/);
  assert.match(providers, /notificationId: notification\.id/);
});

test("the service worker preserves notification identity in its popup deep link", () => {
  assert.match(serviceWorker, /const rawId = typeof notification\?\.id === "string"/);
  assert.match(
    serviceWorker,
    /rawId \? `\/\?notification=\$\{encodeURIComponent\(rawId\)\}` : "\/"/,
  );
  assert.match(serviceWorker, /data: \{ url, notificationId: rawId \|\| null \}/);
  assert.match(serviceWorker, /const targetUrl = safeAppUrl\(event\.notification\.data\?\.url \|\| "\/"\)/);
});

test("in-app broadcasts open an accessible content popup", () => {
  const openNotification = functionBlock("openNotification", "refreshCurrentData");
  assert.match(openNotification, /notification\.entity === "tasks"/);
  assert.match(
    openNotification,
    /set(?:NotificationDetail|SelectedNotification)\(notification\)/,
  );
  assert.match(appShell, /function NotificationDetailDialog/);
  assert.match(appShell, /role="dialog"/);
  assert.match(appShell, /aria-modal="true"/);
  assert.match(appShell, /notification\.title/);
  assert.match(appShell, /notification\.body/);
});

test("system deep links open notices and task reminders at their content", () => {
  assert.match(
    appShell,
    /\.get\((?:NOTIFICATION_QUERY_PARAM|"notification")\)/,
  );
  assert.match(
    appShell,
    /notifications\.find\(\((\w+)\) => \1\.id === notificationId\)/,
  );
  assert.match(appShell, /\.get\("task"\)/);
  assert.match(appShell, /setSelectedTaskId\(taskId\)|openTaskDetail\(taskId, "tasks"\)/);
  assert.match(appShell, /window\.history\.replaceState/);
});
