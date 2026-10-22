"use client";

import { useEffect, useState } from "react";
import "./attendance-panel.css";

type Entry = {
  id: string; course: string; status: "present" | "late" | "absent" | "excused" | null;
  note: string | null; provisional: boolean; minutes: number | null;
  absentMinutes: number | null; exits: number | null;
  required: number | null; percentage: number | null;
};
type MyAttendance = {
  date: string; entries: Entry[];
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
  const [data, setData] = useState<MyAttendance | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      try {
        setError(null);
        setData(null);
        const response = await fetch("/api/attendance/me?date=" + encodeURIComponent(date),
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
  }, [date]);

  return <div className="attendancePage">
    <header className="attendanceHeading">
      <div><h2>Mi asistencia</h2><p>El saldo empieza con todos los minutos exigibles y disminuye con los retardos y las salidas registradas.</p></div>
      <label>Fecha <input type="date" value={date} onChange={(event) => {
        if (event.target.value) setDate(event.target.value);
      }} /></label>
    </header>
    {error ? <div className="attendanceError" role="alert">{error}</div> : null}
    {!data ? <p role="status">Consultando mis registros…</p> : <>
      <section className="attendanceSummary">
        <div><strong>{data.entries.length}</strong><span>Sesiones del día</span></div>
        <div><strong>{data.summary.absentMinutes.toFixed(1)}</strong><span>Minutos ausentes ({data.summary.exitCount} salidas)</span></div>
        <div><strong>{showPercent(data.summary.percentage)}</strong><span>{data.summary.provisional ? "Máximo posible del día" : "Permanencia del día"}</span></div>
      </section>
      <section className="attendanceSection">
        <h3>Detalle por materia</h3>
        <div className="attendanceTableScroll"><table className="attendanceTable">
          <thead><tr><th>Materia</th><th>Asistencia</th><th>Salidas</th><th>Ausencia</th><th>Saldo de minutos / Presentes al cierre</th><th>Minutos exigibles</th><th>Máximo posible / Final</th></tr></thead>
          <tbody>{data.entries.map((entry) => <tr key={entry.id}>
            <td>{entry.course}</td>
            <td>{entry.status ? labels[entry.status] : "Sin registrar"}</td>
            <td>{entry.exits ?? "—"}</td>
            <td>{entry.absentMinutes === null ? "—" : entry.absentMinutes.toFixed(1)}</td>
            <td>{entry.minutes === null ? "—" : entry.minutes.toFixed(1)}</td>
            <td>{entry.required === null ? "—" : entry.required.toFixed(1)}</td>
            <td><strong>{showPercent(entry.percentage)}</strong>{entry.provisional ? <small>Provisional</small> : null}</td>
          </tr>)}</tbody>
        </table></div>
        {data.entries.length === 0 ? <p>No hay sesiones registradas para la fecha seleccionada.</p> : null}
        <p className="attendanceHint">Saldo = duración exigible de la clase − ausencia transcurrida. Mientras la clase está abierta, el saldo y el porcentaje indican lo máximo que todavía se podría alcanzar, no minutos ya asistidos. Los descansos oficiales no penalizan. La consulta no sustituye la asistencia oficial.</p>
      </section>
    </>}
  </div>;
}
