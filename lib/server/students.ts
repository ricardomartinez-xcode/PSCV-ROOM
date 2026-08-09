import { z } from "zod";
import { HttpError, invalidateProfileCache } from "@/lib/server/authz";
import { d1All, d1First, d1Run } from "@/lib/server/d1-data";

export const studentInputSchema = z
  .object({
    email: z.string().trim().email("Ingresa un correo válido.").max(320),
    fullName: z
      .string()
      .trim()
      .min(2, "Ingresa el nombre completo.")
      .max(120),
    controlNumber: z.string().trim().max(48).optional().or(z.literal("")),
    active: z.boolean().optional(),
  })
  .strict();

export type StudentInput = z.infer<typeof studentInputSchema>;

export type StudentRecord = {
  id: string;
  email: string;
  full_name: string;
  control_number: string | null;
  role: "student";
  active: number;
  created_at: string;
  updated_at: string;
};

type ProfileMatch = {
  id: string;
  email: string;
  control_number: string | null;
  role: "student" | "admin" | "owner";
  active: number;
};

export type StudentSaveResult = {
  student: StudentRecord;
  created: boolean;
};

const studentSelect = `
  SELECT id, email, full_name, control_number, role, active, created_at, updated_at
  FROM app_profiles
`;

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeStudentInput(input: StudentInput) {
  return {
    email: input.email.trim().toLowerCase(),
    fullName: normalizeWhitespace(input.fullName),
    controlNumber: input.controlNumber?.trim() || null,
    active: input.active ?? true,
  };
}

function describeProfileConflict(profile: ProfileMatch, field: "correo" | "número de control") {
  if (profile.role !== "student") {
    return `El ${field} pertenece a un perfil ${profile.role} y no se puede convertir en alumno.`;
  }

  return `El ${field} ya pertenece a otro alumno.`;
}

async function findProfileByEmail(email: string) {
  return d1First<ProfileMatch>(
    `SELECT id, email, control_number, role, active
       FROM app_profiles
      WHERE lower(email) = lower(?)
      LIMIT 1`,
    [email],
  );
}

async function findProfileByControlNumber(controlNumber: string | null) {
  if (!controlNumber) return null;

  return d1First<ProfileMatch>(
    `SELECT id, email, control_number, role, active
       FROM app_profiles
      WHERE control_number = ?
      LIMIT 1`,
    [controlNumber],
  );
}

async function findStudentById(id: string) {
  return d1First<StudentRecord>(
    `${studentSelect}
      WHERE id = ? AND role = 'student'
      LIMIT 1`,
    [id],
  );
}

async function writeAudit(
  actorId: string,
  action: string,
  profileId: string,
  details: Record<string, unknown>,
) {
  await d1Run(
    `INSERT INTO audit_log (id, actor_id, action, entity, entity_id, after_data)
     VALUES (?, ?, ?, 'app_profile', ?, ?)`,
    [crypto.randomUUID(), actorId, action, profileId, JSON.stringify(details)],
  );
}

async function resolveStudentForSave(
  input: ReturnType<typeof normalizeStudentInput>,
  targetId?: string,
) {
  const [byEmail, byControl, current] = await Promise.all([
    findProfileByEmail(input.email),
    findProfileByControlNumber(input.controlNumber),
    targetId ? findStudentById(targetId) : Promise.resolve(null),
  ]);

  if (targetId && !current) {
    throw new HttpError(404, "Alumno no encontrado.");
  }

  if (targetId && current) {
    if (byEmail && byEmail.id !== current.id) {
      throw new HttpError(409, describeProfileConflict(byEmail, "correo"));
    }

    if (byControl && byControl.id !== current.id) {
      throw new HttpError(409, describeProfileConflict(byControl, "número de control"));
    }

    return current;
  }

  if (byEmail && byControl && byEmail.id !== byControl.id) {
    throw new HttpError(
      409,
      "El correo y el número de control pertenecen a perfiles distintos. Corrige el padrón antes de importar.",
    );
  }

  const existing = byControl ?? byEmail;
  if (existing && existing.role !== "student") {
    throw new HttpError(
      409,
      describeProfileConflict(existing, existing.id === byControl?.id ? "número de control" : "correo"),
    );
  }

  return existing;
}

export async function validateStudentSave(input: StudentInput, targetId?: string) {
  await resolveStudentForSave(normalizeStudentInput(input), targetId);
}

export async function saveStudent(
  rawInput: StudentInput,
  actorId: string,
  targetId?: string,
): Promise<StudentSaveResult> {
  const input = normalizeStudentInput(rawInput);
  const existing = await resolveStudentForSave(input, targetId);
  const now = new Date().toISOString();
  const id = existing?.id ?? crypto.randomUUID();

  if (existing) {
    await d1Run(
      `UPDATE app_profiles
          SET email = ?,
              full_name = ?,
              control_number = ?,
              role = 'student',
              active = ?,
              updated_at = ?
        WHERE id = ? AND role = 'student'`,
      [input.email, input.fullName, input.controlNumber, input.active ? 1 : 0, now, id],
    );
  } else {
    await d1Run(
      `INSERT INTO app_profiles (
          id, email, full_name, control_number, role, active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'student', ?, ?, ?)`,
      [
        id,
        input.email,
        input.fullName,
        input.controlNumber,
        input.active ? 1 : 0,
        now,
        now,
      ],
    );
  }

  invalidateProfileCache(id);
  const student = await findStudentById(id);
  if (!student) {
    throw new HttpError(500, "No se pudo recuperar el alumno guardado.");
  }

  await writeAudit(actorId, existing ? "student.updated" : "student.created", id, {
    email: student.email,
    controlNumber: student.control_number,
    active: student.active === 1,
  });

  return { student, created: !existing };
}

export async function deleteStudent(id: string, actorId: string) {
  const student = await findStudentById(id);
  if (!student) {
    throw new HttpError(404, "Alumno no encontrado.");
  }

  await d1Run(`DELETE FROM app_profiles WHERE id = ? AND role = 'student'`, [id]);
  invalidateProfileCache(id);
  await writeAudit(actorId, "student.deleted", id, {
    email: student.email,
    controlNumber: student.control_number,
  });

  return student;
}

export async function listStudents(options: {
  query?: string;
  includeInactive?: boolean;
  limit?: number;
}) {
  const query = options.query?.trim().toLowerCase().slice(0, 100) ?? "";
  const pattern = `%${query}%`;
  const includeInactive = options.includeInactive ? 1 : 0;
  const limit = Math.min(Math.max(options.limit ?? 250, 1), 500);

  return d1All<StudentRecord>(
    `${studentSelect}
      WHERE role = 'student'
        AND (? = 1 OR active = 1)
        AND (
          ? = ''
          OR lower(email) LIKE ?
          OR lower(full_name) LIKE ?
          OR coalesce(control_number, '') LIKE ?
        )
      ORDER BY active DESC, full_name ASC
      LIMIT ?`,
    [includeInactive, query, pattern, pattern, pattern, limit],
  );
}
