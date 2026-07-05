"use client";

import type { ReactNode } from "react";
import { useAuthSession } from "@/components/auth-session-provider";

type AuthGateProps = {
  children: ReactNode;
};

type SessionErrorPayload = {
  error?: string;
};

function getSessionErrorMessage(status: number, payload: SessionErrorPayload) {
  if (payload.error) return payload.error;

  if (status === 401) {
    return "Cloudflare Access no entregó una sesión para esta aplicación. Vuelve a iniciar el acceso institucional.";
  }

  if (status === 403) {
    return "Tu cuenta inició sesión, pero no tiene un perfil activo autorizado en PSCV Room.";
  }

  if (status === 404) {
    return "No se encontró el endpoint de sesión. Verifica que el dominio se esté sirviendo desde el Worker pscv-room.";
  }

  return "No se pudo validar tu sesión institucional.";
}

export function AuthGate({ children }: AuthGateProps) {
  const { profile, loading, error, status, refreshSession } = useAuthSession();
  const message = status ? getSessionErrorMessage(status, { error: error ?? undefined }) : error;

  function retrySessionCheck() {
    void refreshSession();
  }

  function restartAccess() {
    window.location.assign(window.location.href);
  }

  if (loading) {
    return (
      <main className="loginScreen authPage" aria-busy="true" aria-live="polite">
        <section className="loginCard authCard authCardSimple authStatusCard">
          <img src="/icon.svg" className="authLogoMain" alt="PSCV Room" />
          <h1 className="authTitle">Verificando acceso institucional</h1>
          <p>Estamos comprobando tu sesión segura antes de abrir PSCV Room.</p>
          <div className="loader" aria-hidden="true" />
        </section>
      </main>
    );
  }

  if (profile) {
    return <>{children}</>;
  }

  return (
    <main className="loginScreen authPage">
      <section className="loginCard authCard authCardSimple">
        <img src="/icon.svg" className="authLogoMain" alt="PSCV Room" />
        <h1 className="authTitle">Acceso no disponible</h1>
        <p>PSCV Room protege el acceso institucional mediante Cloudflare Access.</p>
        {message ? (
          <p className="authError" role="alert">
            {message}
          </p>
        ) : null}
        <div className="authActions">
          <button className="microsoftButton" onClick={restartAccess} type="button">
            Volver a iniciar acceso
          </button>
          <button className="authSecondaryButton" onClick={retrySessionCheck} type="button">
            Reintentar comprobación
          </button>
        </div>
      </section>
    </main>
  );
}
