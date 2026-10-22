/**
 * Permanencia por descuento de ausencias (ISO 8601 con zona horaria).
 *
 * Los eventos de entrada/salida originales siguen siendo la evidencia auditable.
 * Se obtiene su complemento dentro de la sesión y se descuentan los descansos
 * oficiales de la ausencia y del tiempo exigible, sin contabilizarlos dos veces.
 */
export type TimeWindow = { startAt: string; endAt: string | null };

type MillisWindow = { start: number; end: number };

export type PermanenciaResult = {
  scheduledMinutes: number;
  officialBreakMinutes: number;
  requiredMinutes: number;
  absentMinutes: number;
  presentMinutes: number;
  exitCount: number;
  percentage: number | null;
};

function parseTime(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("Fecha u hora ISO inválida.");
  return parsed;
}

function mergeWindows(windows: MillisWindow[]): MillisWindow[] {
  const sorted = [...windows].filter((w) => w.end > w.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const result: MillisWindow[] = [];
  for (const window of sorted) {
    const last = result[result.length - 1];
    if (last && window.start <= last.end) last.end = Math.max(last.end, window.end);
    else result.push({ ...window });
  }
  return result;
}

function normalize(windows: TimeWindow[], start: number, end: number, now: number): MillisWindow[] {
  return mergeWindows(windows.map((w) => ({
    start: Math.max(start, parseTime(w.startAt)),
    end: Math.min(end, w.endAt === null ? now : parseTime(w.endAt)),
  })));
}

function total(windows: MillisWindow[]): number {
  return windows.reduce((sum, window) => sum + window.end - window.start, 0);
}

function intersectionMilliseconds(a: MillisWindow[], b: MillisWindow[]): number {
  let i = 0;
  let j = 0;
  let milliseconds = 0;
  while (i < a.length && j < b.length) {
    const left = Math.max(a[i].start, b[j].start);
    const right = Math.min(a[i].end, b[j].end);
    if (right > left) milliseconds += right - left;
    if (a[i].end < b[j].end) i++;
    else j++;
  }
  return milliseconds;
}

/** Complemento de la presencia dentro de la clase, incluido retardo y salida final. */
function absenceGaps(presence: MillisWindow[], start: number, end: number): MillisWindow[] {
  const gaps: MillisWindow[] = [];
  let cursor = start;
  for (const interval of presence) {
    if (interval.start > cursor) gaps.push({ start: cursor, end: interval.start });
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < end) gaps.push({ start: cursor, end });
  return gaps;
}

export function calculatePermanencia(args: {
  classStartAt: string;
  classEndAt: string;
  presence: TimeWindow[];
  officialBreaks: TimeWindow[];
  now?: string;
}): PermanenciaResult {
  const start = parseTime(args.classStartAt);
  const end = parseTime(args.classEndAt);
  if (end <= start) throw new Error("La clase debe terminar después de comenzar.");
  const now = args.now === undefined ? Date.now() : parseTime(args.now);
  const breaks = normalize(args.officialBreaks, start, end, now);
  const presence = normalize(args.presence, start, end, now);

  const duration = end - start;
  const breakDuration = total(breaks);
  const required = duration - breakDuration;
  const gaps = absenceGaps(presence, start, end);
  const absent = Math.min(required, Math.max(0,
    total(gaps) - intersectionMilliseconds(gaps, breaks),
  ));
  const present = required - absent;
  const minutes = (ms: number) => Math.round(ms / 60000 * 10) / 10;

  return {
    scheduledMinutes: minutes(duration),
    officialBreakMinutes: minutes(breakDuration),
    requiredMinutes: minutes(required),
    absentMinutes: minutes(absent),
    presentMinutes: minutes(present),
    // La ausencia inicial por retardo NO es una salida registrada.
    // El cierre automático de presencia exactamente al terminar la clase
    // tampoco se interpreta como salida anticipada.
    exitCount: gaps.filter((gap) => gap.start > start && gap.start < end).length,
    percentage: required === 0 ? null : Math.round(present / required * 1000) / 10,
  };
}
