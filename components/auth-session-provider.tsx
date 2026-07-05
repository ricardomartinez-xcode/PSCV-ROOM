"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { toProfile, type Profile } from "@/lib/app-data";

type AccessIdentity = {
  email: string;
};

type SessionPayload = {
  authenticated?: boolean;
  identity?: AccessIdentity;
  profile?: Record<string, unknown>;
  error?: string;
};

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

export function AuthSessionProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [identity, setIdentity] = useState<AccessIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);

  const clearSession = useCallback(() => {
    setProfile(null);
    setIdentity(null);
    setError(null);
    setStatus(null);
    setLoading(false);
  }, []);

  const refreshSession = useCallback(async () => {
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS);
    try {
      const response = await fetch("/api/auth/session", {
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as SessionPayload;
      setStatus(response.status);

      if (!response.ok || !payload.profile || !payload.identity?.email) {
        setProfile(null);
        setIdentity(null);
        setError(payload.error ?? "No se pudo validar tu sesión.");
        return;
      }

      setProfile(toProfile(payload.profile));
      setIdentity({ email: payload.identity.email });
    } catch (sessionError) {
      setProfile(null);
      setIdentity(null);
      setStatus(null);
      const timedOut = sessionError instanceof DOMException && sessionError.name === "AbortError";
      setError(
        timedOut
          ? "La comprobación de Cloudflare Access tardó demasiado. Confirma que app.rlead.xyz apunta al Worker pscv-room."
          : sessionError instanceof Error ? sessionError.message : "No se pudo validar tu sesión.",
      );
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const value = useMemo<AuthSessionContextValue>(() => ({
    profile,
    identity,
    loading,
    error,
    status,
    refreshSession,
    clearSession,
  }), [profile, identity, loading, error, status, refreshSession, clearSession]);

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

export function useAuthSession() {
  const value = useContext(AuthSessionContext);
  if (!value) throw new Error("useAuthSession must be used within AuthSessionProvider");
  return value;
}
