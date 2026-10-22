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

test("dos salidas descuentan 30 minutos de los 165 exigibles", () => {
  const result = calculatePermanencia({
    ...base,
    presence: [span("18:00", "19:00"), span("19:20", "20:20"), span("20:30", "21:00")],
    officialBreaks: [span("19:30", "19:45")],
  });
  assert.equal(result.requiredMinutes, 165);
  assert.equal(result.absentMinutes, 30);
  assert.equal(result.presentMinutes, 135);
  assert.equal(result.exitCount, 2);
  assert.equal(result.percentage, 81.8);
});

test("retardo se descuenta desde el inicio sin contarse como salida", () => {
  const result = calculatePermanencia({
    ...base,
    presence: [span("18:20", "21:00")],
    officialBreaks: [span("19:30", "19:45")],
  });
  assert.equal(result.absentMinutes, 20);
  assert.equal(result.exitCount, 0);
  assert.equal(result.percentage, 87.9);
});

test("salir únicamente durante el descanso no penaliza permanencia", () => {
  const result = calculatePermanencia({
    ...base,
    presence: [span("18:00", "19:30"), span("19:45", "21:00")],
    officialBreaks: [span("19:30", "19:45")],
  });
  assert.equal(result.absentMinutes, 0);
  assert.equal(result.exitCount, 1);
  assert.equal(result.percentage, 100);
});

test("ausente explícito sin intervalos conserva cero por ciento de permanencia", () => {
  const result = calculatePermanencia({
    ...base,
    presence: [],
    officialBreaks: [span("19:30", "19:45")],
  });
  assert.equal(result.absentMinutes, 165);
  assert.equal(result.presentMinutes, 0);
  assert.equal(result.exitCount, 0);
  assert.equal(result.percentage, 0);
});

test("salida sin regreso descuenta el resto de una sesión cerrada", () => {
  const result = calculatePermanencia({
    ...base,
    presence: [span("18:00", "20:30")],
    officialBreaks: [span("19:30", "19:45")],
  });
  assert.equal(result.absentMinutes, 30);
  assert.equal(result.exitCount, 1);
  assert.equal(result.percentage, 81.8);
});

test("sesión abierta resta ausencia únicamente hasta el momento de consulta", () => {
  const result = calculatePermanencia({
    classStartAt: d("18:00"),
    classEndAt: d("19:00"),
    presence: [span("18:00", "18:30")],
    officialBreaks: [],
    now: d("19:00"),
  });
  assert.equal(result.requiredMinutes, 60);
  assert.equal(result.absentMinutes, 30);
  assert.equal(result.exitCount, 1);
  assert.equal(result.percentage, 50);
});

test("descanso superpuesto a ausencia no se descuenta dos veces", () => {
  const result = calculatePermanencia({
    ...base,
    presence: [span("18:00", "19:25"), span("20:00", "21:00")],
    officialBreaks: [span("19:30", "19:45"), span("19:40", "19:55")],
  });
  assert.equal(result.officialBreakMinutes, 25);
  assert.equal(result.absentMinutes, 10);
  assert.equal(result.requiredMinutes, 155);
  assert.equal(result.presentMinutes, 145);
  assert.equal(result.exitCount, 1);
  assert.equal(result.percentage, 93.5);
});

test("intervalos solapados no duplican salidas ni ausencia", () => {
  const result = calculatePermanencia({
    ...base,
    presence: [span("18:00", "19:00"), span("18:30", "19:15"), span("19:45", "21:00")],
    officialBreaks: [],
  });
  assert.equal(result.absentMinutes, 30);
  assert.equal(result.exitCount, 1);
  assert.equal(result.percentage, 83.3);
});
