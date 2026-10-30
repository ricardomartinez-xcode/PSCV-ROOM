"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { calculateSaldoPermanencia, type TimeWindow } from "@/lib/permanencia-math";
import { suggestedPermanenceSchedule, type BreakMode } from "@/lib/permanencia-config";
import { attendancePeriodBounds, type AttendancePeriod } from "@/lib/attendance-period";
import { AttendanceHistoryChart } from "./attendance-history-chart";
import "./attendance-panel.css";

type Course = { id: string; name: string; short_name: string | null };
type Student = { id: string; full_name: string; control_number: string | null };
type Session = {
  id: string; course_id: string; session_date: string;
  scheduled_start_at: string; scheduled_end_at: string; actual_end_at: string | null;
  status: "open" | "closed" | "cancelled"; break_mode: BreakMode;
};
type Attendance = { session_id: string; profile_id: string; status: "present" | "late" | "absent" | "excused"; note: string | null };
type Presence = { id: string; session_id: string; profile_id: string; start_at: string; end_at: string | null };
type Break = { id: string; session_id: string; kind: "fixed" | "variable"; start_at: string; end_at: string | null };
type Snapshot = {
  courses: Course[]; students: Student[]; sessions: Session[];
  attendance: Attendance[]; presence: Presence[]; breaks: Break[]; serverNow: string;
  period?: AttendancePeriod; periodStart?: string; periodEnd?: string;
};
type StudentCourseSummary = {
  student: Student; course: Course; markedCount: number; observedCount: number;
  required: number; attended: number; absent: number; exits: number;
  percentage: number | null; provisional: boolean;
  records: Array<{ session: Session; status: Attendance["status"] | null; stats: ReturnType<typeof calculateForStudent> }>;
};
type CourseSummary = { course: Course; rows: StudentCourseSummary[]; count: number; percentage: number | null; recorded: number; };
const periodLabels: Record<AttendancePeriod, string> = { day: "Diario", week: "Semanal", month: "Mensual" };
type Command =
  | { action: "create_session"; courseId: string; date: string; startLocal: string; endLocal: string }
  | { action: "mark_attendance"; sessionId: string; profileId: string; status: Attendance["status"]; arrivalLocal?: string }
  | { action: "toggle_presence"; sessionId: string; profileId: string }
  | { action: "start_break" | "end_break" | "close_session"; sessionId: string }
  | { action: "add_break"; sessionId: string; startLocal: string; endLocal: string }
  | { action: "set_break_mode"; sessionId: string; mode: BreakMode }
  | { action: "save_pattern"; sessionId: string };

const basePath = "/api/admin/attendance";
const formatClock = (iso: string) => new Intl.DateTimeFormat("es-MX", {
  hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Mexico_City",
}).format(new Date(iso));
const statusLabels: Record<Attendance["status"], string> = {
  present: "Presente", late: "Retardo", absent: "Ausente", excused: "Justificada",
};
const modeLabels: Record<BreakMode, string> = {
  none: "Sin descanso", variable: "Variable", fixed: "Fijo", mixed: "Mixto",
};
const dayLabel = (date: string) => new Intl.DateTimeFormat("es-MX", {
  weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "America/Mexico_City",
}).format(new Date(date + "T12:00:00-06:00"));

