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


/**
 * Saldo decreciente para la interfaz: empieza con TODOS los minutos exigibles
 * programados y resta solo las ausencias transcurridas hasta el reloj de corte.
 *
 * En una sesión abierta, remainingMinutes y percentage representan el máximo
 * alcanzable, no minutos ya cursados ni asistencia final.
 * En una sesión cerrada, el saldo equivale a la permanencia real.
 */
export type PermanenciaSaldoResult = {
  requiredMinutes: number;
  absentMinutes: number;
  remainingMinutes: number;
  elapsedRequiredMinutes: number;
  exitCount: number;
  percentage: number | null;
  provisional: boolean;
};

export function calculateSaldoPermanencia(args: {
  classStartAt: string;
  classEndAt: string;
  presence: TimeWindow[];
  officialBreaks: TimeWindow[];
  now?: string;
  closed: boolean;
  /**
   * Por defecto, un hueco antes de la primera entrada es retardo/ausencia.
   * false: el estado explícito "Presente" confirma asistencia desde el inicio;
   * pasar lista más tarde no crea una falta retroactiva.
   */
  countInitialAbsence?: boolean;
}): PermanenciaSaldoResult {
  const start = parseTime(args.classStartAt);
  const end = parseTime(args.classEndAt);
  if (end <= start) throw new Error("La clase debe terminar después de comenzar.");

  const asOf = args.now === undefined ? Date.now() : parseTime(args.now);
  const full = calculatePermanencia({
    classStartAt: args.classStartAt,
    classEndAt: args.classEndAt,
    presence: [],
    officialBreaks: args.officialBreaks,
    now: args.now,
  });
  const cutoff = args.closed ? end : Math.min(Math.max(start, asOf), end);
  if (cutoff <= start) return {
    requiredMinutes: full.requiredMinutes,
    absentMinutes: 0,
    remainingMinutes: full.requiredMinutes,
    elapsedRequiredMinutes: 0,
    exitCount: 0,
    percentage: null,
    provisional: !args.closed,
  };

  // Al pasar lista de "Presente" 48 minutos después del comienzo,
  // se considera presente desde el inicio, siempre que exista al menos
  // una entrada registrada. Se conservan intactos los intervalos originales
  // para auditar posteriores salidas y regresos.
  const firstArrival = args.presence.length > 0
    ? Math.min(...args.presence.map((window) => parseTime(window.startAt)))
    : null;
  const syntheticOpening: TimeWindow[] =
    args.countInitialAbsence === false && firstArrival !== null && firstArrival > start
      ? [{ startAt: args.classStartAt, endAt: new Date(firstArrival).toISOString() }]
      : [];
  const elapsed = calculatePermanencia({
    classStartAt: args.classStartAt,
    classEndAt: new Date(cutoff).toISOString(),
    presence: [...syntheticOpening, ...args.presence],
    officialBreaks: args.officialBreaks,
    now: args.now,
  });

  // Un evento de salida acaba un intervalo de presencia. Al cerrar la clase
  // automáticamente, NO se cuenta ese cierre como una salida anticipada.
  const exitTimes = new Set(
    args.presence
      .filter((window) => window.endAt !== null)
      .map((window) => parseTime(window.endAt!))
      .filter((exit) => exit >= start && exit < end && exit <= cutoff),
  );
  const remainingMinutes = Math.max(0, Math.round(
    (full.requiredMinutes - elapsed.absentMinutes) * 10,
  ) / 10);
  return {
    requiredMinutes: full.requiredMinutes,
    absentMinutes: elapsed.absentMinutes,
    remainingMinutes,
    elapsedRequiredMinutes: elapsed.requiredMinutes,
    exitCount: exitTimes.size,
    percentage: full.requiredMinutes === 0 ? null
      : Math.round(remainingMinutes / full.requiredMinutes * 1000) / 10,
    provisional: !args.closed,
  };
}
