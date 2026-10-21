import assert from "node:assert/strict";
import test from "node:test";
import { calculatePermanencia, type TimeWindow } from "../lib/permanencia-math.ts";

const d = (time: string) => "2026-10-21T" + time + ":00-06:00";
const span = (start: string, end: string | null): TimeWindow => ({
  startAt: d(start), endAt: end === null ? null : d(end),
});
const base = { classStartAt: d("18:00"), classEndAt: d("21:00") };

test("descanso completo autorizado, sin penalización", () => {
  const result = calculatePermanencia({
    ...base, presence: [span("18:00", "19:30"), span("19:45", "21:00")],
    officialBreaks: [span("19:30", "19:45")],
  });
  assert.equal(result.requiredMinutes, 165);
  assert.equal(result.presentMinutes, 165);
  assert.equal(result.percentage, 100);
});

test("pase de lista de quince minutos no equivale a clase completa", () => {
  const result = calculatePermanencia({
    ...base, presence: [span("18:00", "18:15")],
    officialBreaks: [span("19:30", "19:45")],
  });
  assert.equal(result.percentage, 9.1);
});

test("salidas y reingresos acumulan intervalos descontando descanso", () => {
  const result = calculatePermanencia({
    ...base,
    presence: [span("18:00", "19:00"), span("19:30", "20:00")],
    officialBreaks: [span("19:30", "19:45")],
  });
  assert.equal(result.presentMinutes, 75);
  assert.equal(result.percentage, 45.5);
});

test("descansos fijos y variables superpuestos se descuentan una vez", () => {
  const result = calculatePermanencia({
    ...base,
    presence: [span("18:00", "21:00")],
    officialBreaks: [span("19:30", "19:45"), span("19:40", "19:55")],
  });
  assert.equal(result.officialBreakMinutes, 25);
  assert.equal(result.requiredMinutes, 155);
  assert.equal(result.percentage, 100);
});

test("intervalos de presencia superpuestos no exceden cien por ciento", () => {
  const result = calculatePermanencia({
    ...base,
    presence: [span("18:00", "20:00"), span("19:00", "21:00")],
    officialBreaks: [],
  });
  assert.equal(result.presentMinutes, 180);
  assert.equal(result.percentage, 100);
});

test("descanso variable en curso usa el reloj de corte", () => {
  const result = calculatePermanencia({
    ...base,
    presence: [span("18:00", null)],
    officialBreaks: [span("19:30", null)],
    now: d("19:45"),
  });
  assert.equal(result.officialBreakMinutes, 15);
  assert.equal(result.presentMinutes, 90);
  assert.equal(result.percentage, 54.5);
});

test("si toda la sesión está en descanso, porcentaje no definido", () => {
  const result = calculatePermanencia({
    ...base, presence: [], officialBreaks: [span("18:00", "21:00")],
  });
  assert.equal(result.requiredMinutes, 0);
  assert.equal(result.percentage, null);
});

test("intervalos fuera de la clase se recortan a sus límites", () => {
  const result = calculatePermanencia({
    ...base, presence: [span("17:00", "22:00")],
    officialBreaks: [span("17:00", "18:15")],
  });
  assert.equal(result.officialBreakMinutes, 15);
  assert.equal(result.percentage, 100);
});
