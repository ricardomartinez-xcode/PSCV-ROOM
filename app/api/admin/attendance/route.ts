import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError, requireProfile, type ServerProfile } from "@/lib/server/authz";
import { getD1 } from "@/lib/server/cloudflare";
import { defaultBreakMode, validateFixedBreaks } from "@/lib/permanencia-config";

export const dynamic = "force-dynamic";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const clockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const idSchema = z.string().trim().min(1).max(128);
const statusSchema = z.enum(["present", "late", "absent", "excused"]);
const modeSchema = z.enum(["none", "variable", "fixed", "mixed"]);

const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_session"), courseId: idSchema, date: dateSchema, startLocal: clockSchema, endLocal: clockSchema }),
  z.object({ action: z.literal("save_pattern"), sessionId: idSchema }),
  z.object({ action: z.literal("mark_attendance"), sessionId: idSchema, profileId: idSchema, status: statusSchema, note: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("toggle_presence"), sessionId: idSchema, profileId: idSchema }),
  z.object({ action: z.literal("start_break"), sessionId: idSchema }),
  z.object({ action: z.literal("end_break"), sessionId: idSchema }),
  z.object({ action: z.literal("add_break"), sessionId: idSchema, startLocal: clockSchema, endLocal: clockSchema }),
  z.object({ action: z.literal("set_break_mode"), sessionId: idSchema, mode: modeSchema }),
  z.object({ action: z.literal("close_session"), sessionId: idSchema }),
]);

type SessionRow = {
  id: string; course_id: string; session_date: string;
  scheduled_start_at: string; scheduled_end_at: string; actual_end_at: string | null;
  status: "open" | "closed" | "cancelled"; break_mode: "none" | "variable" | "fixed" | "mixed";
};
type PresenceRow = { id: string; session_id: string; profile_id: string; start_at: string; end_at: string | null };
type BreakRow = { id: string; session_id: string; kind: "fixed" | "variable"; start_at: string; end_at: string | null };
type AttendanceRow = { session_id: string; profile_id: string; status: "present" | "late" | "absent" | "excused"; note: string | null };
type D1 = Awaited<ReturnType<typeof getD1>>;

function validateDate(value: string) {
  if (Number.isNaN(Date.parse(value + "T12:00:00Z")) ||
      new Date(value + "T12:00:00Z").toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, "Fecha no válida.");
  }
}

function localInstant(date: string, clock: string) {
  // CDMX 2026: UTC-06:00, sin horario de verano. El patrón conserva horas locales.
  // Si se habilitan cohortes fuera de esta zona, reemplazar por resolución IANA.
  validateDate(date);
  const value = new Date(date + "T" + clock + ":00-06:00");
  if (Number.isNaN(value.getTime())) throw new HttpError(400, "Horario inválido.");
  return value.toISOString();
}

function dayOfWeek(date: string) {
  validateDate(date);
  return new Date(date + "T12:00:00Z").getUTCDay() || 7;
}

