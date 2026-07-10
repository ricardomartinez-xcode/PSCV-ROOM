self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

async function loadLatestNotification() {
  const response = await fetch("/api/notifications", {
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return null;
  const payload = await response.json();
  const notifications = Array.isArray(payload.notifications) ? payload.notifications : [];
  return notifications.find((item) => !item.read_at) || notifications[0] || null;
}

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    const notification = await loadLatestNotification().catch(() => null);
    const title = notification?.title || "PSCV Room";
    const body = notification?.body || "Tienes una notificación nueva.";
    const url = notification?.action_url || "/";
    await self.registration.showNotification(title, {
      body,
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: notification?.id ? `pscv-${notification.id}` : "pscv-notification",
      renotify: true,
      data: { url },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        if ("navigate" in client) await client.navigate(targetUrl);
        return client.focus();
      }
    }
    return self.clients.openWindow(targetUrl);
  })());
});
