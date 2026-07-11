import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const layoutSource = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const pushSource = readFileSync(new URL("../components/push-notifications-bootstrap.tsx", import.meta.url), "utf8");
const providerSource = readFileSync(new URL("../components/providers.tsx", import.meta.url), "utf8");
const appShellSource = readFileSync(new URL("../components/app-shell-v5.tsx", import.meta.url), "utf8");
const notificationCss = readFileSync(new URL("../app/notification-center.css", import.meta.url), "utf8");

test("the header bell is the only notification launcher", () => {
  assert.match(appShellSource, /className={`iconButton notificationButton/);
  assert.doesNotMatch(pushSource, /pushNotificationsFab|🔔|pushNotificationsPanel/);
  assert.match(pushSource, /PushNotificationsContext\.Provider/);
});

test("notification tray styles are loaded explicitly", () => {
  assert.match(layoutSource, /notification-center\.css/);
  assert.doesNotMatch(layoutSource, /push-notifications\.css|operational-polish\.css/);
  assert.match(notificationCss, /\.notificationTray\s*\{/);
  assert.match(notificationCss, /\.notificationItem\s*\{/);
});

test("Web Push controls live inside the existing notification settings", () => {
  assert.match(providerSource, /usePushNotifications/);
  assert.match(providerSource, /Con la app cerrada/);
  assert.match(providerSource, /push\.sendTest/);
  assert.match(providerSource, /push\.deactivate/);
});
