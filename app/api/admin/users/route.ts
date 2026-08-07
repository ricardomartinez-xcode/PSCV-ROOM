import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError, invalidateProfileCache, requirePermission } from "@/lib/server/authz";
import { d1First, d1Run } from "@/lib/server/d1-data";

const CANONICAL_OWNER_EMAIL = "ricardo_mtzh@outlook.com";
const permissionKeys = [
  "can_edit_tasks",
  "can_delete_tasks",
  "can_manage_materials",
  "can_manage_users",
  "can_manage_settings",
  "can_manage_group",
  "can_manage_notifications",
  "can_view_reports",
  "can_manage_r2",
] as const;

type PermissionKey = (typeof permissionKeys)[number];

type UserRow = {
  id: string;
  email: string;
  full_name: string;
  control_number: string | null;
  role: "student" | "admin" | "owner";
  active: number;
} & Record<PermissionKey, number>;

const patchSchema = z.object({
  id: z.string().trim().min(1).max(128),
  email: z.string().trim().email().max(320).optional(),
  full_name: z.string().trim().min(2).max(120).optional(),
  control_number: z.string().trim().max(48).nullable().optional(),
  active: z.boolean().optional(),
  role: z.enum(["student", "admin", "owner"]).optional(),
  can_edit_tasks: z.boolean().optional(),
  can_delete_tasks: z.boolean().optional(),
  can_manage_materials: z.boolean().optional(),
  can_manage_users: z.boolean().optional(),
  can_manage_settings: z.boolean().optional(),
  can_manage_group: z.boolean().optional(),
  can_manage_notifications: z.boolean().optional(),
  can_view_reports: z.boolean().optional(),
  can_manage_r2: z.boolean().optional(),
}).strict();

const deleteSchema = z.object({ id: z.string().trim().min(1).max(128) }).strict();

const userSelect = `SELECT id,email,full_name,control_number,role,active,
  can_edit_tasks,can_delete_tasks,can_manage_materials,can_manage_users,
  can_manage_settings,can_manage_group,can_manage_notifications,can_view_reports,can_manage_r2
  FROM app_profiles`;

function enabled(value: number | boolean | undefined) {
  return value === 1 || value === true;
}

async function getUser(id: string) {
  return d1First<UserRow>(`${userSelect} WHERE id = ? LIMIT 1`, [id]);
}

async function assertUniqueProfileFields(id: string, email?: string, controlNumber?: string | null) {
  if (email) {
    const duplicate = await d1First<{ id: string }>(
      `SELECT id FROM app_profiles WHERE lower(trim(email)) = lower(trim(?)) AND id <> ? LIMIT 1`,
      [email, id],
    );
    if (duplicate) throw new HttpError(409, "Ese correo ya pertenece a otro usuario.");
  }
  if (controlNumber) {
    const duplicate = await d1First<{ id: string }>(
      `SELECT id FROM app_profiles WHERE control_number = ? AND id <> ? LIMIT 1`,
      [controlNumber, id],
    );
    if (duplicate) throw new HttpError(409, "Ese número de control ya pertenece a otro usuario.");
  }
}

function normalizeForClient(user: UserRow) {
  return {
    ...user,
    active: enabled(user.active),
    ...Object.fromEntries(permissionKeys.map((key) => [key, enabled(user[key])])),
  };
}

async function audit(actorId: string, action: string, targetId: string, before: UserRow | null, after: UserRow | null) {
  await d1Run(
    `INSERT INTO audit_log (id, actor_id, action, entity, entity_id, before_data, after_data)
     VALUES (?, ?, ?, 'app_profile', ?, ?, ?)`,
    [crypto.randomUUID(), actorId, action, targetId, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null],
  );
}

