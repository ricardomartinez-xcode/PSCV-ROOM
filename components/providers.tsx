"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AuthSessionProvider } from "@/components/auth-session-provider";
import styles from "./notification-delivery.module.css";

type AppNotification = {
  id: string;
  title: string;
  body: string;
  priority: "low" | "normal" | "high";
};
type RemotePreferences = {
  email_enabled: boolean;
} | null;
type LocalPreferences = {
  browserEnabled: boolean;
  soundEnabled: boolean;
};
type NotificationPayload = {
  profileId?: string;
  notifications?: AppNotification[];
  preferences?: RemotePreferences;
  error?: string;
};
type NotificationDeliveryContextValue = {
  ready: boolean;
  preferences: RemotePreferences;
  localPreferences: LocalPreferences;
  permission: NotificationPermission | "unsupported";
  message: string | null;
  emailBusy: boolean;
  setBrowserEnabled: (enabled: boolean) => void;
  setSoundEnabled: (enabled: boolean) => void;
  requestBrowserPermission: () => Promise<void>;
  updateEmailPreference: (emailEnabled: boolean) => Promise<void>;
};

const NotificationDeliveryContext = createContext<NotificationDeliveryContextValue | null>(null);

const DEFAULT_LOCAL_PREFERENCES: LocalPreferences = {
  browserEnabled: false,
  soundEnabled: true,
};

function storageKey(profileId: string) {
  return `pscv:notification-delivery:${profileId}`;
}

function readLocalPreferences(profileId: string): LocalPreferences {
  try {
    const value = window.localStorage.getItem(storageKey(profileId));
    if (!value) return DEFAULT_LOCAL_PREFERENCES;
    const parsed = JSON.parse(value) as Partial<LocalPreferences>;
    return {
      browserEnabled: Boolean(parsed.browserEnabled),
      soundEnabled: parsed.soundEnabled !== false,
    };
  } catch {
    return DEFAULT_LOCAL_PREFERENCES;
  }
}

function writeLocalPreferences(profileId: string, preferences: LocalPreferences) {
  try {
    window.localStorage.setItem(storageKey(profileId), JSON.stringify(preferences));
  } catch {
    // Local delivery preferences are optional and must not block the app.
  }
}

export function useNotificationDelivery() {
  return useContext(NotificationDeliveryContext);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [preferences, setPreferences] = useState<RemotePreferences>(null);
  const [localPreferences, setLocalPreferences] = useState<LocalPreferences>(DEFAULT_LOCAL_PREFERENCES);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [message, setMessage] = useState<string | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);
  const profileIdRef = useRef<string | null>(null);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const localPreferencesRef = useRef<LocalPreferences>(DEFAULT_LOCAL_PREFERENCES);
  const permissionRef = useRef<NotificationPermission | "unsupported">("default");
  const interactedRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setPermission("unsupported");
      permissionRef.current = "unsupported";
      return;
    }
    setPermission(window.Notification.permission);
    permissionRef.current = window.Notification.permission;
  }, []);

  const playTone = useCallback(() => {
    if (!interactedRef.current || !localPreferencesRef.current.soundEnabled) return;
    try {
      const context = audioContextRef.current ?? new AudioContext();
      audioContextRef.current = context;
      if (context.state === "suspended") void context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(740, context.currentTime);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.07, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.2);
    } catch {
      // Browser audio is optional and may be blocked until a user interaction.
    }
  }, []);

  const poll = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications", {
        credentials: "include",
        cache: "no-store",
      });
      if (response.status === 401 || response.status === 403) {
        setReady(false);
        initializedRef.current = false;
        knownIdsRef.current.clear();
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as NotificationPayload;
      if (!response.ok || !payload.profileId) return;

      if (profileIdRef.current !== payload.profileId) {
        profileIdRef.current = payload.profileId;
        knownIdsRef.current.clear();
        initializedRef.current = false;
        const stored = readLocalPreferences(payload.profileId);
        localPreferencesRef.current = stored;
        setLocalPreferences(stored);
      }

      setReady(true);
      setPreferences(payload.preferences ?? null);
      const notifications = payload.notifications ?? [];

      if (!initializedRef.current) {
        notifications.forEach((notification) => knownIdsRef.current.add(notification.id));
        initializedRef.current = true;
        return;
      }

      const fresh = notifications.filter((notification) => !knownIdsRef.current.has(notification.id));
      if (!fresh.length) return;
      fresh.forEach((notification) => knownIdsRef.current.add(notification.id));
      window.dispatchEvent(new CustomEvent("pscv:notifications-changed"));

      const local = localPreferencesRef.current;
      if (!local.browserEnabled || permissionRef.current !== "granted") return;

      if (document.visibilityState === "hidden") {
        fresh.slice(0, 3).forEach((notification) => {
          try {
            new window.Notification(notification.title, {
              body: notification.body || "Tienes un aviso nuevo en PSCV Room.",
              icon: "/icon.svg",
              tag: `pscv-${notification.id}`,
            });
          } catch {
            // The browser can reject a native notification even after permission was granted.
          }
        });
      }
      playTone();
    } catch {
      // Polling is best effort. The in-app notification center remains available.
    }
  }, [playTone]);

  useEffect(() => {
    void poll();
    const interval = window.setInterval(() => void poll(), 30000);
    const refresh = () => void poll();
    window.addEventListener("focus", refresh);
    window.addEventListener("pscv:notifications-changed", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pscv:notifications-changed", refresh);
    };
  }, [poll]);

  const updateLocalPreferences = useCallback((patch: Partial<LocalPreferences>) => {
    if (!profileIdRef.current) return;
    const next = { ...localPreferencesRef.current, ...patch };
    localPreferencesRef.current = next;
    setLocalPreferences(next);
    writeLocalPreferences(profileIdRef.current, next);
  }, []);

  const requestBrowserPermission = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setMessage("Este navegador no admite notificaciones nativas.");
      return;
    }

    interactedRef.current = true;
    try {
      const context = audioContextRef.current ?? new AudioContext();
      audioContextRef.current = context;
      if (context.state === "suspended") await context.resume();
    } catch {
      // Permission can still be granted even if audio is unavailable.
    }

    const nextPermission = await window.Notification.requestPermission();
    setPermission(nextPermission);
    permissionRef.current = nextPermission;
    if (nextPermission === "granted") {
      updateLocalPreferences({ browserEnabled: true });
      setMessage("Avisos del navegador activados.");
    } else {
      setMessage("El permiso no fue concedido. Puedes cambiarlo desde la configuración del navegador.");
    }
  }, [updateLocalPreferences]);

  const updateEmailPreference = useCallback(async (emailEnabled: boolean) => {
    setEmailBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/notifications", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailEnabled }),
      });
      const payload = (await response.json().catch(() => ({}))) as { preferences?: RemotePreferences; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No se pudo actualizar la preferencia de correo.");
      setPreferences(payload.preferences ?? { email_enabled: emailEnabled });
      setMessage(emailEnabled ? "Correo para anuncios activado." : "Correo para anuncios desactivado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo actualizar la preferencia de correo.");
    } finally {
      setEmailBusy(false);
    }
  }, []);

  const delivery = useMemo<NotificationDeliveryContextValue>(() => ({
    ready,
    preferences,
    localPreferences,
    permission,
    message,
    emailBusy,
    setBrowserEnabled: (enabled) => updateLocalPreferences({ browserEnabled: enabled }),
    setSoundEnabled: (enabled) => {
      interactedRef.current = true;
      updateLocalPreferences({ soundEnabled: enabled });
    },
    requestBrowserPermission,
    updateEmailPreference,
  }), [ready, preferences, localPreferences, permission, message, emailBusy, updateLocalPreferences, requestBrowserPermission, updateEmailPreference]);

  return (
    <AuthSessionProvider>
      <NotificationDeliveryContext.Provider value={delivery}>
        {children}
      </NotificationDeliveryContext.Provider>
    </AuthSessionProvider>
  );
}

