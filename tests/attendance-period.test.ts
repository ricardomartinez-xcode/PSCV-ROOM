import test from "node:test";
import assert from "node:assert/strict";
import { attendancePeriodBounds } from "../lib/attendance-period.ts";

test("daily period is a single date", () => {
  assert.deepEqual(attendancePeriodBounds("2026-10-29", "day"), { start:"2026-10-29", end:"2026-10-29" });
});
test("week begins on Monday across month boundary", () => {
  assert.deepEqual(attendancePeriodBounds("2026-10-01", "week"), { start:"2026-09-28", end:"2026-10-04" });
});
test("month covers leap years and year rollover", () => {
  assert.deepEqual(attendancePeriodBounds("2028-02-20", "month"), { start:"2028-02-01", end:"2028-02-29" });
  assert.deepEqual(attendancePeriodBounds("2026-12-31", "month"), { start:"2026-12-01", end:"2026-12-31" });
});
test("invalid dates are rejected", () => {
  assert.throws(() => attendancePeriodBounds("2026-02-30", "month"));
});
