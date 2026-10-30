/** Inclusive reporting bounds in the course calendar (Mexico City local dates). */
export type AttendancePeriod = "day" | "week" | "month";
export function attendancePeriodBounds(day: string, period: AttendancePeriod): { start: string; end: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      Number.isNaN(Date.parse(day + "T12:00:00Z")) ||
      new Date(day + "T12:00:00Z").toISOString().slice(0, 10) !== day) {
    throw new Error("Fecha inválida");
  }
  if (period === "day") return { start: day, end: day };
  const date = new Date(day + "T12:00:00Z");
  const iso = (value: Date) => value.toISOString().slice(0, 10);
  if (period === "week") {
    const monday = new Date(date);
    monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return { start: iso(monday), end: iso(sunday) };
  }
  return {
    start: day.slice(0, 8) + "01",
    end: iso(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12))),
  };
}
