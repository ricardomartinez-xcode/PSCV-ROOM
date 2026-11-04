import type { TimeWindow } from "./permanencia-math";

/**
 * The attendance accounting interval is the SCHEDULED class interval.
 * actual_end_at is an administrative action timestamp, not a new class end:
 * closing late must never increase the number of required minutes.
 *
 * If a register was explicitly finalized before the scheduled ending, the
 * presence rows that the close action ended at the SAME timestamp represent
 * recorded attendance through the scheduled end (a certified projection).
 * Explicit earlier individual exits remain unchanged and still count.
 * This changes only in-memory calculations, never the underlying audit log.
 */
export type AccountingSession = {
  scheduled_start_at: string;
  scheduled_end_at: string;
  actual_end_at: string | null;
  status: "open" | "closed" | "cancelled";
};

function isoMillis(value: string): number {
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) throw new Error("Instante ISO de clase inválido");
  return millis;
}

export function accountingWindow(session: AccountingSession) {
  const start = isoMillis(session.scheduled_start_at);
  const end = isoMillis(session.scheduled_end_at);
  if (end <= start) throw new Error("El fin programado debe ser posterior al inicio");
  const actual = session.actual_end_at ? isoMillis(session.actual_end_at) : null;
  return {
    startAt: session.scheduled_start_at,
    endAt: session.scheduled_end_at,
    scheduledMinutes: (end - start) / 60_000,
    closedEarly: session.status === "closed" && actual !== null && actual < end,
    closedLate: session.status === "closed" && actual !== null && actual > end,
  };
}

/**
 * Preserve explicit exits; only administrative auto-closure of open presence
 * rows (whose end matches actual_end_at) is treated as attendance certified
 * through the scheduled finish. No mutation to stored timestamps.
 */
export function accountingPresence(session: AccountingSession, rows: TimeWindow[]): TimeWindow[] {
  const period = accountingWindow(session);
  if (!period.closedEarly || !session.actual_end_at) return rows;
  const closure = isoMillis(session.actual_end_at);
  const scheduledEnd = isoMillis(session.scheduled_end_at);
  return rows.map((row) => {
    if (!row.endAt || Math.abs(isoMillis(row.endAt) - closure) > 1000 ||
        isoMillis(row.startAt) > closure) return row;
    return { ...row, endAt: new Date(scheduledEnd).toISOString() };
  });
}
