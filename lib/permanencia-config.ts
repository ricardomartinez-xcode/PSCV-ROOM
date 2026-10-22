/**
 * Configuración de descansos por franja horaria de PSCV-ROOM.
 * Las clases de >= 180 minutos sugieren descanso VARIABLE (sin inventar su horario).
 * Las clases más cortas NO tienen descanso por defecto.
 * El responsable puede cambiar el modo por franja y por sesión.
 */
export type BreakMode = "none" | "variable" | "fixed" | "mixed";

export type SchedulePreset = {
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  courseName: string;
  startLocal: string;
  endLocal: string;
  durationMinutes: number;
  defaultBreakMode: BreakMode;
};

export const MEXICO_CITY_TIMEZONE = "America/Mexico_City";

function clockToMinutes(clock: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) {
    throw new Error("La hora debe tener formato HH:mm.");
  }
  const [hours, minutes] = clock.split(":").map(Number);
  return hours * 60 + minutes;
}

export function durationMinutes(startLocal: string, endLocal: string): number {
  const duration = clockToMinutes(endLocal) - clockToMinutes(startLocal);
  if (duration <= 0 || duration > 12 * 60) {
    throw new Error("El horario debe terminar después del inicio y durar hasta 12 horas.");
  }
  return duration;
}

export function defaultBreakMode(startLocal: string, endLocal: string): BreakMode {
  return durationMinutes(startLocal, endLocal) >= 180 ? "variable" : "none";
}

/**
 * Estos horarios corresponden a la imagen facilitada por el responsable.
 * No se escriben automáticamente en D1 ni reemplazan materias existentes.
 */
const fromImage: Array<Pick<SchedulePreset, "weekday" | "courseName" | "startLocal" | "endLocal">> = [
  { weekday: 1, courseName: "Inglés VII", startLocal: "16:00", endLocal: "18:00" },
  { weekday: 1, courseName: "Evaluación Psicológica II", startLocal: "18:00", endLocal: "21:00" },
  { weekday: 2, courseName: "Procesos Grupales y Manejo Constructivo de Conflictos", startLocal: "15:00", endLocal: "18:00" },
  { weekday: 2, courseName: "Diagnóstico Psicométrico", startLocal: "18:00", endLocal: "21:00" },
  { weekday: 3, courseName: "Inglés VII", startLocal: "16:00", endLocal: "17:00" },
  { weekday: 3, courseName: "Modificación de la Conducta", startLocal: "17:00", endLocal: "19:00" },
  { weekday: 4, courseName: "Psicología Educativa", startLocal: "15:00", endLocal: "18:00" },
];

export const suggestedPermanenceSchedule: ReadonlyArray<SchedulePreset> = fromImage.map((slot) => ({
  ...slot,
  durationMinutes: durationMinutes(slot.startLocal, slot.endLocal),
  defaultBreakMode: defaultBreakMode(slot.startLocal, slot.endLocal),
}));

export function validateFixedBreaks(
  startLocal: string,
  endLocal: string,
  breaks: Array<{ startLocal: string; endLocal: string }>,
) {
  const duration = durationMinutes(startLocal, endLocal);
  const start = clockToMinutes(startLocal);
  let sum = 0;
  for (const rest of breaks) {
    const from = clockToMinutes(rest.startLocal);
    const to = clockToMinutes(rest.endLocal);
    if (from < start || to > start + duration || from >= to) {
      throw new Error("Los descansos deben tener inicio y fin dentro del horario de clase.");
    }
    sum += to - from;
  }
  if (sum >= duration) throw new Error("El descanso no puede ocupar toda la clase.");
  // Los recesos que se solapan se fusionan al calcular la permanencia.
  return breaks;
}
