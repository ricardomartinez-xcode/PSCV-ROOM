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

type PushConfig = {
  enabled?: boolean;
  publicKey?: string | null;
  workerVersion?: string | null;
};

type StartupStage =
  | "environment-check"
  | "registerServiceWorker"
  | "serviceWorker.ready"
  | "GET /api/push/config"
  | "PushManager.getSubscription"
  | "PushSubscription.unsubscribe"
  | "PushManager.subscribe"
  | "POST /api/push/subscribe"
  | "ready";

type StartupDiagnostic = {
  stage: StartupStage;
  name: string;
  message: string;
  stack: string | null;
  browser: string;
  workerVersion: string | null;
};
type NavigatorWithStandalone = Navigator & { standalone?: boolean };
const IOS_INSTALL_MESSAGE = "En iPhone o iPad, abre Safari, usa Compartir > Agregar a pantalla de inicio y entra desde ese icono.";

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
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandaloneDisplay() {
  return window.matchMedia("(display-mode: standalone)").matches
    || Boolean((navigator as NavigatorWithStandalone).standalone);
}

function supportsPush() {
  return window.isSecureContext
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

function registerServiceWorker() {
  return navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
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
  const [stage, setStage] = useState<StartupStage>("environment-check");
  const [diagnostic, setDiagnostic] = useState<StartupDiagnostic | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const stageRef = useRef<StartupStage>("environment-check");
  const workerVersionRef = useRef<string | null>(null);

  const updateStage = useCallback((nextStage: StartupStage) => {
    stageRef.current = nextStage;
    setStage(nextStage);
  }, []);

  const failStartup = useCallback((error: unknown) => {
    const normalized = error instanceof Error ? error : new Error(String(error));
    setMessage(normalized.message || "No fue posible configurar Web Push.");
    setDiagnostic({
      stage: stageRef.current,
      name: normalized.name || "Error",
      message: normalized.message || "No fue posible configurar Web Push.",
      stack: normalized.stack ?? null,
      browser: navigator.userAgent,
      workerVersion: workerVersionRef.current,
    });
    setState("error");
  }, []);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const subscriptionRef = useRef<PushSubscription | null>(null);
  const syncPromiseRef = useRef<Promise<void> | null>(null);

  const syncSubscription = useCallback(async () => {
    if (syncPromiseRef.current) return syncPromiseRef.current;

    const syncPromise = (async () => {
      if (isIosDevice() && !isStandaloneDisplay()) {
        setMessage(IOS_INSTALL_MESSAGE);
        setState("install-required");
        return;
      }
      if (!supportsPush()) {
        setMessage(window.isSecureContext
          ? "Este navegador no admite Web Push."
          : "Las notificaciones requieren una conexión HTTPS segura.");
        setState("unsupported");
        return;
      }
      if (Notification.permission === "default") {
        setMessage("");
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
      setDiagnostic(null);
      updateStage("registerServiceWorker");
      const registration = registrationRef.current ?? await registerServiceWorker();
      registrationRef.current = registration;
      updateStage("serviceWorker.ready");
      await navigator.serviceWorker.ready;

      updateStage("GET /api/push/config");
      const configResponse = await fetch("/api/push/config", {
        mode: "same-origin",
        credentials: "include",
        cache: "no-store",
        redirect: "error",
        headers: { Accept: "application/json" },
      });
      if (!configResponse.ok) throw new Error(await readError(configResponse));
      const config = await configResponse.json() as PushConfig;
      workerVersionRef.current = config.workerVersion ?? null;
      if (!config.enabled || !config.publicKey) {
        setMessage("El servidor todavía no tiene disponible la configuración Web Push.");
        setState("server-unavailable");
        return;
      }

      updateStage("PushManager.getSubscription");
      let subscription = await registration.pushManager.getSubscription();
      if (subscription && !sameApplicationServerKey(subscription, config.publicKey)) {
        updateStage("PushSubscription.unsubscribe");
        await subscription.unsubscribe();
        subscription = null;
      }
      if (!subscription) {
        updateStage("PushManager.subscribe");
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeApplicationServerKey(config.publicKey),
        });
      }

      updateStage("POST /api/push/subscribe");
      const subscribeResponse = await fetch("/api/push/subscribe", {
        method: "POST",
        mode: "same-origin",
        credentials: "include",
        cache: "no-store",
        redirect: "error",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!subscribeResponse.ok) throw new Error(await readError(subscribeResponse));

      subscriptionRef.current = subscription;
      updateStage("ready");
      setDiagnostic(null);
      setMessage("");
      setState("active");
    })();

    syncPromiseRef.current = syncPromise;
    try {
      await syncPromise;
    } finally {
      if (syncPromiseRef.current === syncPromise) syncPromiseRef.current = null;
    }
  }, [updateStage]);

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      try {
        if (isIosDevice() && !isStandaloneDisplay()) {
          if (!cancelled) {
            setMessage(IOS_INSTALL_MESSAGE);
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
        updateStage("registerServiceWorker");
        registrationRef.current = await registerServiceWorker();
        if (Notification.permission === "granted") {
          await syncSubscription();
        } else if (!cancelled) {
          setState(Notification.permission === "denied" ? "denied" : "prompt");
        }
      } catch (error) {
        if (!cancelled) {
          failStartup(error);
        }
      }
    };

    void initialize();

    const refreshPermission = () => {
      if (cancelled || !supportsPush()) return;
      if (Notification.permission === "granted") {
        void syncSubscription().catch((error: unknown) => {
          if (cancelled) return;
          failStartup(error);
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
  }, [failStartup, retryToken, syncSubscription, updateStage]);

  const activate = useCallback(async () => {
    try {
      if (isIosDevice() && !isStandaloneDisplay()) {
        setMessage(IOS_INSTALL_MESSAGE);
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
      failStartup(error);
    }
  }, [failStartup, syncSubscription]);

  const sendTest = useCallback(async () => {
    try {
      setMessage("Enviando prueba…");
      const subscription = subscriptionRef.current
        ?? await registrationRef.current?.pushManager.getSubscription();
      if (!subscription) throw new Error("No se encontró la suscripción de este dispositivo.");
      const response = await fetch("/api/push/test", {
        method: "POST",
        mode: "same-origin",
        credentials: "include",
        cache: "no-store",
        redirect: "error",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
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
          mode: "same-origin",
          credentials: "include",
          cache: "no-store",
          redirect: "error",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
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

  if (state !== "active") {
    const isFailure = state === "error" || state === "server-unavailable";
    return (
      <main
        role={isFailure ? "alert" : "status"}
        aria-live={isFailure ? "assertive" : "polite"}
        style={{
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          background: "#f5f5f5",
          color: "#111",
          fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        }}
      >
        <section style={{ width: "min(100%, 760px)", background: "#fff", border: "1px solid #d7d7d7", borderRadius: 16, padding: 24 }}>
          <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}>
            PSCV Room · Web Push
          </p>
          <h1 style={{ margin: "0 0 12px", fontSize: "clamp(24px, 5vw, 40px)", lineHeight: 1.05 }}>
            {isFailure ? "La aplicación no puede iniciar" : "Preparando notificaciones"}
          </h1>
          <p style={{ margin: "0 0 20px", lineHeight: 1.5 }}>
            {message || `Etapa actual: ${stage}`}
          </p>

          {state === "prompt" && (
            <button type="button" onClick={() => void activate()} style={{ minHeight: 44, padding: "10px 16px", borderRadius: 10, border: "1px solid #111", background: "#111", color: "#fff", fontWeight: 700 }}>
              Activar notificaciones y continuar
            </button>
          )}

          {(state === "install-required" || state === "denied" || state === "unsupported") && (
            <div style={{ padding: 16, border: "1px solid #d7d7d7", borderRadius: 12, background: "#fafafa" }}>
              <strong>Acción requerida</strong>
              <p style={{ margin: "8px 0 0", lineHeight: 1.5 }}>{message}</p>
            </div>
          )}

          {diagnostic && (
            <details open style={{ marginTop: 20 }}>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>Diagnóstico técnico</summary>
              <dl style={{ display: "grid", gridTemplateColumns: "minmax(120px, 180px) 1fr", gap: "8px 16px", marginTop: 16, overflowWrap: "anywhere" }}>
                <dt>Etapa</dt><dd style={{ margin: 0 }}><code>{diagnostic.stage}</code></dd>
                <dt>Error</dt><dd style={{ margin: 0 }}><code>{diagnostic.name}</code></dd>
                <dt>Mensaje</dt><dd style={{ margin: 0 }}>{diagnostic.message}</dd>
                <dt>Worker</dt><dd style={{ margin: 0 }}><code>{diagnostic.workerVersion ?? "desconocida"}</code></dd>
                <dt>Navegador</dt><dd style={{ margin: 0 }}><code>{diagnostic.browser}</code></dd>
              </dl>
              {diagnostic.stack && <pre style={{ marginTop: 16, padding: 16, overflow: "auto", whiteSpace: "pre-wrap", background: "#111", color: "#fff", borderRadius: 12, fontSize: 12 }}>{diagnostic.stack}</pre>}
              <button type="button" onClick={() => { setDiagnostic(null); setMessage(""); setState("loading"); setRetryToken((value) => value + 1); }} style={{ minHeight: 44, marginTop: 16, padding: "10px 16px", borderRadius: 10, border: "1px solid #111", background: "#fff", color: "#111", fontWeight: 700 }}>
                Reintentar inicialización
              </button>
            </details>
          )}
        </section>
      </main>
    );
  }

  return (
    <PushNotificationsContext.Provider value={value}>
      {children}
    </PushNotificationsContext.Provider>
  );
}
