import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateDaysRemaining,
  dateKeyInTimeZone,
} from "../lib/task-utils.ts";

test("academic date keys use Mexico City instead of the runtime host timezone", () => {
  const instant = new Date("2026-07-17T03:30:00.000Z");
  assert.equal(dateKeyInTimeZone(instant), "2026-07-16");
});

test("remaining-day labels are stable around UTC midnight", () => {
  const instant = new Date("2026-07-17T03:30:00.000Z");
  assert.equal(calculateDaysRemaining("2026-07-16", instant), 0);
  assert.equal(calculateDaysRemaining("2026-07-17", instant), 1);
  assert.equal(calculateDaysRemaining("2026-07-15", instant), -1);
});
