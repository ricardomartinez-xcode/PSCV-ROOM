const COOKIE_NAME = "__Host-pscv_session";
// Browsers cap persistent cookies at 400 days. Renew on verified session checks.
const COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

function tokenFromRequest(request: Request): string | null {
  const matches = (request.headers.get("cookie") ?? "").split(";")
    .map((part) => part.trim()).filter((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(COOKIE_NAME.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}

function sessionCookie(token: string, maxAge = COOKIE_MAX_AGE) {
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

async function digest(token: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createPersistentSession(db: D1Database, profileId: string, subject: string) {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  await db.prepare("INSERT INTO app_sessions (token_hash, profile_id, access_subject) VALUES (?, ?, ?)")
    .bind(await digest(token), profileId, subject).run();
  return sessionCookie(token);
}

export async function readPersistentIdentity(db: D1Database, request: Request): Promise<{ email: string; subject: string } | null> {
  const token = tokenFromRequest(request);
  if (!token) return null;
  // Do not cache this lookup: logout must invalidate replay on every Worker.
  return db.prepare(`SELECT lower(trim(p.email)) AS email, s.access_subject AS subject
    FROM app_sessions s JOIN app_profiles p ON p.id = s.profile_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND p.active = 1 LIMIT 1`)
    .bind(await digest(token)).first<{ email: string; subject: string }>();
}

export function renewedSessionCookie(request: Request) {
  const token = tokenFromRequest(request);
  return token ? sessionCookie(token) : null;
}

export async function revokePersistentSession(db: D1Database, request: Request) {
  const token = tokenFromRequest(request);
  if (token) {
    await db.prepare("UPDATE app_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND revoked_at IS NULL")
      .bind(await digest(token)).run();
  }
  return sessionCookie("", 0);
}
