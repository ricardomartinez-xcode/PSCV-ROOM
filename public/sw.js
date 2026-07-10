const CACHE_VERSION = "pscv-push-v2";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function decodeApplicationServerKey(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

async function claimPendingNotification() {
  const subscription = await self.registration.pushManager.getSubscription();
  if (!subscription) return null;
  const response = await fetch("/api/push/pending", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  if (!response.ok) return null;
  const payload = await response.json();
  return payload && payload.notification ? payload.notification : null;
}

function payloadNotification(event) {
  if (!event.data) return null;
  try {
    const payload = event.data.json();
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    const notification = payloadNotification(event)
      || await claimPendingNotification().catch(() => null);
    const title = notification?.title || "PSCV Room";
    const body = notification?.body || "Tienes una notificación nueva. Abre PSCV Room para verla.";
    const url = notification?.action_url || notification?.url || "/";
    const tag = notification?.id ? `pscv-${notification.id}` : `${CACHE_VERSION}-generic`;
    await self.registration.showNotification(title, {
      body,
      icon: "/icon.svg",
      tag,
      renotify: true,
      data: { url },
    });
  })());
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const configResponse = await fetch("/api/push/config", {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!configResponse.ok) return;
    const config = await configResponse.json();
    if (!config.enabled || !config.publicKey) return;
    const subscription = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeApplicationServerKey(config.publicKey),
    });
    await fetch("/api/push/subscribe", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });
  })().catch(() => undefined));
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
