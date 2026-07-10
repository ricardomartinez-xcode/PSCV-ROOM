"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type PushState =
  | "loading"
  | "unsupported"
  | "install-required"
  | "prompt"
  | "subscribing"
  | "active"
  | "denied"
  | "server-unavailable"
  | "error";

type PushConfig = { enabled?: boolean; publicKey?: string | null };
type NavigatorWithStandalone = Navigator & { standalone?: boolean };

function decodeApplicationServerKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandaloneDisplay() {
  return window.matchMedia("(display-mode: standalone)").matches
    || Boolean((navigator as NavigatorWithStandalone).standalone);
}

function sameApplicationServerKey(subscription: PushSubscription, publicKey: string) {
  const currentKey = subscription.options.applicationServerKey;
  if (!currentKey) return false;
  const actual = new Uint8Array(currentKey);
  const expected = decodeApplicationServerKey(publicKey);
  return actual.length === expected.length && actual.every((byte, index) => byte === expected[index]);
}

async function readError(response: Response) {
  try {
    const payload = await response.json() as { error?: string; message?: string };
    return payload.error || payload.message || `Error ${response.status}`;
  } catch {
    return `Error ${response.status}`;
  }
}

export function PushNotificationsBootstrap() {
  const [state, setState] = useState<PushState>("loading");
  const [panelOpen, setPanelOpen] = useState(false);
  const [message, setMessage] = useState("");
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const subscriptionRef = useRef<PushSubscription | null>(null);

  const syncSubscription = useCallback(async (requestPermission: boolean) => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("unsupported");
      return;
    }
    if (isIosDevice() && !isStandaloneDisplay()) {
      setState("install-required");
      setPanelOpen(true);
      return;
    }

    setState("subscribing");
    setMessage("");
    const registration = registrationRef.current
      ?? await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    registrationRef.current = registration;
    await navigator.serviceWorker.ready;

    let permission = Notification.permission;
    if (permission === "default" && requestPermission) {
      permission = await Notification.requestPermission();
    }
    if (permission === "default") {
      setState("prompt");
      setPanelOpen(true);
      return;
    }
    if (permission !== "granted") {
      setState("denied");
      setPanelOpen(true);
      return;
    }

    const configResponse = await fetch("/api/push/config", {
      credentials: "include",
      cache: "no-store",
    });
    if (!configResponse.ok) throw new Error(await readError(configResponse));
    const config = await configResponse.json() as PushConfig;
    if (!config.enabled || !config.publicKey) {
      setState("server-unavailable");
      setPanelOpen(true);
      return;
    }

    let subscription = await registration.pushManager.getSubscription();
    if (subscription && !sameApplicationServerKey(subscription, config.publicKey)) {
      await subscription.unsubscribe();
      subscription = null;
    }
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeApplicationServerKey(config.publicKey),
      });
    }

    const subscribeResponse = await fetch("/api/push/subscribe", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });
    if (!subscribeResponse.ok) throw new Error(await readError(subscribeResponse));

    subscriptionRef.current = subscription;
    setState("active");
    setPanelOpen(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      try {
        if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
          if (!cancelled) setState("unsupported");
          return;
        }
        if (isIosDevice() && !isStandaloneDisplay()) {
          if (!cancelled) {
            setState("install-required");
            setPanelOpen(true);
          }
          return;
        }
        registrationRef.current = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        if (Notification.permission === "granted") {
          await syncSubscription(false);
        } else if (!cancelled) {
          setState(Notification.permission === "denied" ? "denied" : "prompt");
          setPanelOpen(Notification.permission !== "denied");
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : "No fue posible configurar las notificaciones.");
          setState("error");
          setPanelOpen(true);
        }
      }
    };
    void initialize();
    const onFocus = () => {
      if (!cancelled && Notification.permission === "granted") {
        void syncSubscription(false).catch(() => undefined);
      }
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [syncSubscription]);

  const activate = async () => {
    try {
      await syncSubscription(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible activar las notificaciones.");
      setState("error");
      setPanelOpen(true);
    }
  };

  const sendTest = async () => {
    try {
      setMessage("Enviando prueba…");
      const subscription = subscriptionRef.current
        ?? await registrationRef.current?.pushManager.getSubscription();
      if (!subscription) throw new Error("No se encontró la suscripción de este dispositivo.");
      const response = await fetch("/api/push/test", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      if (!response.ok) throw new Error(await readError(response));
      setMessage("Prueba enviada. Debe aparecer como notificación del sistema.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "La prueba no pudo enviarse.");
    }
  };

  const deactivate = async () => {
    try {
      const subscription = subscriptionRef.current
        ?? await registrationRef.current?.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      subscriptionRef.current = null;
      setMessage("Notificaciones desactivadas en este dispositivo.");
      setState("prompt");
      setPanelOpen(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible desactivar las notificaciones.");
    }
  };

  if (state === "loading" || state === "unsupported") return null;

  if (!panelOpen) {
    return (
      <button className="pushNotificationsFab" type="button" onClick={() => setPanelOpen(true)} aria-label="Administrar notificaciones">
        <span aria-hidden="true">🔔</span>
      </button>
    );
  }

  return (
    <aside className="pushNotificationsPanel" aria-live="polite">
      <button className="pushNotificationsClose" type="button" onClick={() => setPanelOpen(false)} aria-label="Cerrar">×</button>
      <strong>Notificaciones de PSCV Room</strong>

      {state === "install-required" && (
        <p>En iPhone o iPad, abre Compartir, selecciona “Agregar a inicio” y después abre PSCV Room desde el nuevo icono.</p>
      )}
      {state === "prompt" && (
        <>
          <p>Recibe recordatorios de eventos y tareas aunque la aplicación esté cerrada.</p>
          <button className="pushNotificationsPrimary" type="button" onClick={activate}>Activar notificaciones</button>
        </>
      )}
      {state === "subscribing" && <p>Configurando este dispositivo…</p>}
      {state === "active" && (
        <>
          <p>Las notificaciones están activas en este dispositivo.</p>
          <div className="pushNotificationsActions">
            <button className="pushNotificationsPrimary" type="button" onClick={sendTest}>Enviar prueba</button>
            <button type="button" onClick={deactivate}>Desactivar</button>
          </div>
        </>
      )}
      {state === "denied" && (
        <p>El permiso está bloqueado. Actívalo desde los ajustes de notificaciones del sistema o del navegador y vuelve a abrir PSCV Room.</p>
      )}
      {state === "server-unavailable" && (
        <p>El servidor todavía no tiene configurada la clave privada VAPID. La aplicación puede instalarse, pero no enviar notificaciones.</p>
      )}
      {state === "error" && (
        <button className="pushNotificationsPrimary" type="button" onClick={activate}>Reintentar</button>
      )}
      {message && <p className="pushNotificationsMessage">{message}</p>}
    </aside>
  );
}
