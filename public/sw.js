const CACHE_VERSION = "pscv-push-v4";
const APP_ICON_URL = "/icon.svg";

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
  const response = await fetch(new URL("/api/push/pending", self.location.origin), {
    method: "POST",
    mode: "same-origin",
    credentials: "include",
    cache: "no-store",
    redirect: "error",
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

function safeAppUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return `${self.location.origin}/`;
  try {
    const candidate = new URL(value, self.location.origin);
    if (candidate.origin !== self.location.origin) return `${self.location.origin}/`;
    if (candidate.protocol !== "https:" && candidate.protocol !== "http:") {
      return `${self.location.origin}/`;
    }
    return candidate.href;
  } catch {
    return `${self.location.origin}/`;
  }
}

function safeNotificationText(value, fallback, maxLength) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : fallback;
}

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    const notification = payloadNotification(event)
      || await claimPendingNotification().catch(() => null);
    const title = safeNotificationText(notification?.title, "PSCV Room", 120);
    const body = safeNotificationText(
      notification?.body,
      "Tienes una notificación nueva. Abre PSCV Room para verla.",
      320,
    );
    const rawId = typeof notification?.id === "string" ? notification.id.slice(0, 160) : "";
    const fallbackUrl = rawId ? `/?notification=${encodeURIComponent(rawId)}` : "/";
    const url = safeAppUrl(notification?.action_url || notification?.url || fallbackUrl);
    const tag = rawId ? `pscv-${rawId}` : `${CACHE_VERSION}-generic`;
    await self.registration.showNotification(title, {
      body,
      icon: APP_ICON_URL,
      tag,
      renotify: false,
      data: { url, notificationId: rawId || null },
    });
  })());
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const configResponse = await fetch(new URL("/api/push/config", self.location.origin), {
      mode: "same-origin",
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    if (!configResponse.ok) return;
    const config = await configResponse.json();
    if (!config.enabled || !config.publicKey) return;
    const subscription = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeApplicationServerKey(config.publicKey),
    });
    await fetch(new URL("/api/push/subscribe", self.location.origin), {
      method: "POST",
      mode: "same-origin",
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });
  })().catch(() => undefined));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = safeAppUrl(event.notification.data?.url || "/");
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
