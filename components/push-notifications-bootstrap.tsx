"use client";

import { useEffect } from "react";

function decodeApplicationServerKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  return bytes;
}

async function syncPushSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  if (Notification.permission !== "granted") return;

  const configResponse = await fetch("/api/push/config", { credentials: "include", cache: "no-store" });
  if (!configResponse.ok) return;
  const config = (await configResponse.json()) as { publicKey?: string };
  if (!config.publicKey) return;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeApplicationServerKey(config.publicKey),
    });
  }

  await fetch("/api/push/subscribe", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
}

export function PushNotificationsBootstrap() {
  useEffect(() => {
    let stopped = false;
    const sync = () => {
      if (!stopped) void syncPushSubscription().catch(() => undefined);
    };
    sync();
    const interval = window.setInterval(sync, 30_000);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  return null;
}
