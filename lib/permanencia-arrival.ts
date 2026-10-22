/**
 * Interpretación de la hora REAL de llegada para un retardo.
 * Las franjas de PSCV-ROOM pertenecen a America/Mexico_City (UTC-06, sin DST).
 * La API verifica la fecha y los límites en servidor; nunca usa la hora en que
 * el administrador pulsó "Retardo" como sustituto de la llegada observada.
 */
export function resolveLateArrival(args: {
  sessionDate: string;
  arrivalLocal: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  recordedAt: string;
  firstPresenceEndAt?: string | null;
}): string {
  const { sessionDate, arrivalLocal, scheduledStartAt, scheduledEndAt, recordedAt, firstPresenceEndAt } = args;
  const day = Date.parse(sessionDate + "T12:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate) ||
      !Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== sessionDate) {
    throw new Error("La fecha de la sesión no es válida.");
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(arrivalLocal)) {
    throw new Error("Selecciona una hora de llegada válida (HH:mm).");
  }
  const arrival = new Date(sessionDate + "T" + arrivalLocal + ":00-06:00").getTime();
  const start = Date.parse(scheduledStartAt);
  const end = Date.parse(scheduledEndAt);
  const now = Date.parse(recordedAt);
  if (![arrival, start, end, now].every(Number.isFinite) || end <= start) {
    throw new Error("El horario de la sesión no es válido.");
  }
  if (arrival < start || arrival > end) {
    throw new Error("La hora de llegada debe estar dentro del horario de clase.");
  }
  if (arrival > now) {
    throw new Error("La hora de llegada no puede estar en el futuro.");
  }
  if (firstPresenceEndAt && arrival >= Date.parse(firstPresenceEndAt)) {
    throw new Error("La llegada no puede ser posterior a una salida ya registrada.");
  }
  return new Date(arrival).toISOString();
}
