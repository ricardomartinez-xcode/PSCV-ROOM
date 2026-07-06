import { createRemoteJWKSet, jwtVerify } from "jose";
import { getCloudflareEnv, getD1 } from "@/lib/server/cloudflare";

export type Permission =
  | "tasks:edit"
  | "tasks:delete"
  | "materials:manage"
  | "users:manage"
  | "settings:manage"
  | "group:manage"
  | "notifications:manage"
  | "reports:view"
  | "r2:manage";

export type ServerProfile = {
  id: string;
  email: string;
  full_name: string;
  role: "student" | "admin" | "owner";
  active: number;
  auth_user_id: string | null;
  can_edit_tasks: number;
  can_delete_tasks: number;
  can_manage_materials: number;
  can_manage_users: number;
  can_manage_settings: number;
  can_manage_group: number;
  can_manage_notifications: number;
  can_view_reports: number;
  can_manage_r2: number;
};

export type AccessIdentity = { email: string; subject: string };

type CachedProfile = {
  profile: ServerProfile;
  expiresAt: number;
};

const OWNER_EMAIL = "ricardo_mtzh@outlook.com";
const OWNER_PROFILE_ID = "owner-ricardo-outlook";
const OWNER_FULL_NAME = "Ricardo Martínez Hernández";
const PROFILE_CACHE_TTL_MS = 15_000;
const PROFILE_CACHE_MAX_ENTRIES = 500;

const accessJwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const profileCache = new Map<string, CachedProfile>();
const profileLoads = new Map<string, Promise<ServerProfile>>();

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function enabled(value: number | boolean | null | undefined) {
  return value === 1 || value === true;
}

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function profileCacheKey(identity: AccessIdentity) {
  return `${identity.email}\u0000${identity.subject}`;
}

function getCachedProfile(key: string) {
  const cached = profileCache.get(key);
  if (!cached) return null;

  if (cached.expiresAt <= Date.now()) {
    profileCache.delete(key);
    return null;
  }

  return cached.profile;
}

function cacheProfile(key: string, profile: ServerProfile) {
  if (profileCache.size >= PROFILE_CACHE_MAX_ENTRIES && !profileCache.has(key)) {
    const oldestKey = profileCache.keys().next().value;
    if (oldestKey !== undefined) profileCache.delete(oldestKey);
  }

  profileCache.set(key, {
    profile,
    expiresAt: Date.now() + PROFILE_CACHE_TTL_MS,
  });
}

function getAccessJwks(issuer: string) {
  const cached = accessJwksByIssuer.get(issuer);
  if (cached) return cached;

  const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), {
    timeoutDuration: 5_000,
  });
  accessJwksByIssuer.set(issuer, jwks);
  return jwks;
}

export async function getCurrentIdentity(request: Request): Promise<AccessIdentity> {
  const env = await getCloudflareEnv();

  if (env.AUTH_MODE === "development") {
    if (process.env.NODE_ENV === "production" && env.ALLOW_DEV_AUTH !== "1") {
      throw new HttpError(500, "AUTH_MODE development no está permitido en producción.");
    }

    const email = normalizeEmail(env.DEV_AUTH_EMAIL);
    if (!email) throw new HttpError(401, "DEV_AUTH_EMAIL no configurado.");
    return { email, subject: `development:${email}` };
  }

  const token = request.headers.get("cf-access-jwt-assertion");
  const teamDomain = env.ACCESS_TEAM_DOMAIN?.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  const audience = env.ACCESS_AUD?.trim();

  if (!token) throw new HttpError(401, "Sesión de Cloudflare Access no encontrada.");
  if (!teamDomain || !audience) {
    throw new HttpError(500, "Cloudflare Access no está configurado.");
  }

  const issuer = `https://${teamDomain}`;
  const { payload } = await jwtVerify(token, getAccessJwks(issuer), { issuer, audience });
  const email = normalizeEmail(payload.email);
  const subject = typeof payload.sub === "string" ? payload.sub : "";

  if (!email || !subject) throw new HttpError(401, "Token de Access incompleto.");
  return { email, subject };
}

const PROFILE_SELECT = `SELECT id, email, full_name, role, active, auth_user_id,
  can_edit_tasks, can_delete_tasks, can_manage_materials, can_manage_users,
  can_manage_settings, can_manage_group, can_manage_notifications,
  can_view_reports, can_manage_r2
  FROM app_profiles`;

async function findProfile(db: D1Database, identity: AccessIdentity) {
  // app_profiles.email is UNIQUE COLLATE NOCASE. This is the normal indexed fast path.
  const exactEmailMatch = await db
    .prepare(`${PROFILE_SELECT} WHERE email = ? COLLATE NOCASE LIMIT 1`)
    .bind(identity.email)
    .first<ServerProfile>();

  if (exactEmailMatch) return exactEmailMatch;

  // Imports from legacy files can contain whitespace. Keep that compatibility as a
  // slower fallback, while allowing a stable Access subject to recover renamed mailboxes.
  const [trimmedEmailMatch, subjectMatch] = await Promise.all([
    db
      .prepare(`${PROFILE_SELECT} WHERE lower(trim(email)) = ? LIMIT 1`)
      .bind(identity.email)
      .first<ServerProfile>(),
    db
      .prepare(`${PROFILE_SELECT} WHERE auth_user_id = ? LIMIT 1`)
      .bind(identity.subject)
      .first<ServerProfile>(),
  ]);

  return trimmedEmailMatch ?? subjectMatch;
}

