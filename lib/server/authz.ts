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

const OWNER_EMAIL = "ricardo_mtzh@outlook.com";
const OWNER_PROFILE_ID = "owner-ricardo-outlook";
const OWNER_FULL_NAME = "Ricardo Martínez Hernández";
const accessJwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

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
  if (!teamDomain || !audience) throw new HttpError(500, "Cloudflare Access no está configurado.");

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
  if (identity.email === OWNER_EMAIL) {
    return db
      .prepare(`${PROFILE_SELECT}
        WHERE lower(trim(email)) = ?
        ORDER BY CASE WHEN lower(email) = ? THEN 0 ELSE 1 END
        LIMIT 1`)
      .bind(OWNER_EMAIL, OWNER_EMAIL)
      .first<ServerProfile>();
  }

  return db
    .prepare(`${PROFILE_SELECT}
      WHERE lower(trim(email)) = ? OR auth_user_id = ?
      ORDER BY CASE
        WHEN lower(email) = ? THEN 0
        WHEN lower(trim(email)) = ? THEN 1
        WHEN auth_user_id = ? THEN 2
        ELSE 3
      END
      LIMIT 1`)
    .bind(identity.email, identity.subject, identity.email, identity.email, identity.subject)
    .first<ServerProfile>();
}

async function ensureOwnerProfile(
  db: D1Database,
  identity: AccessIdentity,
  existingProfile: ServerProfile | null,
) {
  if (existingProfile && normalizeEmail(existingProfile.email) === OWNER_EMAIL) {
    await db
      .prepare(`UPDATE app_profiles
        SET auth_user_id = ?,
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
      .bind(identity.subject, OWNER_FULL_NAME, existingProfile.id)
      .run();
    return;
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
}

export async function requireProfileForIdentity(identity: AccessIdentity): Promise<ServerProfile> {
  const db = await getD1();
  let profile = await findProfile(db, identity);

  // The owner is a fixed, verified identity. All other users must already exist
  // as active rows in app_profiles; a matching email domain is never enough.
  if (identity.email === OWNER_EMAIL) {
    await ensureOwnerProfile(db, identity, profile);
    profile = await findProfile(db, identity);
  }

  if (!profile) throw new HttpError(403, "Perfil no encontrado o no autorizado.");
  if (!enabled(profile.active)) throw new HttpError(403, "Perfil inactivo.");
  return profile;
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

  if (!enabled(profile[grants[permission]] as number)) throw new HttpError(403, "No autorizado.");
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
