"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toProfile, type Profile } from "@/lib/app-data";

type AccessIdentity = { email: string };
type SessionPayload = { authenticated?: boolean; identity?: AccessIdentity; profile?: Record<string, unknown>; error?: string };
type CachedSession = { profile: Profile; identity: AccessIdentity };
type AuthSessionContextValue = {
  profile: Profile | null;
  identity: AccessIdentity | null;
  loading: boolean;
  error: string | null;
  status: number | null;
  refreshSession: () => Promise<void>;
  clearSession: () => void;
};

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);
const SESSION_TIMEOUT_MS = 12_000;
const LAST_SESSION_KEY = "pscv:auth:last-session:v1";
const SESSION_TIMEOUT_MESSAGE = "La comprobación de Cloudflare Access tardó demasiado. Confirma que app.rlead.xyz apunta al Worker pscv-room.";

function readCachedSession(): CachedSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(LAST_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSession;
    return parsed?.profile?.id && parsed?.identity?.email ? parsed : null;
  } catch {
    return null;
  }
}

function writeCachedSession(session: CachedSession | null) {
  if (typeof window === "undefined") return;
  try {
    if (session) window.sessionStorage.setItem(LAST_SESSION_KEY, JSON.stringify(session));
    else window.sessionStorage.removeItem(LAST_SESSION_KEY);
  } catch {
    // Cache de resiliencia; Cloudflare Access sigue siendo la fuente de verdad.
  }
}

export function AuthSessionProvider({ children }: { children: React.ReactNode }) {
  const [initialSession] = useState<CachedSession | null>(() => readCachedSession());
  const [profile, setProfile] = useState<Profile | null>(() => initialSession?.profile ?? null);
  const [identity, setIdentity] = useState<AccessIdentity | null>(() => initialSession?.identity ?? null);
  const [loading, setLoading] = useState(() => !initialSession);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const profileRef = useRef<Profile | null>(initialSession?.profile ?? null);

  useEffect(() => { profileRef.current = profile; }, [profile]);

  const clearSession = useCallback(() => {
    writeCachedSession(null);
    profileRef.current = null;
    setProfile(null);
    setIdentity(null);
    setError(null);
    setStatus(null);
    setLoading(false);
  }, []);

  const keepExistingSession = useCallback((message?: string) => {
    if (!profileRef.current) return false;
    setLoading(false);
    setError(message ?? null);
    return true;
  }, []);

  const refreshSession = useCallback(async () => {
    if (!profileRef.current) setLoading(true);
    setError(null);
    const controller = new AbortController();
    let timedOut = false;
    let settled = false;

    const timeout = window.setTimeout(() => {
      if (settled) return;
      timedOut = true;
      controller.abort();
      if (!keepExistingSession()) {
        setStatus(null);
        setError(SESSION_TIMEOUT_MESSAGE);
        setLoading(false);
      }
    }, SESSION_TIMEOUT_MS);

    try {
      const response = await fetch("/api/auth/session", { credentials: "include", cache: "no-store", signal: controller.signal });
      if (timedOut) return;
      const payload = (await response.json().catch(() => ({}))) as SessionPayload;
      setStatus(response.status);

      if (response.status === 401 || response.status === 403) {
        writeCachedSession(null);
        profileRef.current = null;
        setProfile(null);
        setIdentity(null);
        setError(payload.error ?? "Tu sesión institucional ya no está autorizada.");
        setLoading(false);
        return;
      }

      if (!response.ok || !payload.profile || !payload.identity?.email) {
        if (!keepExistingSession()) {
          setProfile(null);
          setIdentity(null);
          setError(payload.error ?? "No se pudo validar tu sesión.");
        }
        return;
      }

      const nextProfile = toProfile(payload.profile);
      const nextIdentity = { email: payload.identity.email };
      profileRef.current = nextProfile;
      setProfile(nextProfile);
      setIdentity(nextIdentity);
      writeCachedSession({ profile: nextProfile, identity: nextIdentity });
      setError(null);
    } catch (sessionError) {
      if (timedOut) return;
      if (!keepExistingSession()) {
        setStatus(null);
        setError(sessionError instanceof Error ? sessionError.message : "No se pudo validar tu sesión.");
      }
    } finally {
      settled = true;
      window.clearTimeout(timeout);
      if (!timedOut) setLoading(false);
    }
  }, [keepExistingSession]);

  useEffect(() => { void refreshSession(); }, [refreshSession]);

  const value = useMemo<AuthSessionContextValue>(() => ({
    profile, identity, loading, error, status, refreshSession, clearSession,
  }), [profile, identity, loading, error, status, refreshSession, clearSession]);

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

export function useAuthSession() {
  const value = useContext(AuthSessionContext);
  if (!value) throw new Error("useAuthSession must be used within AuthSessionProvider");
  return value;
}