function todayInMexicoCity() {
  const parts = new Intl.DateTimeFormat("en", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Mexico_City",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return [part("year"), part("month"), part("day")].join("-");
}

function percentLabel(value: number | null) {
  return value === null ? "—" : value.toFixed(1) + "%";
}

function normalizeName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sessionTime(session: Session, snapshot: Snapshot) {
  const start = Date.parse(session.scheduled_start_at);
  const end = session.status === "open"
    ? Date.parse(session.scheduled_end_at)
    : Date.parse(session.actual_end_at ?? session.scheduled_end_at);
  if (session.status === "open" && Date.parse(snapshot.serverNow) <= start) return null;
  return end > start ? new Date(end).toISOString() : null;
}

function calculateForStudent(snapshot: Snapshot, session: Session, profileId: string) {
  const end = sessionTime(session, snapshot);
  if (!end || session.status === "cancelled") return null;
  // Sin pase de lista NI intervalos no equivale a falta confirmada.
  const observed = snapshot.attendance.some((item) => item.session_id === session.id && item.profile_id === profileId) ||
    snapshot.presence.some((item) => item.session_id === session.id && item.profile_id === profileId);
  if (!observed) return null;
  const attendanceStatus = snapshot.attendance.find((item) =>
    item.session_id === session.id && item.profile_id === profileId)?.status;
  const presence: TimeWindow[] = snapshot.presence
    .filter((p) => p.session_id === session.id && p.profile_id === profileId)
    .map((p) => ({ startAt: p.start_at, endAt: p.end_at }));
  const officialBreaks: TimeWindow[] = snapshot.breaks
    .filter((b) => b.session_id === session.id)
    .map((b) => ({ startAt: b.start_at, endAt: b.end_at }));
  return calculateSaldoPermanencia({
    classStartAt: session.scheduled_start_at,
    classEndAt: end, presence, officialBreaks,
    now: snapshot.serverNow,
    closed: session.status === "closed",
    countInitialAbsence: attendanceStatus !== "present",
  });
}

export function AttendancePanel() {
  const [date, setDate] = useState(todayInMexicoCity);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [period, setPeriod] = useState<AttendancePeriod>("week");
  const [summarySnapshot, setSummarySnapshot] = useState<Snapshot | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryQuery, setSummaryQuery] = useState("");
  const [summaryCourseId, setSummaryCourseId] = useState("all");
  const [summaryOrder, setSummaryOrder] = useState<"name" | "low" | "high">("name");
  const [detail, setDetail] = useState<{ studentId: string; courseId: string } | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [startLocal, setStartLocal] = useState("18:00");
  const [endLocal, setEndLocal] = useState("21:00");
  const [manualBreakStart, setManualBreakStart] = useState("19:30");
  const [manualBreakEnd, setManualBreakEnd] = useState("19:45");
  const [lateDialog, setLateDialog] = useState<{
    sessionId: string; profileId: string; studentName: string;
    arrivalLocal: string; classStartLocal: string; classEndLocal: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (day: string) => {
    const response = await fetch(basePath + "?date=" + encodeURIComponent(day), { cache: "no-store" });
    const data = await response.json() as Snapshot & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "No fue posible obtener la asistencia.");
    setSnapshot(data);
    setSelectedSessionId((prev) => data.sessions.some((s) => s.id === prev) ? prev : data.sessions[0]?.id ?? "");
    setCourseId((prev) => data.courses.some((c) => c.id === prev) ? prev : data.courses[0]?.id ?? "");
  }, []);

  useEffect(() => {
    let mounted = true;
    const task = async () => {
      try {
        const response = await fetch(basePath + "?date=" + encodeURIComponent(date), { cache: "no-store" });
        const data = await response.json() as Snapshot & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "No fue posible obtener la asistencia.");
        if (!mounted) return;
        setSnapshot(data);
        setSelectedSessionId((prev) => data.sessions.some((s) => s.id === prev) ? prev : data.sessions[0]?.id ?? "");
        setCourseId((prev) => data.courses.some((c) => c.id === prev) ? prev : data.courses[0]?.id ?? "");
        setError(null);
      } catch (cause) {
        if (mounted) { setSnapshot(null); setError(cause instanceof Error ? cause.message : "Error de carga."); }
      }
    };
    void task();
    return () => { mounted = false; };
  }, [date]);

  // Keep daily CRUD operations independent of historical reporting requests.
  useEffect(() => {
    if (period === "day") return;
    const controller = new AbortController();
    const load = async () => {
      setSummarySnapshot(null);
      setSummaryError(null);
      setSummaryLoading(true);
      try {
        const response = await fetch(basePath + "?date=" + encodeURIComponent(date) + "&period=" + period, {
          cache: "no-store", signal: controller.signal,
        });
        const data = await response.json() as Snapshot & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "No fue posible cargar el periodo.");
        if (!controller.signal.aborted) setSummarySnapshot(data);
      } catch (cause) {
        if (!controller.signal.aborted) setSummaryError(cause instanceof Error ? cause.message : "Error al cargar el periodo.");
      } finally {
        if (!controller.signal.aborted) setSummaryLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [period, date, snapshot]);

  async function command(body: Command): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(basePath, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as { ok?: boolean; error?: string; sessionId?: string };
      if (!response.ok) throw new Error(result.error ?? "No se pudo guardar el registro.");
      await refresh(date);
      if (result.sessionId) setSelectedSessionId(result.sessionId);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function openLateDialog(session: Session, student: Student) {
    const first = snapshot?.presence
      .filter((item) => item.session_id === session.id && item.profile_id === student.id)
      .sort((a, b) => a.start_at.localeCompare(b.start_at))[0];
    const classStartLocal = formatClock(session.scheduled_start_at);
    const classEndLocal = formatClock(session.scheduled_end_at);
    const suggested = first ? formatClock(first.start_at)
      : formatClock(snapshot?.serverNow ?? new Date().toISOString());
    setError(null);
    setLateDialog({
      sessionId: session.id, profileId: student.id, studentName: student.full_name,
      arrivalLocal: suggested < classStartLocal ? classStartLocal :
        suggested > classEndLocal ? classEndLocal : suggested,
      classStartLocal, classEndLocal,
    });
  }

  async function saveLateDialog() {
    if (!lateDialog) return;
    const ok = await command({
      action: "mark_attendance", sessionId: lateDialog.sessionId,
      profileId: lateDialog.profileId, status: "late",
      arrivalLocal: lateDialog.arrivalLocal,
    });
    if (ok) setLateDialog(null);
  }

  const selected = snapshot?.sessions.find((s) => s.id === selectedSessionId) ?? null;
  const selectedBreaks = snapshot?.breaks.filter((b) => b.session_id === selectedSessionId) ?? [];
  const activeBreak = selectedBreaks.find((b) => b.kind === "variable" && b.end_at === null);
  const courseById = useMemo(() => new Map(snapshot?.courses.map((c) => [c.id, c.name]) ?? []), [snapshot]);
  const weekday = new Date(date + "T12:00:00-06:00").getDay() || 7;
  const suggested = suggestedPermanenceSchedule.filter((slot) => slot.weekday === weekday);

  const studentStats = useMemo(() => {
    if (!snapshot || !selected) return [];
    return snapshot.students.map((student) => {
      const attendance = snapshot.attendance.find((a) => a.session_id === selected.id && a.profile_id === student.id);
      const records = snapshot.presence.filter((p) => p.session_id === selected.id && p.profile_id === student.id);
      const currentPresence = records.some((p) => p.end_at === null);
      return { ...student, attendance, currentPresence, hasEntered: records.length > 0,
        stats: calculateForStudent(snapshot, selected, student.id) };
    });
  }, [snapshot, selected]);

  const marked = studentStats.filter((s) => s.attendance).length;
  const present = studentStats.filter((s) => s.attendance?.status === "present" || s.attendance?.status === "late").length;

  const activeSummary = period === "day" ? snapshot : summarySnapshot;
  const bounds = attendancePeriodBounds(date, period);
  const courseSummaries = useMemo<CourseSummary[]>(() => {
    if (!activeSummary) return [];
    const activeCourses = activeSummary.courses.filter((course) =>
      activeSummary.sessions.some((session) => session.course_id === course.id && session.status !== "cancelled"));
    const groups = new Map<string, Map<string, StudentCourseSummary>>();
    for (const course of activeCourses) groups.set(course.id, new Map());
    const studentsById = new Map(activeSummary.students.map((student) => [student.id, student]));
    for (const session of activeSummary.sessions) {
      if (session.status === "cancelled") continue;
      const sessionAttendance = activeSummary.attendance.filter((row) => row.session_id === session.id);
      const sessionPresence = activeSummary.presence.filter((row) => row.session_id === session.id);
      const sessionBreaks = activeSummary.breaks.filter((row) => row.session_id === session.id);
      const localSnapshot = { ...activeSummary, attendance: sessionAttendance, presence: sessionPresence, breaks: sessionBreaks };
      const observedIds = new Set([...sessionAttendance.map((row) => row.profile_id), ...sessionPresence.map((row) => row.profile_id)]);
      for (const studentId of observedIds) {
        const student = studentsById.get(studentId);
        const course = activeCourses.find((item) => item.id === session.course_id);
        const rows = groups.get(session.course_id);
        if (!student || !course || !rows) continue;
        const stats = calculateForStudent(localSnapshot, session, studentId);
        const status = sessionAttendance.find((row) => row.profile_id === studentId)?.status ?? null;
        let entry = rows.get(studentId);
        if (!entry) {
          entry = { student, course, markedCount: 0, observedCount: 0, required: 0, attended: 0,
            absent: 0, exits: 0, percentage: null, provisional: false, records: [] };
          rows.set(studentId, entry);
        }
        entry.records.push({ session, status, stats });
        if (status !== null) entry.markedCount++;
        if (stats) {
          entry.observedCount++;
          entry.required += stats.requiredMinutes;
          entry.attended += stats.remainingMinutes;
          entry.absent += stats.absentMinutes;
          entry.exits += stats.exitCount;
          if (session.status === "open") entry.provisional = true;
        }
      }
    }
    return activeCourses.map((course) => {
      const rows = Array.from(groups.get(course.id)?.values() ?? []);
      for (const row of rows) row.percentage = row.required > 0 ? row.attended / row.required * 100 : null;
      const required = rows.reduce((sum, row) => sum + row.required, 0);
      const attended = rows.reduce((sum, row) => sum + row.attended, 0);
      return { course, rows, count: activeSummary.sessions.filter((session) =>
        session.course_id === course.id && session.status !== "cancelled").length,
        recorded: rows.length, percentage: required > 0 ? attended / required * 100 : null };
    });
  }, [activeSummary]);
  const visibleCourses = useMemo(() => courseSummaries
    .filter((group) => summaryCourseId === "all" || summaryCourseId === group.course.id)
    .map((group) => ({ ...group, rows: group.rows.filter((row) => {
      const query = normalizeName(summaryQuery);
      return !query || normalizeName([row.student.full_name, row.student.control_number ?? "",
        row.course.name].join(" ")).includes(query);
    }).sort((a, b) => summaryOrder === "name"
      ? a.student.full_name.localeCompare(b.student.full_name, "es")
      : summaryOrder === "low"
        ? (a.percentage ?? 101) - (b.percentage ?? 101)
        : (b.percentage ?? -1) - (a.percentage ?? -1)) })), [courseSummaries, summaryCourseId, summaryQuery, summaryOrder]);
  const historySessions = useMemo(() => [...(activeSummary?.sessions ?? [])]
    .filter((session) => session.status !== "cancelled")
    .sort((a, b) => b.session_date.localeCompare(a.session_date) ||
      b.scheduled_start_at.localeCompare(a.scheduled_start_at)), [activeSummary]);
  const historyDates = Array.from(new Set(historySessions.map((session) => session.session_date)));

  function exportCsv() {
    if (!activeSummary) return;
    const header = ["Materia", "Alumno", "Número de control", "Inicio", "Fin", "Sesiones marcadas", "Sesiones con registro", "Salidas",
      "Minutos ausentes", "Saldo o minutos presentes", "Minutos exigibles", "Máximo posible / Final %"];
    const quote = (value: string | number) => {
      const text = String(value);
      // Prevent formula execution when CSV is opened in a spreadsheet.
      const safe = /^[=+@\\t\\r]/.test(text) || /^-(?!\\d)/.test(text) ? "'" + text : text;
      return '"' + safe.replaceAll('"', '""') + '"';
    };
    const lines = [header, ...visibleCourses.flatMap((group) => group.rows.map((row) => [
      group.course.name, row.student.full_name, row.student.control_number ?? "", bounds.start, bounds.end,
      row.markedCount, row.observedCount, row.exits, row.absent.toFixed(1), row.attended.toFixed(1),
      row.required.toFixed(1), row.percentage === null ? "" : row.percentage.toFixed(1),
    ]))].map((values) => values.map(quote).join(","));
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href; link.download = "asistencia-" + period + "-" + date + ".csv";
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(href);
  }

  return (
    <div className="attendancePage">
      <header className="attendanceHeading">
        <div><h2>Asistencia</h2><p>El saldo comienza con todos los minutos exigibles y solo disminuye al registrar ausencias, retardos o salidas. No se acumula desde cero.</p></div>
        <label>Fecha <input type="date" value={date} onChange={(e) => { if (e.target.value) setDate(e.target.value); }} /></label>
      </header>
      <p className="attendanceDate">{dayLabel(date)}</p>
      {error && <div role="alert" className="attendanceError">{error}</div>}
      {!snapshot ? <p role="status">Consultando alumnos y sesiones en D1…</p> : (
        <>
          <section className="attendanceSummary" aria-label="Resumen del día">
            <div><strong>{snapshot.students.length}</strong><span>Alumnos activos en D1</span></div>
            <div><strong>{snapshot.sessions.length}</strong><span>Sesiones registradas</span></div>
            <div><strong>{snapshot.sessions.filter((s) => s.status === "closed").length}</strong><span>Sesiones cerradas</span></div>
          </section>

          <section className="attendanceSection">
            <h3>Clases del día</h3>
            <div className="attendanceSessionTabs">
              {snapshot.sessions.map((session) => (
                <button type="button" key={session.id}
                  className={session.id === selectedSessionId ? "attendanceSession active" : "attendanceSession"}
                  onClick={() => setSelectedSessionId(session.id)}>
                  <strong>{courseById.get(session.course_id) ?? "Materia"}</strong>
                  <span>{formatClock(session.scheduled_start_at)}–{formatClock(session.scheduled_end_at)} · {session.status === "open" ? "En curso" : "Finalizada"}</span>
                </button>
              ))}
              {snapshot.sessions.length === 0 && <p>Aún no hay clases registradas para este día.</p>}
            </div>
          </section>

          <section className="attendanceSection" aria-label="Historial de clases registradas">
            <div className="attendanceSectionTitle">
              <div><h3>Historial de clases registradas</h3>
                <p>Consulta las clases de diferentes fechas sin perder el control diario. Selecciona una clase para abrir su pase de lista.</p></div>
            </div>
            <div className="attendanceAnalysisFilters">
              <fieldset className="attendancePeriodTabs">
                <legend>Periodo del historial</legend>
                {(["day", "week", "month"] as const).map((value) =>
                  <button type="button" key={value} aria-pressed={period === value}
                    onClick={() => setPeriod(value)}>{periodLabels[value]}</button>)}
              </fieldset>
              <span className="attendanceHint">Fecha de referencia: {date}</span>
            </div>
            <div className="attendanceHistoryList">
              {historyDates.map((day) => <section className="attendanceHistoryDay" key={day}>
                <h4>{dayLabel(day)}</h4>
                <div className="attendanceHistorySessions">
                  {historySessions.filter((session) => session.session_date === day).map((session) => <button
                    type="button" key={session.id} onClick={() => {
                      setSelectedSessionId(session.id);
                      setDate(session.session_date);
                    }}>
                    <strong>{activeSummary?.courses.find((course) => course.id === session.course_id)?.name ?? "Materia"}</strong>
                    <span>{formatClock(session.scheduled_start_at)}–{formatClock(session.scheduled_end_at)}</span>
                    <small>{session.status === "closed" ? "Clase finalizada" : "Clase abierta"} · Ver pase de lista</small>
                  </button>)}
                </div>
              </section>)}
            </div>
            {summaryLoading && <p role="status">Cargando historial de clases…</p>}
            {summaryError && <p role="alert" className="attendanceError">{summaryError}</p>}
            {!summaryLoading && activeSummary && historySessions.length === 0 &&
              <p>No se encontraron clases registradas dentro del periodo seleccionado.</p>}
            <p className="attendanceHint">El historial muestra la semana completa de forma predeterminada; «Mensual» permite consultar todas las clases del mes.</p>
          </section>

          <section className="attendanceSection">
            <h3>Iniciar una clase</h3>
            {suggested.length > 0 && (
              <div className="attendanceSuggestions">
                {suggested.map((slot) => {
                  const matching = snapshot.courses.find((course) =>
                    normalizeName(course.name) === normalizeName(slot.courseName) ||
                    normalizeName(course.short_name ?? "") === normalizeName(slot.courseName) ||
                    (normalizeName(course.name).length > 12 && normalizeName(slot.courseName).startsWith(normalizeName(course.name))));
                  return <button type="button" key={slot.courseName + slot.startLocal}
                    disabled={busy || !matching}
                    title={!matching ? "Asocia esta materia desde la lista de D1 para poder iniciar la sesión." : undefined}
                    onClick={() => { if (matching) void command({ action: "create_session", courseId: matching.id, date, startLocal: slot.startLocal, endLocal: slot.endLocal }); }}>
                    {slot.courseName} · {slot.startLocal}–{slot.endLocal}
                    <small>{matching ? modeLabels[slot.defaultBreakMode] : "Sin coincidencia en D1"}</small>
                  </button>;
                })}
              </div>
            )}
            <div className="attendanceForm">
              <label>Materia
                <select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                  {snapshot.courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
                </select>
              </label>
              <label>Inicio <input type="time" value={startLocal} onChange={(e) => setStartLocal(e.target.value)} /></label>
              <label>Fin <input type="time" value={endLocal} onChange={(e) => setEndLocal(e.target.value)} /></label>
              <button type="button" disabled={busy || !courseId} className="attendancePrimary"
                onClick={() => void command({ action: "create_session", courseId, date, startLocal, endLocal })}>
                Crear o abrir sesión
              </button>
            </div>
          </section>

          {selected && (
            <section className="attendanceSection" aria-label="Control de sesión">
              <div className="attendanceSectionTitle">
                <div><h3>{courseById.get(selected.course_id) ?? "Materia"}</h3>
                  <p>{formatClock(selected.scheduled_start_at)}–{formatClock(selected.scheduled_end_at)} · {selected.status === "open" ? "Registro abierto" : "Registro cerrado"}</p>
                </div>
                {selected.status === "open" &&
                  <button type="button" className="attendanceDanger" disabled={busy}
                    onClick={() => { if (window.confirm("¿Finalizar esta clase? Se cerrarán todas las permanencias y descansos abiertos.")) void command({ action: "close_session", sessionId: selected.id }); }}>
                    Finalizar clase
                  </button>}
              </div>

              <div className="attendanceBreakControls">
                <div>
                  <strong>Descansos oficiales</strong>
                  <p>Los minutos de descanso se excluyen del tiempo exigible, sin marcar salidas individuales.</p>
                </div>
                <label>Modalidad
                  <select value={selected.break_mode} disabled={busy || selected.status !== "open"}
                    onChange={(e) => void command({ action: "set_break_mode", sessionId: selected.id, mode: e.target.value as BreakMode })}>
                    {(["none", "variable", "fixed", "mixed"] as BreakMode[]).map((mode) =>
                      <option key={mode} value={mode}>{modeLabels[mode]}</option>)}
                  </select>
                </label>
                {selected.status === "open" && (
                  <button type="button" disabled={busy} onClick={() =>
                    void command({ action: "save_pattern", sessionId: selected.id })}>
                    Guardar esta modalidad para el horario habitual
                  </button>
                )}
                {selected.status === "open" && (selected.break_mode === "variable" || selected.break_mode === "mixed") && (
                  <button type="button" disabled={busy} className={activeBreak ? "attendancePrimary" : "attendanceSecondary"}
                    onClick={() => void command({ action: activeBreak ? "end_break" : "start_break", sessionId: selected.id })}>
                    {activeBreak ? "Terminar descanso" : "Iniciar descanso"}
                  </button>
                )}
                {selectedBreaks.length > 0 && <ul>{selectedBreaks.map((rest) =>
                  <li key={rest.id}>{rest.kind === "variable" ? "Variable" : "Manual"}: {formatClock(rest.start_at)}–{rest.end_at ? formatClock(rest.end_at) : "en curso"}</li>)}</ul>}
                {selected.status === "open" && selected.break_mode !== "none" && (
                  <div className="attendanceForm">
                    <span>Agregar descanso por horario</span>
                    <label>Desde <input type="time" value={manualBreakStart} onChange={(e) => setManualBreakStart(e.target.value)} /></label>
                    <label>Hasta <input type="time" value={manualBreakEnd} onChange={(e) => setManualBreakEnd(e.target.value)} /></label>
                    <button type="button" disabled={busy} onClick={() => void command({
                      action: "add_break", sessionId: selected.id, startLocal: manualBreakStart, endLocal: manualBreakEnd,
                    })}>Registrar</button>
                  </div>
                )}
              </div>

              <div className="attendanceSectionTitle">
                <h3>Pase de lista y permanencia</h3>
                <span>{marked} marcados · {present} presentes o con retardo</span>
                <button type="button" disabled={busy} onClick={() => void refresh(date).catch((cause) => setError(cause instanceof Error ? cause.message : "Error al actualizar."))}>Actualizar saldos</button>
              </div>
              <p className="attendanceHint">El saldo inicia con la duración exigible completa. «Presente» no genera una ausencia por pasar lista tarde. Al seleccionar «Retardo», registra la hora real de llegada en la ventana emergente; el descuento se calcula desde el inicio de clase hasta esa hora. Las salidas y regresos se descuentan por separado; los descansos oficiales no penalizan.</p>
              <div className="attendanceTableScroll">
                <table className="attendanceTable">
                  <thead><tr><th>Alumno</th><th>Pase de lista</th><th>Entrada / regreso</th><th>Salidas</th><th>Ausencia</th><th>{selected.status === "open" ? "Saldo de minutos" : "Minutos presentes"}</th><th>{selected.status === "open" ? "Máximo posible" : "Permanencia"}</th></tr></thead>
                  <tbody>{studentStats.map((row) => (
                    <tr key={row.id}>
                      <td><button type="button" className="attendanceStudentLink"
                        onClick={() => setDetail({ studentId: row.id, courseId: selected.course_id })}>
                        {row.full_name}</button><small>{row.control_number ?? "Sin número de control"}</small></td>
                      <td><div className="attendanceStatusButtons">
                        {(["present", "late", "absent", "excused"] as Attendance["status"][]).map((status) =>
                          <button type="button" key={status}
                            disabled={busy || selected.status !== "open"}
                            className={row.attendance?.status === status ? "isSelected" : ""}
                            aria-pressed={row.attendance?.status === status}
                            onClick={() => status === "late"
                              ? openLateDialog(selected, row)
                              : void command({ action: "mark_attendance", sessionId: selected.id, profileId: row.id, status })}>
                            {statusLabels[status]}
                          </button>)}
                      </div></td>
                      <td><button type="button" disabled={busy || selected.status !== "open"}
                        className={row.currentPresence ? "attendanceOut" : "attendanceIn"}
                        onClick={() => void command({ action: "toggle_presence", sessionId: selected.id, profileId: row.id })}>
                        {row.currentPresence ? "Registrar salida" : row.hasEntered ? "Registrar regreso" : "Registrar entrada"}
                      </button></td>
                      <td>{row.stats ? row.stats.exitCount : "—"}</td>
                      <td>{row.stats ? row.stats.absentMinutes.toFixed(1) + " min" : "—"}</td>
                      <td>{row.stats ? row.stats.remainingMinutes.toFixed(1) + " min" : "—"}</td>
                      <td><strong>{percentLabel(row.stats?.percentage ?? null)}</strong></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              {selected.status === "open" && <p className="attendanceHint">Mientras la sesión está abierta, el saldo representa los minutos y porcentaje máximos que aún se pueden alcanzar; no acredita tiempo futuro como ya asistido. Pulsa «Actualizar saldos» para reflejar una salida todavía en curso. Al finalizar la clase se obtiene la permanencia real.</p>}
            </section>
          )}

          <section className="attendanceSection attendanceAnalytics" aria-label="Análisis de asistencia">
            <div className="attendanceSectionTitle">
              <div><h3>Resumen de asistencia por materia</h3>
                <p>Asistencia medida por minutos exigibles y registrados. Elige día, semana o mes; las clases sin registro no se consideran ausencias confirmadas.</p></div>
              <button type="button" onClick={exportCsv} disabled={!activeSummary || !visibleCourses.some((group) => group.rows.length)}>Exportar CSV</button>
            </div>
            <div className="attendanceAnalysisFilters">
              <fieldset className="attendancePeriodTabs">
                <legend>Periodo</legend>
                {(["day", "week", "month"] as const).map((value) => <button type="button" key={value}
                  aria-pressed={period === value} onClick={() => { setPeriod(value); setDetail(null); }}>
                  {periodLabels[value]}</button>)}
              </fieldset>
              <label>Materia
                <select value={summaryCourseId} onChange={(event) => setSummaryCourseId(event.target.value)}>
                  <option value="all">Todas las materias</option>
                  {snapshot.courses.map((course) => <option value={course.id} key={course.id}>{course.name}</option>)}
                </select>
              </label>
              <label>Buscar alumno
                <input type="search" value={summaryQuery} onChange={(event) => setSummaryQuery(event.target.value)}
                  placeholder="Nombre o número de control" />
              </label>
              <label>Ordenar alumnos
                <select value={summaryOrder} onChange={(event) => setSummaryOrder(event.target.value as typeof summaryOrder)}>
                  <option value="name">Nombre (A–Z)</option>
                  <option value="low">Menor asistencia</option>
                  <option value="high">Mayor asistencia</option>
                </select>
              </label>
            </div>
            <p className="attendanceHint" role="status">
              {bounds.start === bounds.end ? dayLabel(bounds.start) : bounds.start + " a " + bounds.end}
              {" · "}Porcentaje = minutos disponibles o presentes / minutos exigibles
            </p>
            {summaryLoading && <p role="status">Cargando registros del periodo…</p>}
            {summaryError && <p className="attendanceError" role="alert">{summaryError}</p>}
            {activeSummary && visibleCourses.length === 0 && <p>No hay clases registradas para esta selección.</p>}
            {activeSummary && <div className="attendanceCourseGrid">
              {visibleCourses.map((group) => <section className="attendanceCourseCard" key={group.course.id}>
                <div className="attendanceCourseHead">
                  <div><h4>{group.course.name}</h4><span>{group.count} clase(s) · {group.recorded} alumno(s) con registros</span></div>
                  <strong>{percentLabel(group.percentage)}</strong>
                </div>
                <progress className="attendanceProgress" max={100} value={group.percentage ?? 0}
                  aria-label={"Permanencia registrada en " + group.course.name} />
                <div className="attendanceTableScroll">
                  <table className="attendanceTable attendanceInsightsTable">
                    <thead><tr><th>Alumno</th><th>Clases registradas</th><th>Salidas</th><th>Minutos exigibles</th><th>Ausencia</th><th>Asistencia</th></tr></thead>
                    <tbody>{group.rows.map((row) => <tr key={row.student.id}>
                      <td data-label="Alumno"><button type="button" className="attendanceStudentLink"
                        onClick={() => setDetail({ studentId: row.student.id, courseId: group.course.id })}
                        aria-label={"Ver asistencia de " + row.student.full_name + " en " + group.course.name}>
                        {row.student.full_name}</button><small>{row.student.control_number ?? "Sin número de control"}</small></td>
                      <td data-label="Clases registradas">{row.markedCount} pase(s) de lista · {row.observedCount} con registro de permanencia</td>
                      <td data-label="Salidas">{row.exits}</td>
                      <td data-label="Minutos exigibles">{row.required.toFixed(1)} min</td>
                      <td data-label="Ausencia">{row.absent.toFixed(1)} min</td>
                      <td data-label="Asistencia"><div className="attendanceRowProgress">
                        <progress className="attendanceProgress" max={100} value={row.percentage ?? 0}
                          aria-label={"Asistencia de " + row.student.full_name} />
                        <strong>{percentLabel(row.percentage)}</strong>
                        {row.provisional && <small>Provisional</small>}
                      </div></td>
                    </tr>)}</tbody>
                  </table>
                </div>
                {group.rows.length === 0 && <p className="attendanceHint">Sin registros individuales para estos filtros. No se asignan faltas automáticamente.</p>}
              </section>)}
            </div>}
            <p className="attendanceHint">Selecciona un alumno para ver su asistencia clase por clase y fecha. Los porcentajes de clases abiertas son máximos provisionales, no tiempo futuro acreditado.</p>
          </section>
        </>
      )}
      {detail && <StudentHistoryDialog
        studentId={detail.studentId} monthDate={date}
        onClose={() => setDetail(null)}
      />}
      {lateDialog && (
        <div className="attendanceModalBackdrop" role="presentation">
          <div className="attendanceModal" role="dialog" aria-modal="true" aria-labelledby="lateArrivalTitle" onKeyDown={(event) => {
            if (event.key === "Escape" && !busy) setLateDialog(null);
          }}>
            <form onSubmit={(event) => { event.preventDefault(); void saveLateDialog(); }}>
              <h3 id="lateArrivalTitle">Registrar retardo</h3>
              <p><strong>{lateDialog.studentName}</strong></p>
              <p className="attendanceHint">Indica la hora en que realmente llegó al salón. No se utilizará la hora en que estás pasando lista.</p>
              <label htmlFor="lateArrivalTime">Hora real de llegada
                <input id="lateArrivalTime" type="time" step={60} required
                  min={lateDialog.classStartLocal} max={lateDialog.classEndLocal}
                  value={lateDialog.arrivalLocal}
                  autoFocus
                  onChange={(event) => setLateDialog({ ...lateDialog, arrivalLocal: event.target.value })}/>
              </label>
              <p className="attendanceHint">Horario de clase: {lateDialog.classStartLocal}–{lateDialog.classEndLocal}. Puedes volver a seleccionar «Retardo» para corregir una hora ya registrada.</p>
              {error && <div role="alert" className="attendanceError">{error}</div>}
              <div className="attendanceModalActions">
                <button type="button" disabled={busy} onClick={() => { setLateDialog(null); setError(null); }}>Cancelar</button>
                <button type="submit" className="attendancePrimary" disabled={busy || !lateDialog.arrivalLocal}>{busy ? "Guardando…" : "Guardar retardo"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


// Historical details are queried independently of the daily class editor.
// This avoids silently restricting the chart to the selected day's session.
function StudentHistoryDialog({ studentId, monthDate, onClose }: {
  studentId: string; monthDate: string; onClose: () => void;
}) {
  const [month, setMonth] = useState(monthDate.slice(0, 7));
  const [courseFilter, setCourseFilter] = useState("all");
  const [history, setHistory] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setLoadError(null);
      setHistory(null);
      try {
        const response = await fetch(basePath + "?date=" + encodeURIComponent(month + "-01") + "&period=month", {
          cache: "no-store", signal: controller.signal,
        });
        const result = await response.json() as Snapshot & { error?: string };
        if (!response.ok) throw new Error(result.error ?? "No se pudo consultar el historial.");
        if (!controller.signal.aborted) setHistory(result);
      } catch (cause) {
        if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : "Error al consultar historial.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [month]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  const student = history?.students.find((entry) => entry.id === studentId);
  const studentSessions = useMemo(() => {
    if (!history) return [];
    return history.sessions.filter((session) => session.status !== "cancelled")
      .map((session) => {
        const status = history.attendance.find((row) => row.session_id === session.id && row.profile_id === studentId)?.status ?? null;
        return {
          session, status,
          course: history.courses.find((course) => course.id === session.course_id),
          stats: calculateForStudent(history, session, studentId),
        };
      })
      .filter((entry) => entry.course !== undefined)
      .sort((a, b) => a.session.session_date.localeCompare(b.session.session_date) ||
        a.session.scheduled_start_at.localeCompare(b.session.scheduled_start_at));
  }, [history, studentId]);
  const courses = Array.from(new Map(studentSessions.filter((entry) => entry.course)
    .map((entry) => [entry.course!.id, entry.course!])).values());
  const visibleSessions = studentSessions.filter((entry) => courseFilter === "all" || entry.course?.id === courseFilter);
  const recorded = visibleSessions.filter((entry) => entry.status !== null).length;
  const observed = visibleSessions.filter((entry) => entry.stats !== null);
  const required = observed.reduce((total, entry) => total + (entry.stats?.requiredMinutes ?? 0), 0);
  const available = observed.reduce((total, entry) => total + (entry.stats?.remainingMinutes ?? 0), 0);
  const absent = observed.reduce((total, entry) => total + (entry.stats?.absentMinutes ?? 0), 0);
  const percentage = required > 0 ? 100 * available / required : null;

  return <div className="attendanceModalBackdrop" role="presentation">
    <section className="attendanceModal attendanceDetailModal" role="dialog" aria-modal="true"
      aria-labelledby="attendanceHistoryDialogTitle" onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}>
      <div className="attendanceSectionTitle">
        <div>
          <h3 id="attendanceHistoryDialogTitle">Historial de asistencia de {student?.full_name ?? "alumno"}</h3>
          <p>Evolución por materia, clase y fecha · {month}</p>
        </div>
        <button type="button" autoFocus onClick={onClose}>Cerrar</button>
      </div>
      <div className="attendanceDetailFilters">
        <label>Mes del historial
          <input type="month" value={month} onChange={(event) => { if (event.target.value) { setMonth(event.target.value); setCourseFilter("all"); } }} />
        </label>
        <label>Materia
          <select value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}>
            <option value="all">Todas las materias</option>
            {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
          </select>
        </label>
      </div>
      {loading && <p role="status">Consultando clases y preparando las gráficas…</p>}
      {loadError && <p role="alert" className="attendanceError">{loadError}</p>}
      {history && <>
        <div className="attendanceDetailTotals">
          <span><strong>{percentLabel(percentage)}</strong>Permanencia registrada</span>
          <span><strong>{recorded} de {visibleSessions.length}</strong>Clases con pase de lista</span>
          <span><strong>{absent.toFixed(1)} min</strong>Ausencias registradas</span>
        </div>
        {visibleSessions.length > 0 &&
          <AttendanceHistoryChart title="Evolución general por fecha y clase"
            points={visibleSessions.map(({ session, course, stats }) => ({
              id: session.id, date: session.session_date,
              label: course?.short_name || course?.name || "Materia",
              percentage: stats?.percentage ?? null, provisional: session.status === "open",
            }))} />}
        {!visibleSessions.length && <p>No hay clases registradas para este alumno y periodo.</p>}
        {courses.filter((course) => courseFilter === "all" || courseFilter === course.id).map((course) => {
          const entries = visibleSessions.filter((entry) => entry.course?.id === course.id);
          return <AttendanceHistoryChart key={course.id} title={course.name}
            points={entries.map(({ session, stats }) => ({
              id: session.id, date: session.session_date, label: formatClock(session.scheduled_start_at),
              percentage: stats?.percentage ?? null, provisional: session.status === "open",
            }))} />;
        })}
        <div className="attendanceTableScroll">
          <table className="attendanceTable attendanceInsightsTable">
            <thead><tr><th>Fecha</th><th>Materia</th><th>Clase</th><th>Pase de lista</th><th>Ausencia</th><th>Permanencia</th></tr></thead>
            <tbody>{visibleSessions.map(({ session, course, status, stats }) => <tr key={session.id}>
              <td data-label="Fecha">{session.session_date}</td>
              <td data-label="Materia">{course?.name}</td>
              <td data-label="Clase">{formatClock(session.scheduled_start_at)}–{formatClock(session.scheduled_end_at)}</td>
              <td data-label="Pase de lista">{status ? statusLabels[status] : "Sin registrar"}</td>
              <td data-label="Ausencia">{stats ? stats.absentMinutes.toFixed(1) + " min" : "—"}</td>
              <td data-label="Permanencia">{stats ? percentLabel(stats.percentage) : "—"}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="attendanceHint">Cada barra corresponde a una clase registrada. Las barras sombreadas sin porcentaje significan falta de datos, no una ausencia confirmada. Los porcentajes de clases abiertas son provisionales.</p>
      </>}
    </section>
  </div>;
}
