/**
 * Cálculo de permanencia efectiva. Todas las fechas son ISO-8601 con zona.
 * No se usa el pase de lista para inferir presencia continua.
 */
export type TimeWindow = { startAt: string; endAt: string | null };

type MillisWindow = { start: number; end: number };

export type PermanenciaResult = {
  scheduledMinutes: number;
  officialBreakMinutes: number;
  requiredMinutes: number;
  presentMinutes: number;
  absentMinutes: number;
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
  return windows.reduce((sum, w) => sum + w.end - w.start, 0);
}

function intersectionMinutes(a: MillisWindow[], b: MillisWindow[]): number {
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
  const actual = Math.max(0, Math.min(required, total(presence) - intersectionMinutes(presence, breaks)));
  const minute = (ms: number) => Math.round(ms / 60000 * 10) / 10;
  return {
    scheduledMinutes: minute(duration),
    officialBreakMinutes: minute(breakDuration),
    requiredMinutes: minute(required),
    presentMinutes: minute(actual),
    absentMinutes: minute(required - actual),
    percentage: required === 0 ? null : Math.round(actual / required * 1000) / 10,
  };
}
