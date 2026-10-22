"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { calculateSaldoPermanencia, type TimeWindow } from "@/lib/permanencia-math";
import { suggestedPermanenceSchedule, type BreakMode } from "@/lib/permanencia-config";
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
};
type Command =
  | { action: "create_session"; courseId: string; date: string; startLocal: string; endLocal: string }
  | { action: "mark_attendance"; sessionId: string; profileId: string; status: Attendance["status"] }
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
  });
}

export function AttendancePanel() {
  const [date, setDate] = useState(todayInMexicoCity);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [startLocal, setStartLocal] = useState("18:00");
  const [endLocal, setEndLocal] = useState("21:00");
  const [manualBreakStart, setManualBreakStart] = useState("19:30");
  const [manualBreakEnd, setManualBreakEnd] = useState("19:45");
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

  async function command(body: Command) {
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
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

  const dailyStats = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.students.map((student) => {
      let required = 0; let attended = 0; let absent = 0; let exits = 0; let markedCount = 0;
      for (const session of snapshot.sessions) {
        const stats = calculateForStudent(snapshot, session, student.id);
        if (stats) { required += stats.requiredMinutes; attended += stats.remainingMinutes; absent += stats.absentMinutes; exits += stats.exitCount; }
        if (snapshot.attendance.some((a) => a.session_id === session.id && a.profile_id === student.id)) markedCount++;
      }
      return { student, required, attended, absent, exits, markedCount,
        percentage: required > 0 ? Math.round(attended / required * 1000) / 10 : null };
    });
  }, [snapshot]);

  function exportCsv() {
    const header = ["Alumno", "Número de control", "Fecha", "Sesiones marcadas", "Salidas", "Minutos ausentes", "Saldo de minutos (provisional si sesión abierta)", "Minutos exigibles", "Permanencia máxima/final %"];
    const quote = (value: string | number) => '"' + String(value).replaceAll('"', '""') + '"';
    const lines = [header.map(quote).join(","), ...dailyStats.map((s) => [
      s.student.full_name, s.student.control_number ?? "", date, s.markedCount,
      s.exits, s.required > 0 ? s.absent.toFixed(1) : "",
      s.required > 0 ? s.attended.toFixed(1) : "", s.required > 0 ? s.required.toFixed(1) : "", s.percentage ?? "",
    ].map(quote).join(","))];
    const csv = "\uFEFF" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href; link.download = "asistencia-" + date + ".csv";
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
              <p className="attendanceHint">El saldo inicia con la duración exigible completa. Cada salida descuenta el tiempo transcurrido fuera del salón y «Registrar regreso» detiene ese descuento. Los retardos también descuentan minutos y los descansos oficiales no penalizan. «Presente» y «Retardo» registran la primera entrada automáticamente.</p>
              <div className="attendanceTableScroll">
                <table className="attendanceTable">
                  <thead><tr><th>Alumno</th><th>Pase de lista</th><th>Entrada / regreso</th><th>Salidas</th><th>Ausencia</th><th>{selected.status === "open" ? "Saldo de minutos" : "Minutos presentes"}</th><th>{selected.status === "open" ? "Máximo posible" : "Permanencia"}</th></tr></thead>
                  <tbody>{studentStats.map((row) => (
                    <tr key={row.id}>
                      <td><strong>{row.full_name}</strong><small>{row.control_number ?? "Sin número de control"}</small></td>
                      <td><div className="attendanceStatusButtons">
                        {(["present", "late", "absent", "excused"] as Attendance["status"][]).map((status) =>
                          <button type="button" key={status}
                            disabled={busy || selected.status !== "open"}
                            className={row.attendance?.status === status ? "isSelected" : ""}
                            aria-pressed={row.attendance?.status === status}
                            onClick={() => void command({ action: "mark_attendance", sessionId: selected.id, profileId: row.id, status })}>
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

          <section className="attendanceSection">
            <div className="attendanceSectionTitle">
              <div><h3>Resumen diario</h3><p>Saldo disponible = minutos exigibles de las clases registradas menos ausencias transcurridas. Es provisional mientras existan clases abiertas.</p></div>
              <button type="button" onClick={exportCsv} disabled={snapshot.sessions.length === 0}>Exportar CSV</button>
            </div>
            <div className="attendanceTableScroll">
              <table className="attendanceTable">
                <thead><tr><th>Alumno</th><th>Sesiones con pase de lista</th><th>Salidas</th><th>Minutos ausentes</th><th>Saldo de minutos</th><th>Minutos exigibles</th><th>Máximo diario / Final</th></tr></thead>
                <tbody>{dailyStats.map((row) => (
                  <tr key={row.student.id}>
                    <td>{row.student.full_name}</td>
                    <td>{row.markedCount} de {snapshot.sessions.length}</td>
                    <td>{row.required > 0 ? row.exits : "—"}</td>
                    <td>{row.required > 0 ? row.absent.toFixed(1) : "—"}</td>
                    <td>{row.required > 0 ? row.attended.toFixed(1) : "—"}</td><td>{row.required > 0 ? row.required.toFixed(1) : "—"}</td>
                    <td><strong>{percentLabel(row.percentage)}</strong></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <p className="attendanceHint">«Sin marcar» significa ausencia de registro, no falta confirmada. El saldo de una clase abierta representa permanencia máxima posible, no minutos ya cursados. El pase de lista es independiente del control oficial institucional.</p>
          </section>
        </>
      )}
    </div>
  );
}
