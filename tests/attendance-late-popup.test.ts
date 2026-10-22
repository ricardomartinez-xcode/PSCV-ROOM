import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveLateArrival } from "../lib/permanencia-arrival.ts";
import { calculateSaldoPermanencia } from "../lib/permanencia-math.ts";

const ui = readFileSync(new URL("../components/attendance-panel.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../app/api/admin/attendance/route.ts", import.meta.url), "utf8");

test("pulsar Retardo abre un popup con un campo time y confirmación", () => {
  assert.match(ui, /status === "late"\s*\?\s*openLateDialog/);
  assert.match(ui, /role="dialog" aria-modal="true"/);
  assert.match(ui, /type="time" step=\{60\} required/);
  assert.match(ui, /Hora real de llegada/);
  assert.match(ui, /Guardar retardo/);
  assert.match(ui, /arrivalLocal: lateDialog\.arrivalLocal/);
});

test("la API exige hora real, la valida en servidor y conserva auditoría", () => {
  assert.match(api, /if \(!cmd\.arrivalLocal\)/);
  assert.match(api, /resolveLateArrival\(/);
  assert.match(api, /await db\.batch\(changes\)/);
  assert.match(api, /firstArrivalAt: firstPresence\?\.start_at/);
  assert.match(api, /actualArrivalAt: actualArrival/);
});

test("hora 18:10 registrada a las 19:30 resta 10 minutos, no 90", () => {
  const start = "2026-10-23T00:00:00.000Z";
  const end = "2026-10-23T03:00:00.000Z";
  const now = "2026-10-23T01:30:00.000Z";
  const arrival = resolveLateArrival({
    sessionDate: "2026-10-22", arrivalLocal: "18:10",
    scheduledStartAt: start, scheduledEndAt: end, recordedAt: now,
  });
  const total = calculateSaldoPermanencia({
    classStartAt: start, classEndAt: end,
    presence: [{ startAt: arrival, endAt: null }],
    officialBreaks: [], now, closed: false, countInitialAbsence: true,
  });
  assert.equal(total.absentMinutes, 10);
  assert.equal(total.remainingMinutes, 170);
  assert.equal(total.percentage, 94.4);
});

test("una corrección de Retardo no elimina salidas posteriores", () => {
  const start = "2026-10-23T00:00:00.000Z";
  const end = "2026-10-23T03:00:00.000Z";
  const now = "2026-10-23T01:30:00.000Z";
  const arrival = resolveLateArrival({
    sessionDate: "2026-10-22", arrivalLocal: "18:10",
    scheduledStartAt: start, scheduledEndAt: end,
    recordedAt: now, firstPresenceEndAt: "2026-10-23T01:00:00.000Z",
  });
  const total = calculateSaldoPermanencia({
    classStartAt: start, classEndAt: end,
    presence: [
      { startAt: arrival, endAt: "2026-10-23T01:00:00.000Z" },
      { startAt: "2026-10-23T01:05:00.000Z", endAt: null },
    ],
    officialBreaks: [], now, closed: false, countInitialAbsence: true,
  });
  assert.equal(total.absentMinutes, 15);
  assert.equal(total.remainingMinutes, 165);
  assert.equal(total.exitCount, 1);
});