export async function PATCH(request: Request) {
  try {
    const actor = await requirePermission(request, "users:manage");
    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Datos de usuario inválidos.");

    const { id, ...patch } = parsed.data;
    const target = await getUser(id);
    if (!target) throw new HttpError(404, "Usuario no encontrado.");

    const actorIsOwner = actor.role === "owner";
    const touchesPrivileges = patch.role !== undefined || permissionKeys.some((key) => patch[key] !== undefined);
    if (!actorIsOwner && target.role !== "student") throw new HttpError(403, "Sólo el propietario puede modificar administradores u owners.");
    if (!actorIsOwner && touchesPrivileges) throw new HttpError(403, "Sólo el propietario puede cambiar roles o permisos.");

    const targetIsCanonicalOwner = target.email.trim().toLowerCase() === CANONICAL_OWNER_EMAIL;
    if (targetIsCanonicalOwner) {
      if (patch.email !== undefined && patch.email.trim().toLowerCase() !== CANONICAL_OWNER_EMAIL) {
        throw new HttpError(400, "El correo del propietario canónico no se puede cambiar.");
      }
      if (patch.role !== undefined && patch.role !== "owner") throw new HttpError(400, "El propietario canónico no se puede degradar.");
      if (patch.active === false) throw new HttpError(400, "El propietario canónico no se puede desactivar.");
      for (const key of permissionKeys) {
        if (patch[key] === false) throw new HttpError(400, "Los permisos del propietario canónico no se pueden retirar.");
      }
    }

    const email = patch.email?.trim().toLowerCase();
    const controlNumber = patch.control_number === undefined ? undefined : (patch.control_number?.trim() || null);
    await assertUniqueProfileFields(id, email, controlNumber);

    const nextRole = patch.role ?? target.role;
    const values: Record<string, unknown> = {};
    if (email !== undefined) values.email = email;
    if (patch.full_name !== undefined) values.full_name = patch.full_name.trim();
    if (controlNumber !== undefined) values.control_number = controlNumber;
    if (patch.active !== undefined) values.active = patch.active ? 1 : 0;
    if (patch.role !== undefined) values.role = patch.role;

    for (const key of permissionKeys) {
      if (patch[key] !== undefined) values[key] = patch[key] ? 1 : 0;
    }

    if (nextRole === "student") {
      for (const key of permissionKeys) values[key] = 0;
    } else if (nextRole === "owner") {
      if (!actorIsOwner) throw new HttpError(403, "Sólo un owner puede asignar el rol owner.");
      for (const key of permissionKeys) values[key] = 1;
      values.active = 1;
    }

    if (!Object.keys(values).length) return NextResponse.json({ user: normalizeForClient(target), message: "Sin cambios." });

    values.updated_at = new Date().toISOString();
    const columns = Object.keys(values);
    await d1Run(
      `UPDATE app_profiles SET ${columns.map((column) => `"${column}" = ?`).join(", ")} WHERE id = ?`,
      [...columns.map((column) => values[column]), id],
    );

    invalidateProfileCache(id);
    const updated = await getUser(id);
    if (!updated) throw new HttpError(500, "No se pudo recuperar el usuario actualizado.");
    await audit(actor.id, "user.updated", id, target, updated);
    return NextResponse.json({ user: normalizeForClient(updated), message: "Usuario actualizado." });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await requirePermission(request, "users:manage");
    const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Selecciona un usuario válido.");

    const target = await getUser(parsed.data.id);
    if (!target) throw new HttpError(404, "Usuario no encontrado.");
    if (target.id === actor.id) throw new HttpError(400, "No puedes eliminar tu propia cuenta activa.");
    if (target.email.trim().toLowerCase() === CANONICAL_OWNER_EMAIL) throw new HttpError(400, "El propietario canónico no se puede eliminar.");
    if (actor.role !== "owner" && target.role !== "student") throw new HttpError(403, "Sólo el propietario puede eliminar administradores u owners.");

    await d1Run(`DELETE FROM app_profiles WHERE id = ?`, [target.id]);
    invalidateProfileCache(target.id);
    await audit(actor.id, "user.deleted", target.id, target, null);
    return NextResponse.json({ id: target.id, message: "Usuario eliminado." });
  } catch (error) {
    return errorResponse(error);
  }
}
