"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type PushState =
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

type PushNotificationsContextValue = {
  state: PushState;
  message: string;
  activate: () => Promise<void>;
  sendTest: () => Promise<void>;
  deactivate: () => Promise<void>;
};

const PushNotificationsContext = createContext<PushNotificationsContextValue | null>(null);

export function usePushNotifications() {
  return useContext(PushNotificationsContext);
}

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

function supportsPush() {
  return "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

function sameApplicationServerKey(subscription: PushSubscription, publicKey: string) {
  const currentKey = subscription.options.applicationServerKey;
  if (!currentKey) return true;
  const actual = new Uint8Array(currentKey);
  const expected = decodeApplicationServerKey(publicKey);
  return actual.length === expected.length
    && actual.every((byte, index) => byte === expected[index]);
}

async function readError(response: Response) {
  try {
    const payload = await response.json() as { error?: string; message?: string };
    return payload.error || payload.message || `Error ${response.status}`;
  } catch {
    return `Error ${response.status}`;
  }
}

function broadcastPermissionChange() {
  window.dispatchEvent(new CustomEvent("pscv:notification-permission-changed"));
}

export function PushNotificationsBootstrap({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PushState>("loading");
  const [message, setMessage] = useState("");
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const subscriptionRef = useRef<PushSubscription | null>(null);

  const syncSubscription = useCallback(async () => {
    if (isIosDevice() && !isStandaloneDisplay()) {
      setMessage("En iPhone o iPad, agrega PSCV Room a la pantalla de inicio y ábrelo desde ese icono.");
      setState("install-required");
      return;
    }
    if (!supportsPush()) {
      setMessage("Este navegador no admite Web Push.");
      setState("unsupported");
      return;
    }
    if (Notification.permission === "default") {
      setState("prompt");
      return;
    }
    if (Notification.permission !== "granted") {
      setMessage("El permiso de notificaciones está bloqueado en el navegador o sistema.");
      setState("denied");
      return;
    }

    setState("subscribing");
    setMessage("");
    const registration = registrationRef.current
      ?? await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    registrationRef.current = registration;
    await navigator.serviceWorker.ready;

    const configResponse = await fetch("/api/push/config", {
      credentials: "include",
      cache: "no-store",
    });
    if (!configResponse.ok) throw new Error(await readError(configResponse));
    const config = await configResponse.json() as PushConfig;
    if (!config.enabled || !config.publicKey) {
      setMessage("El servidor todavía no tiene disponible la configuración Web Push.");
      setState("server-unavailable");
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
    setMessage("");
    setState("active");
  }, []);

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      try {
        if (isIosDevice() && !isStandaloneDisplay()) {
          if (!cancelled) {
            setMessage("En iPhone o iPad, agrega PSCV Room a la pantalla de inicio y ábrelo desde ese icono.");
            setState("install-required");
          }
          return;
        }
        if (!supportsPush()) {
          if (!cancelled) {
            setMessage("Este navegador no admite Web Push.");
            setState("unsupported");
          }
          return;
        }
        registrationRef.current = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        if (Notification.permission === "granted") {
          await syncSubscription();
        } else if (!cancelled) {
          setState(Notification.permission === "denied" ? "denied" : "prompt");
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : "No fue posible configurar las notificaciones.");
          setState("error");
        }
      }
    };

    void initialize();

    const refreshPermission = () => {
      if (cancelled || !supportsPush()) return;
      if (Notification.permission === "granted") {
        void syncSubscription().catch((error: unknown) => {
          if (cancelled) return;
          setMessage(error instanceof Error ? error.message : "No fue posible configurar las notificaciones.");
          setState("error");
        });
      } else {
        setState(Notification.permission === "denied" ? "denied" : "prompt");
      }
    };

    window.addEventListener("focus", refreshPermission);
    window.addEventListener("pscv:notification-permission-changed", refreshPermission);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refreshPermission);
      window.removeEventListener("pscv:notification-permission-changed", refreshPermission);
    };
  }, [syncSubscription]);

  const activate = useCallback(async () => {
    try {
      if (isIosDevice() && !isStandaloneDisplay()) {
        setMessage("En iPhone o iPad, agrega PSCV Room a la pantalla de inicio y ábrelo desde ese icono.");
        setState("install-required");
        return;
      }
      if (!supportsPush()) {
        setMessage("Este navegador no admite Web Push.");
        setState("unsupported");
        return;
      }

      if (Notification.permission === "default") {
        const permission = await Notification.requestPermission();
        broadcastPermissionChange();
        if (permission !== "granted") {
          setState(permission === "denied" ? "denied" : "prompt");
          return;
        }
      }
      await syncSubscription();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible activar las notificaciones.");
      setState("error");
    }
  }, [syncSubscription]);

  const sendTest = useCallback(async () => {
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
  }, []);

  const deactivate = useCallback(async () => {
    try {
      const subscription = subscriptionRef.current
        ?? await registrationRef.current?.pushManager.getSubscription();
      if (subscription) {
        const response = await fetch("/api/push/subscribe", {
          method: "DELETE",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
        if (!response.ok) {
          throw new Error("Se desactivó en el navegador, pero el servidor no pudo actualizarse.");
        }
      }
      subscriptionRef.current = null;
      setMessage("Notificaciones con la app cerrada desactivadas en este dispositivo.");
      setState("prompt");
    } catch (error) {
      subscriptionRef.current = null;
      setMessage(error instanceof Error ? error.message : "No fue posible desactivar las notificaciones.");
      setState("prompt");
    }
  }, []);

  const value = useMemo<PushNotificationsContextValue>(() => ({
    state,
    message,
    activate,
    sendTest,
    deactivate,
  }), [state, message, activate, sendTest, deactivate]);

  return (
    <PushNotificationsContext.Provider value={value}>
      {children}
    </PushNotificationsContext.Provider>
  );
}