function ownerProfileNeedsSync(profile: ServerProfile, identity: AccessIdentity) {
  return (
    normalizeEmail(profile.email) !== OWNER_EMAIL ||
    profile.auth_user_id !== identity.subject ||
    profile.full_name !== OWNER_FULL_NAME ||
    profile.role !== "owner" ||
    !enabled(profile.active) ||
    !enabled(profile.can_edit_tasks) ||
    !enabled(profile.can_delete_tasks) ||
    !enabled(profile.can_manage_materials) ||
    !enabled(profile.can_manage_users) ||
    !enabled(profile.can_manage_settings) ||
    !enabled(profile.can_manage_group) ||
    !enabled(profile.can_manage_notifications) ||
    !enabled(profile.can_view_reports) ||
    !enabled(profile.can_manage_r2)
  );
}

function asOwnerProfile(profile: ServerProfile, identity: AccessIdentity): ServerProfile {
  return {
    ...profile,
    email: OWNER_EMAIL,
    full_name: OWNER_FULL_NAME,
    role: "owner",
    active: 1,
    auth_user_id: identity.subject,
    can_edit_tasks: 1,
    can_delete_tasks: 1,
    can_manage_materials: 1,
    can_manage_users: 1,
    can_manage_settings: 1,
    can_manage_group: 1,
    can_manage_notifications: 1,
    can_view_reports: 1,
    can_manage_r2: 1,
  };
}

async function ensureOwnerProfile(
  db: D1Database,
  identity: AccessIdentity,
  existingProfile: ServerProfile | null,
): Promise<ServerProfile | null> {
  if (existingProfile) {
    if (!ownerProfileNeedsSync(existingProfile, identity)) return existingProfile;

    await db
      .prepare(`UPDATE app_profiles
        SET email = ?,
          auth_user_id = ?,
          full_name = ?,
          role = 'owner',
          active = 1,
          can_edit_tasks = 1,
          can_delete_tasks = 1,
          can_manage_materials = 1,
          can_manage_users = 1,
          can_manage_settings = 1,
          can_manage_group = 1,
          can_manage_notifications = 1,
          can_view_reports = 1,
          can_manage_r2 = 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`)
      .bind(OWNER_EMAIL, identity.subject, OWNER_FULL_NAME, existingProfile.id)
      .run();

    return asOwnerProfile(existingProfile, identity);
  }

  await db
    .prepare(`INSERT INTO app_profiles (
      id, auth_user_id, email, full_name, role, active,
      can_edit_tasks, can_delete_tasks, can_manage_materials, can_manage_users,
      can_manage_settings, can_manage_group, can_manage_notifications,
      can_view_reports, can_manage_r2
    ) VALUES (?, ?, ?, ?, 'owner', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1)
    ON CONFLICT(email) DO UPDATE SET
      auth_user_id = excluded.auth_user_id,
      full_name = excluded.full_name,
      role = 'owner',
      active = 1,
      can_edit_tasks = 1,
      can_delete_tasks = 1,
      can_manage_materials = 1,
      can_manage_users = 1,
      can_manage_settings = 1,
      can_manage_group = 1,
      can_manage_notifications = 1,
      can_view_reports = 1,
      can_manage_r2 = 1,
      updated_at = CURRENT_TIMESTAMP`)
    .bind(OWNER_PROFILE_ID, identity.subject, OWNER_EMAIL, OWNER_FULL_NAME)
    .run();

  // A first owner login is rare. Re-read once so a concurrent bootstrap or an
  // existing record with a different primary key is returned exactly as stored.
  return null;
}

async function resolveProfileForIdentity(identity: AccessIdentity): Promise<ServerProfile> {
  const db = await getD1();
  let profile = await findProfile(db, identity);

  // The owner is a fixed, verified identity. Everyone else must already have an
  // active app_profiles row; a matching email domain is never enough.
  if (identity.email === OWNER_EMAIL) {
    const ensuredOwner = await ensureOwnerProfile(db, identity, profile);
    profile = ensuredOwner ?? (await findProfile(db, identity));
  }

  if (!profile) throw new HttpError(403, "Perfil no encontrado o no autorizado.");
  if (!enabled(profile.active)) throw new HttpError(403, "Perfil inactivo.");

  cacheProfile(profileCacheKey(identity), profile);
  return profile;
}

export async function requireProfileForIdentity(identity: AccessIdentity): Promise<ServerProfile> {
  const cacheKey = profileCacheKey(identity);
  const cached = getCachedProfile(cacheKey);
  if (cached) return cached;

  const pendingLoad = profileLoads.get(cacheKey);
  if (pendingLoad) return pendingLoad;

  const load = resolveProfileForIdentity(identity);
  profileLoads.set(cacheKey, load);

  try {
    return await load;
  } finally {
    profileLoads.delete(cacheKey);
  }
}

export async function requireProfile(request: Request): Promise<ServerProfile> {
  return requireProfileForIdentity(await getCurrentIdentity(request));
}

export async function requirePermission(request: Request, permission: Permission) {
  const profile = await requireProfile(request);
  if (profile.role === "owner") return profile;
  if (profile.role !== "admin") throw new HttpError(403, "No autorizado.");

  const grants: Record<Permission, keyof ServerProfile> = {
    "tasks:edit": "can_edit_tasks",
    "tasks:delete": "can_delete_tasks",
    "materials:manage": "can_manage_materials",
    "users:manage": "can_manage_users",
    "settings:manage": "can_manage_settings",
    "group:manage": "can_manage_group",
    "notifications:manage": "can_manage_notifications",
    "reports:view": "can_view_reports",
    "r2:manage": "can_manage_r2",
  };

  if (!enabled(profile[grants[permission]] as number)) {
    throw new HttpError(403, "No autorizado.");
  }

  return profile;
}

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  return Response.json(
    { error: error instanceof Error ? error.message : "Error inesperado." },
    { status: 500 },
  );
}
