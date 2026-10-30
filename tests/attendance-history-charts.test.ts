import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { attendancePeriodBounds } from "../lib/attendance-period.ts";

const panel = readFileSync(new URL("../components/attendance-panel.tsx", import.meta.url), "utf8");
const student = readFileSync(new URL("../components/attendance-student-panel.tsx", import.meta.url), "utf8");
const chart = readFileSync(new URL("../components/attendance-history-chart.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../app/api/admin/attendance/route.ts", import.meta.url), "utf8");

test("weekly selection includes October 27 to 29, 2026", () => {
  const bounds = attendancePeriodBounds("2026-10-30", "week");
  assert.equal(bounds.start, "2026-10-26");
  assert.equal(bounds.end, "2026-11-01");
});
test("class history uses weekly records by default, not a single day", () => {
  assert.match(panel, /useState<AttendancePeriod>\("week"\)/);
  assert.match(panel, /Historial de clases registradas/);
  assert.match(panel, /setSelectedSessionId\(session.id\)/);
  assert.match(panel, /setDate\(session.session_date\)/);
  assert.match(api, /s\.session_date BETWEEN \? AND \?/);
});
test("clicking a student loads all authorized classes for the month and renders charts", () => {
  assert.match(panel, /<StudentHistoryDialog/);
  assert.match(panel, /&period=month/);
  assert.match(panel, /<AttendanceHistoryChart/);
  assert.match(panel, /visibleSessions\.map/);
  assert.match(panel, /courseFilter === "all"/);
  assert.match(student, /useState<AttendancePeriod>\("week"\)/);
  assert.match(student, /<AttendanceHistoryChart/);
});
test("graph marks absent evidence as unknown, never zero percent", () => {
  assert.match(chart, /percentage: number \| null/);
  assert.match(chart, /known && <div/);
  assert.match(chart, /Sin registro/);
  assert.match(chart, /point\.provisional/);
});
