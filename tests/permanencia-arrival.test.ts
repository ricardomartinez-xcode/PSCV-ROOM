import assert from "node:assert/strict";
import test from "node:test";
import { resolveLateArrival } from "../lib/permanencia-arrival.ts";
const base = {
  sessionDate: "2026-10-22",
  scheduledStartAt: "2026-10-23T00:00:00.000Z",
  scheduledEndAt: "2026-10-23T03:00:00.000Z",
  recordedAt: "2026-10-23T01:30:00.000Z",
};
const session = base;
test("usa llegada real de 18:10 incluso si se pasa lista a las 19:30", () => {
  assert.equal(resolveLateArrival({ ...session, arrivalLocal: "18:10" }), "2026-10-23T00:10:00.000Z");
});
test("permite corregir un retardo previo sin reescribir las salidas", () => {
  assert.equal(resolveLateArrival({ ...session, arrivalLocal: "18:20", firstPresenceEndAt: "2026-10-23T01:00:00.000Z" }), "2026-10-23T00:20:00.000Z");
});
test("rechaza hora futura", () => {
  assert.throws(() => resolveLateArrival({ ...session, arrivalLocal: "20:10" }), /futuro/);
});
test("rechaza llegada fuera de clase", () => {
  assert.throws(() => resolveLateArrival({ ...session, arrivalLocal: "17:50" }), /dentro/);
  assert.throws(() => resolveLateArrival({ ...session, arrivalLocal: "21:15", recordedAt: "2026-10-23T05:00:00.000Z" }), /dentro/);
});
test("rechaza hora posterior a salida existente", () => {
  assert.throws(() => resolveLateArrival({ ...session, arrivalLocal: "19:15", firstPresenceEndAt: "2026-10-23T01:00:00.000Z" }), /salida/);
});
test("rechaza formatos inválidos", () => {
  assert.throws(() => resolveLateArrival({ ...session, arrivalLocal: "8:10" }), /HH:mm/);
  assert.throws(() => resolveLateArrival({ ...session, arrivalLocal: "18:67" }), /HH:mm/);
});