function clockForInstant(instant: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const part = (name: string) => parts.find((p) => p.type === name)?.value ?? "";
  return part("hour") + ":" + part("minute");
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function getSession(db: D1, id: string) {
  const session = await db.prepare(
    "SELECT id,course_id,session_date,scheduled_start_at,scheduled_end_at,actual_end_at,status,break_mode FROM permanence_sessions WHERE id = ?"
  ).bind(id).first<SessionRow>();
  if (!session) throw new HttpError(404, "Sesión no encontrada.");
  return session;
}

async function requireOpenSession(db: D1, id: string) {
  const session = await getSession(db, id);
  if (session.status !== "open") throw new HttpError(409, "La sesión ya está cerrada o cancelada.");
  return session;
}

async function requireStudent(db: D1, id: string) {
  const row = await db.prepare("SELECT id FROM app_profiles WHERE id = ? AND role = 'student' AND active = 1").bind(id).first();
  if (!row) throw new HttpError(404, "El alumno no está activo en D1.");
}

function isAdministrator(actor: ServerProfile) {
  return actor.role === "owner" ||
    actor.profile_role === "administrator" && actor.role === "admin" && actor.can_manage_group === 1;
}

function isProfessor(actor: ServerProfile) {
  return actor.profile_role === "professor" && actor.role === "admin";
}

async function requireAttendanceManager(actor: ServerProfile) {
  if (!isAdministrator(actor) && !isProfessor(actor)) {
    throw new HttpError(403, "No tienes permiso para gestionar asistencia.");
  }
}

async function requireCourseAccess(db: D1, actor: ServerProfile, courseId: string) {
  await requireAttendanceManager(actor);
  if (isAdministrator(actor)) return;
  const taught = await db.prepare(
    "SELECT id FROM courses WHERE id = ? AND active = 1 AND lower(trim(professor_email)) = lower(trim(?))"
  ).bind(courseId, actor.email).first();
  if (!taught) throw new HttpError(403, "Solo puedes gestionar asistencia de tus materias asignadas.");
}

async function audit(db: D1, actorId: string, action: string, entity: string, entityId: string, detail: Record<string, unknown>) {
  await db.prepare(
    "INSERT INTO audit_log(id,actor_id,action,entity,entity_id,after_data) VALUES (?,?,?,?,?,?)"
  ).bind(crypto.randomUUID(), actorId, action, entity, entityId, JSON.stringify(detail)).run();
}

async function closePresence(db: D1, sessionId: string, profileId: string, instant: string) {
  const row = await db.prepare(
    "SELECT id FROM permanence_presence WHERE session_id = ? AND profile_id = ? AND end_at IS NULL LIMIT 1"
  ).bind(sessionId, profileId).first<{ id: string }>();
  if (row) {
    await db.prepare("UPDATE permanence_presence SET end_at = ? WHERE id = ? AND end_at IS NULL")
      .bind(instant, row.id).run();
  }
  return row;
}

export async function GET(request: Request) {
  try {
    const actor = await requireProfile(request);
    await requireAttendanceManager(actor);
    const day = new URL(request.url).searchParams.get("date") ?? "";
    const parsedDate = dateSchema.safeParse(day);
    if (!parsedDate.success) throw new HttpError(400, "Selecciona una fecha YYYY-MM-DD.");
    validateDate(day);
    const db = await getD1();
    const [courses, students, sessions] = await Promise.all([
      isProfessor(actor)
        ? db.prepare("SELECT id,name,short_name FROM courses WHERE active = 1 AND lower(trim(professor_email)) = lower(trim(?)) ORDER BY sort_order,name").bind(actor.email).all()
        : db.prepare("SELECT id,name,short_name FROM courses WHERE active = 1 ORDER BY sort_order,name").all(),
      db.prepare("SELECT id,full_name,control_number FROM app_profiles WHERE active = 1 AND role = 'student' ORDER BY full_name LIMIT 500").all(),
      isProfessor(actor)
        ? db.prepare("SELECT s.id,s.course_id,s.session_date,s.scheduled_start_at,s.scheduled_end_at,s.actual_end_at,s.status,s.break_mode FROM permanence_sessions s JOIN courses c ON c.id = s.course_id WHERE s.session_date = ? AND c.active = 1 AND lower(trim(c.professor_email)) = lower(trim(?)) ORDER BY s.scheduled_start_at")
          .bind(day, actor.email).all<SessionRow>()
        : db.prepare(
            "SELECT id,course_id,session_date,scheduled_start_at,scheduled_end_at,actual_end_at,status,break_mode FROM permanence_sessions WHERE session_date = ? ORDER BY scheduled_start_at"
          ).bind(day).all<SessionRow>(),
    ]);
    const ids = (sessions.results ?? []).map((s) => s.id);
    let attendance: AttendanceRow[] = [];
    let presence: PresenceRow[] = [];
    let breaks: BreakRow[] = [];
    if (ids.length > 0) {
      const marks = ids.map(() => "?").join(",");
      const [att, pre, bre] = await Promise.all([
        db.prepare("SELECT session_id,profile_id,status,note FROM permanence_attendance WHERE session_id IN (" + marks + ")").bind(...ids).all<AttendanceRow>(),
        db.prepare("SELECT id,session_id,profile_id,start_at,end_at FROM permanence_presence WHERE session_id IN (" + marks + ") ORDER BY start_at").bind(...ids).all<PresenceRow>(),
        db.prepare("SELECT id,session_id,kind,start_at,end_at FROM permanence_breaks WHERE session_id IN (" + marks + ") ORDER BY start_at").bind(...ids).all<BreakRow>(),
      ]);
      attendance = att.results ?? [];
      presence = pre.results ?? [];
      breaks = bre.results ?? [];
    }
    return json({
      courses: courses.results ?? [], students: students.results ?? [],
      sessions: sessions.results ?? [], attendance, presence, breaks,
      serverNow: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireProfile(request);
    await requireAttendanceManager(actor);
    const input = commandSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) throw new HttpError(400, input.error.issues[0]?.message ?? "Solicitud inválida.");
    const db = await getD1();
    const cmd = input.data;
    const now = new Date().toISOString();

    if (cmd.action === "create_session") {
      await requireCourseAccess(db, actor, cmd.courseId);
      const start = localInstant(cmd.date, cmd.startLocal);
      const end = localInstant(cmd.date, cmd.endLocal);
      if (Date.parse(end) <= Date.parse(start)) throw new HttpError(400, "La hora de fin debe ser posterior a la de inicio.");
      const course = await db.prepare("SELECT id FROM courses WHERE id = ? AND active = 1").bind(cmd.courseId).first();
      if (!course) throw new HttpError(404, "Materia no encontrada.");
      const existing = await db.prepare(
        "SELECT id FROM permanence_sessions WHERE course_id = ? AND scheduled_start_at = ?"
      ).bind(cmd.courseId, start).first<{ id: string }>();
      if (existing) return json({ ok: true, sessionId: existing.id, existed: true });
      const id = crypto.randomUUID();
      const pattern = await db.prepare(
        "SELECT id,break_mode,fixed_breaks_json FROM permanence_patterns WHERE course_id=? AND weekday=? AND starts_local=? AND ends_local=?"
      ).bind(cmd.courseId, dayOfWeek(cmd.date), cmd.startLocal, cmd.endLocal)
        .first<{ id: string; break_mode: "none"|"variable"|"fixed"|"mixed"; fixed_breaks_json: string }>();
      const mode = pattern?.break_mode ?? defaultBreakMode(cmd.startLocal, cmd.endLocal);
      const preset: Array<{ startLocal: string; endLocal: string }> = pattern
        ? JSON.parse(pattern.fixed_breaks_json) : [];
      const checked = validateFixedBreaks(cmd.startLocal, cmd.endLocal, preset);
      const writes = [db.prepare(
        "INSERT INTO permanence_sessions(id,pattern_id,course_id,session_date,break_mode,scheduled_start_at,scheduled_end_at,created_by) VALUES(?,?,?,?,?,?,?,?)"
      ).bind(id, pattern?.id ?? null, cmd.courseId, cmd.date, mode, start, end, actor.id)];
      if (mode === "fixed" || mode === "mixed") {
        for (const rest of checked) {
          writes.push(db.prepare(
            "INSERT INTO permanence_breaks(id,session_id,kind,start_at,end_at,recorded_by) VALUES(?,?,'fixed',?,?,?)"
          ).bind(crypto.randomUUID(), id, localInstant(cmd.date, rest.startLocal), localInstant(cmd.date, rest.endLocal), actor.id));
        }
      }
      await db.batch(writes);
      await audit(db, actor.id, "attendance.session.created", "permanence_session", id,
        { courseId: cmd.courseId, date: cmd.date, mode, patternId: pattern?.id ?? null });
      return json({ ok: true, sessionId: id }, 201);
    }

    const session = await requireOpenSession(db, cmd.sessionId);
    await requireCourseAccess(db, actor, session.course_id);
    const action = cmd.action;

    if (action === "save_pattern") {
      const weekday = dayOfWeek(session.session_date);
      const startLocal = clockForInstant(session.scheduled_start_at);
      const endLocal = clockForInstant(session.scheduled_end_at);
      const fixed = await db.prepare(
        "SELECT start_at,end_at FROM permanence_breaks WHERE session_id = ? AND kind = 'fixed' ORDER BY start_at"
      ).bind(session.id).all<{ start_at: string; end_at: string }>();
      const fixedBreaks = (fixed.results ?? []).map((rest) => ({
        startLocal: clockForInstant(rest.start_at), endLocal: clockForInstant(rest.end_at),
      }));
      validateFixedBreaks(startLocal, endLocal, fixedBreaks);
      const id = crypto.randomUUID();
      await db.prepare(
        "INSERT INTO permanence_patterns(id,course_id,weekday,starts_local,ends_local,break_mode,fixed_breaks_json,created_by,updated_by) " +
        "VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(course_id,weekday,starts_local,ends_local) DO UPDATE SET " +
        "break_mode=excluded.break_mode,fixed_breaks_json=excluded.fixed_breaks_json,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP"
      ).bind(id, session.course_id, weekday, startLocal, endLocal, session.break_mode,
        JSON.stringify(fixedBreaks), actor.id, actor.id).run();
      await audit(db, actor.id, "attendance.pattern.saved", "permanence_session", session.id,
        { weekday, startLocal, endLocal, mode: session.break_mode, fixedBreaks });
      return json({ ok: true });
    }

    if (action === "mark_attendance") {
      await requireStudent(db, cmd.profileId);
      const before = await db.prepare(
        "SELECT status,note FROM permanence_attendance WHERE session_id = ? AND profile_id = ?"
      ).bind(session.id, cmd.profileId).first<{ status: string; note: string | null }>();
      await db.prepare(
        "INSERT INTO permanence_attendance(session_id,profile_id,status,note,recorded_by,updated_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP) " +
        "ON CONFLICT(session_id,profile_id) DO UPDATE SET status=excluded.status,note=excluded.note,recorded_by=excluded.recorded_by,updated_at=CURRENT_TIMESTAMP"
      ).bind(session.id, cmd.profileId, cmd.status, cmd.note ?? null, actor.id).run();
      if (cmd.status === "present" || cmd.status === "late") {
        const open = await db.prepare("SELECT id FROM permanence_presence WHERE session_id=? AND profile_id=? AND end_at IS NULL")
          .bind(session.id, cmd.profileId).first();
        if (!open) {
          await db.prepare(
            "INSERT INTO permanence_presence(id,session_id,profile_id,start_at,recorded_by) VALUES(?,?,?,?,?)"
          ).bind(crypto.randomUUID(), session.id, cmd.profileId, now, actor.id).run();
        }
      } else {
        await closePresence(db, session.id, cmd.profileId, now);
      }
      await audit(db, actor.id, "attendance.mark", "permanence_session", session.id,
        { profileId: cmd.profileId, before, after: { status: cmd.status, note: cmd.note ?? null }, at: now });
      return json({ ok: true });
    }

    if (action === "toggle_presence") {
      await requireStudent(db, cmd.profileId);
      const previouslyOpen = await closePresence(db, session.id, cmd.profileId, now);
      if (!previouslyOpen) {
        await db.prepare(
          "INSERT INTO permanence_presence(id,session_id,profile_id,start_at,recorded_by) VALUES(?,?,?,?,?)"
        ).bind(crypto.randomUUID(), session.id, cmd.profileId, now, actor.id).run();
        await db.prepare(
          "INSERT INTO permanence_attendance(session_id,profile_id,status,recorded_by) VALUES(?,?,'present',?) " +
          "ON CONFLICT(session_id,profile_id) DO UPDATE SET status = CASE WHEN status = 'late' THEN 'late' ELSE 'present' END,recorded_by=excluded.recorded_by,updated_at=CURRENT_TIMESTAMP"
        ).bind(session.id, cmd.profileId, actor.id).run();
      }
      await audit(db, actor.id, "attendance.presence.toggle", "permanence_session", session.id,
        { profileId: cmd.profileId, state: previouslyOpen ? "out" : "in", at: now });
      return json({ ok: true });
    }

    if (action === "set_break_mode") {
      const openBreak = await db.prepare("SELECT id FROM permanence_breaks WHERE session_id=? AND end_at IS NULL")
        .bind(session.id).first();
      if (openBreak) throw new HttpError(409, "Termina el descanso activo antes de cambiar la modalidad.");
      const saved = await db.prepare("SELECT COUNT(*) as n FROM permanence_breaks WHERE session_id=?").bind(session.id).first<{ n: number }>();
      if (cmd.mode === "none" && (saved?.n ?? 0) > 0) throw new HttpError(409, "Esta sesión ya tiene descansos registrados.");
      await db.prepare("UPDATE permanence_sessions SET break_mode=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(cmd.mode, session.id).run();
      await audit(db, actor.id, "attendance.break.mode", "permanence_session", session.id,
        { from: session.break_mode, to: cmd.mode });
      return json({ ok: true });
    }

    if (action === "start_break") {
      if (!["variable", "mixed"].includes(session.break_mode)) throw new HttpError(409, "Activa el modo variable o mixto para registrar el descanso.");
      const existing = await db.prepare("SELECT id FROM permanence_breaks WHERE session_id=? AND end_at IS NULL")
        .bind(session.id).first();
      if (existing) throw new HttpError(409, "Ya hay un descanso activo.");
      await db.prepare("INSERT INTO permanence_breaks(id,session_id,kind,start_at,recorded_by) VALUES(? ,?,'variable',?,?)")
        .bind(crypto.randomUUID(), session.id, now, actor.id).run();
      await audit(db, actor.id, "attendance.break.start", "permanence_session", session.id, { at: now });
      return json({ ok: true });
    }

    if (action === "end_break") {
      const active = await db.prepare("SELECT id,start_at FROM permanence_breaks WHERE session_id=? AND end_at IS NULL AND kind='variable'")
        .bind(session.id).first<{ id: string; start_at: string }>();
      if (!active) throw new HttpError(409, "No hay un descanso variable activo.");
      await db.prepare("UPDATE permanence_breaks SET end_at=? WHERE id=? AND end_at IS NULL").bind(now, active.id).run();
      await audit(db, actor.id, "attendance.break.end", "permanence_session", session.id, { at: now, from: active.start_at });
      return json({ ok: true });
    }

    if (action === "add_break") {
      if (!["fixed", "mixed", "variable"].includes(session.break_mode)) throw new HttpError(409, "La sesión no admite descansos.");
      const startAt = localInstant(session.session_date, cmd.startLocal);
      const endAt = localInstant(session.session_date, cmd.endLocal);
      if (startAt < session.scheduled_start_at || endAt > session.scheduled_end_at || endAt <= startAt) {
        throw new HttpError(400, "El descanso debe estar dentro del horario de clase.");
      }
      await db.prepare("INSERT INTO permanence_breaks(id,session_id,kind,start_at,end_at,recorded_by) VALUES(?,?,'fixed',?,?,?)")
        .bind(crypto.randomUUID(), session.id, startAt, endAt, actor.id).run();
      await audit(db, actor.id, "attendance.break.manual", "permanence_session", session.id, { startAt, endAt });
      return json({ ok: true });
    }

    if (action === "close_session") {
      if (session.scheduled_start_at > now) throw new HttpError(400, "No puedes finalizar una clase antes de su inicio.");
      // La clase cierra a la hora efectiva, incluso si fue antes del fin programado.
      await db.prepare("UPDATE permanence_presence SET end_at=? WHERE session_id=? AND end_at IS NULL")
        .bind(now, session.id).run();
      await db.prepare("UPDATE permanence_breaks SET end_at=? WHERE session_id=? AND end_at IS NULL")
        .bind(now, session.id).run();
      await db.prepare(
        "UPDATE permanence_sessions SET actual_end_at=?,status='closed',closed_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?"
      ).bind(now, actor.id, session.id).run();
      await audit(db, actor.id, "attendance.session.closed", "permanence_session", session.id, { at: now });
      return json({ ok: true });
    }

    throw new HttpError(400, "Acción no admitida.");
  } catch (error) {
    return errorResponse(error);
  }
}