export function NotificationSettingsPanel() {
  const delivery = useNotificationDelivery();

  if (!delivery) {
    return (
      <div className={styles.settingsPanel}>
        <p className={styles.message}>La configuración de avisos estará disponible cuando termine de cargar tu sesión.</p>
      </div>
    );
  }

  const { preferences, localPreferences, permission, message, emailBusy } = delivery;
  const controlsDisabled = !delivery.ready;

  return (
    <div className={styles.settingsPanel}>
      <div className={styles.setting}>
        <div>
          <strong>Navegador</strong>
          <small>Notificación nativa cuando PSCV Room está abierto.</small>
        </div>
        {permission === "granted" ? (
          <label className={styles.toggle} title="Notificaciones del navegador">
            <input
              type="checkbox"
              aria-label="Activar notificaciones del navegador"
              checked={localPreferences.browserEnabled}
              onChange={(event) => delivery.setBrowserEnabled(event.target.checked)}
              disabled={controlsDisabled}
            />
            <span />
          </label>
        ) : (
          <button
            type="button"
            className={styles.enableButton}
            onClick={() => void delivery.requestBrowserPermission()}
            disabled={controlsDisabled || permission === "unsupported"}
            aria-label="Activar notificaciones del navegador"
            title="Activar notificaciones del navegador"
          >
            {permission === "unsupported" ? "No disponible" : "Activar"}
          </button>
        )}
      </div>

      <div className={styles.setting}>
        <div>
          <strong>Sonido</strong>
          <small>Un tono breve al llegar un aviso nuevo.</small>
        </div>
        <label className={styles.toggle} title="Sonido de avisos">
          <input
            type="checkbox"
            aria-label="Activar sonido de avisos"
            checked={localPreferences.soundEnabled}
            onChange={(event) => delivery.setSoundEnabled(event.target.checked)}
            disabled={controlsDisabled || !localPreferences.browserEnabled}
          />
          <span />
        </label>
      </div>

      <div className={styles.setting}>
        <div>
          <strong>Correo</strong>
          <small>Recibe por email los anuncios que publiques.</small>
        </div>
        <label className={styles.toggle} title="Avisos por correo">
          <input
            type="checkbox"
            aria-label="Activar avisos por correo"
            checked={Boolean(preferences?.email_enabled)}
            onChange={(event) => void delivery.updateEmailPreference(event.target.checked)}
            disabled={controlsDisabled || emailBusy}
          />
          <span />
        </label>
      </div>

      {controlsDisabled ? <p className={styles.message}>La configuración se habilitará cuando termine de cargar tu sesión.</p> : null}
      {message ? <p className={styles.message}>{message}</p> : null}
    </div>
  );
}
