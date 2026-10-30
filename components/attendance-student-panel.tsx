"use client";

import { useEffect, useState } from "react";
import { attendancePeriodBounds, type AttendancePeriod } from "@/lib/attendance-period";
import "./attendance-panel.css";

type Entry = {
  id: string; date: string; course: string; status: "present" | "late" | "absent" | "excused" | null;
  note: string | null; provisional: boolean; minutes: number | null;
  absentMinutes: number | null; exits: number | null;
  required: number | null; percentage: number | null;
};
type MyAttendance = {
  date: string; period: AttendancePeriod; bounds: { start: string; end: string }; entries: Entry[];
  summary: { attendedMinutes: number; balanceMinutes: number; absentMinutes: number; exitCount: number; requiredMinutes: number; percentage: number | null; provisional: boolean };
};
const labels: Record<NonNullable<Entry["status"]>, string> = {
  present: "Presente", late: "Retardo", absent: "Ausente", excused: "Justificada",
};
function localDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Mexico_City",
  }).formatToParts(new Date());
  const find = (key: string) => parts.find((p) => p.type === key)?.value ?? "";
  return [find("year"), find("month"), find("day")].join("-");
}
function showPercent(value: number | null) {
  return value == null ? "—" : value.toFixed(1) + "%";
}

export function AttendanceStudentPanel() {
  const [date, setDate] = useState(localDate);
  const [period, setPeriod] = useState<AttendancePeriod>("day");
  const [courseFilter, setCourseFilter] = useState("all");
  const [data, setData] = useState<MyAttendance | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      try {
        setError(null);
        setData(null);
        const response = await fetch("/api/attendance/me?date=" + encodeURIComponent(date) + "&period=" + period,
          { cache: "no-store", credentials: "include", signal: abort.signal });
        const result = await response.json() as MyAttendance & { error?: string };
        if (!response.ok) throw new Error(result.error ?? "No se pudo consultar asistencia.");
        if (!abort.signal.aborted) setData(result);
      } catch (cause) {
        if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "No se pudo consultar.");
      }
    }
    void load();
    return () => abort.abort();
  }, [date, period]);

  const courseOverview = new Map<string, { attended: number; required: number; count: number; provisional: boolean }>();
  for (const entry of data?.entries ?? []) {
    const row = courseOverview.get(entry.course) ?? { attended: 0, required: 0, count: 0, provisional: false };
    row.attended += entry.minutes ?? 0;
    row.required += entry.required ?? 0;
    row.count++;
    row.provisional ||= entry.provisional;
    courseOverview.set(entry.course, row);
  }
  const visibleEntries = (data?.entries ?? []).filter((entry) => courseFilter === "all" || entry.course === courseFilter);
  const bounds = attendancePeriodBounds(date, period);
  const visibleRequired = visibleEntries.reduce((sum, entry) => sum + (entry.required ?? 0), 0);
  const visibleMinutes = visibleEntries.reduce((sum, entry) => sum + (entry.minutes ?? 0), 0);
  const visibleAbsent = visibleEntries.reduce((sum, entry) => sum + (entry.absentMinutes ?? 0), 0);
  const visibleExits = visibleEntries.reduce((sum, entry) => sum + (entry.exits ?? 0), 0);
  const visibleProvisional = visibleEntries.some((entry) => entry.provisional);

  return <div className="attendancePage">
    <header className="attendanceHeading">
      <div><h2>Mi asistencia</h2><p>El saldo empieza con todos los minutos exigibles y disminuye con los retardos y las salidas registradas.</p></div>
      <label>Fecha <input type="date" value={date} onChange={(event) => {
        if (event.target.value) setDate(event.target.value);
      }} /></label>
    </header>
    <div className="attendanceAnalysisFilters">
      <fieldset className="attendancePeriodTabs"><legend>Periodo</legend>
        {(["day", "week", "month"] as const).map((value) => <button type="button" key={value}
          aria-pressed={period === value} onClick={() => setPeriod(value)}>
          {value === "day" ? "Diario" : value === "week" ? "Semanal" : "Mensual"}</button>)}
      </fieldset>
      <label>Materia<select value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}>
        <option value="all">Todas las materias</option>
        {Array.from(courseOverview.keys()).map((course) => <option value={course} key={course}>{course}</option>)}
      </select></label>
    </div>
    <p className="attendanceHint">Periodo: {bounds.start} {bounds.end !== bounds.start ? "a " + bounds.end : ""}. Los datos abiertos son provisionales.</p>
    {error ? <div className="attendanceError" role="alert">{error}</div> : null}
    {!data ? <p role="status">Consultando mis registros…</p> : <>
      <section className="attendanceSummary">
        <div><strong>{visibleEntries.length}</strong><span>Sesiones del periodo</span></div>
        <div><strong>{visibleAbsent.toFixed(1)}</strong><span>Minutos ausentes ({visibleExits} salidas)</span></div>
        <div><strong>{showPercent(visibleRequired ? visibleMinutes / visibleRequired * 100 : null)}</strong><span>{visibleProvisional ? "Máximo posible del periodo" : "Permanencia del periodo"}</span></div>
      </section>
      <section className="attendanceSection">
        <h3>Detalle por materia</h3>
        <div className="attendanceCourseGrid">
          {Array.from(courseOverview.entries()).filter(([name]) => courseFilter === "all" || courseFilter === name)
            .map(([name, row]) => <div className="attendanceCourseCard" key={name}>
              <div className="attendanceCourseHead"><div><h4>{name}</h4><span>{row.count} clase(s) del periodo</span></div>
                <strong>{showPercent(row.required ? row.attended / row.required * 100 : null)}</strong></div>
              <progress max={100} value={row.required ? row.attended / row.required * 100 : 0}
                className="attendanceProgress" aria-label={"Permanencia en " + name} />
              {row.provisional && <small>Hay clases abiertas; la cifra es provisional.</small>}
            </div>)}
        </div>
        <div className="attendanceTableScroll"><table className="attendanceTable attendanceInsightsTable">
          <thead><tr><th>Fecha</th><th>Materia</th><th>Asistencia</th><th>Salidas</th><th>Ausencia</th><th>Saldo de minutos / Presentes al cierre</th><th>Minutos exigibles</th><th>Máximo posible / Final</th></tr></thead>
          <tbody>{visibleEntries.map((entry) => <tr key={entry.id}>
            <td data-label="Fecha">{entry.date}</td>
            <td data-label="Materia">{entry.course}</td>
            <td data-label="Registro">{entry.status ? labels[entry.status] : "Sin registrar"}</td>
            <td data-label="Salidas">{entry.exits ?? "—"}</td>
            <td data-label="Ausencia">{entry.absentMinutes === null ? "—" : entry.absentMinutes.toFixed(1)}</td>
            <td data-label="Saldo / Presencia">{entry.minutes === null ? "—" : entry.minutes.toFixed(1)}</td>
            <td data-label="Exigibles">{entry.required === null ? "—" : entry.required.toFixed(1)}</td>
            <td data-label="Asistencia"><strong>{showPercent(entry.percentage)}</strong>{entry.provisional ? <small>Provisional</small> : null}</td>
          </tr>)}</tbody>
        </table></div>
        {data.entries.length === 0 ? <p>No hay sesiones registradas para el periodo seleccionado.</p> : null}
        <p className="attendanceHint">Saldo = duración exigible de la clase − ausencia transcurrida. Mientras la clase está abierta, el saldo y el porcentaje indican lo máximo que todavía se podría alcanzar, no minutos ya asistidos. Los descansos oficiales no penalizan. La consulta no sustituye la asistencia oficial.</p>
      </section>
    </>}
  </div>;
}
