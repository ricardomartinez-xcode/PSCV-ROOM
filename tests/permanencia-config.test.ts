import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultBreakMode,
  durationMinutes,
  suggestedPermanenceSchedule,
  validateFixedBreaks,
} from "../lib/permanencia-config.ts";

test("solo sesiones de 3 horas o más tienen descanso variable por defecto", () => {
  assert.equal(defaultBreakMode("15:00", "18:00"), "variable");
  assert.equal(defaultBreakMode("18:00", "21:00"), "variable");
  assert.equal(defaultBreakMode("16:00", "18:00"), "none");
  assert.equal(defaultBreakMode("16:00", "17:00"), "none");
});

test("los siete bloques del horario se respetan sin inventar recesos", () => {
  assert.equal(suggestedPermanenceSchedule.length, 7);
  const withBreak = suggestedPermanenceSchedule.filter((slot) => slot.defaultBreakMode === "variable");
  assert.equal(withBreak.length, 4);
  assert.ok(withBreak.every((slot) => slot.durationMinutes === 180));
  assert.ok(suggestedPermanenceSchedule.every((slot) => ["variable", "none"].includes(slot.defaultBreakMode)));
});

test("los horarios inválidos no producen duraciones ficticias", () => {
  assert.equal(durationMinutes("17:00", "19:00"), 120);
  assert.throws(() => durationMinutes("21:00", "18:00"));
  assert.throws(() => durationMinutes("9:00", "10:00"));
});

test("recesos fijos configurados deben caber dentro de la sesión", () => {
  assert.deepEqual(
    validateFixedBreaks("18:00", "21:00", [{ startLocal: "19:30", endLocal: "19:45" }]),
    [{ startLocal: "19:30", endLocal: "19:45" }],
  );
  assert.throws(() => validateFixedBreaks("18:00", "21:00", [{ startLocal: "17:50", endLocal: "18:15" }]));
});
