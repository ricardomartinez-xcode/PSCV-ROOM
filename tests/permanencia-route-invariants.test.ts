import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/admin/attendance/route.ts", import.meta.url), "utf8");
const ownRoute = readFileSync(new URL("../app/api/attendance/me/route.ts", import.meta.url), "utf8");
const panel = readFileSync(new URL("../components/attendance-panel.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../components/attendance-panel.css", import.meta.url), "utf8");

test("student and administrative views account from the same scheduled session boundary", () => {
  assert.match(panel, /accountingWindow\(session\)/);
  assert.match(panel, /accountingPresence\(session, presence\)/);
  assert.match(ownRoute, /accountingWindow\(/);
  assert.match(ownRoute, /accountingPresence\(/);
  assert.doesNotMatch(ownRoute, /session\.status === "open" \? session\.scheduled_end_at : session\.actual_end_at/);
});
test("one action sets presence to the intended state, not an accidental double toggle", () => {
  assert.match(route, /z\.literal\("set_presence"\)/);
  assert.match(route, /const wantPresent = action === "set_presence" \? cmd\.present/);
  assert.match(route, /if \(Boolean\(open\) === wantPresent\) return json\(\{ ok: true, unchanged: true \}\)/);
  assert.match(panel, /action: "set_presence", sessionId: selected\.id/);
});
test("retrospective present marks are bounded and reconfirming presence cannot forge reentry", () => {
  assert.match(route, /const previouslyEntered = await db\.prepare/);
  assert.match(route, /const retrospective = now >= session\.scheduled_end_at/);
  assert.match(route, /retrospective \? session\.scheduled_start_at : now/);
  assert.match(route, /retrospective \? session\.scheduled_end_at : null/);
});
test("editing an old recorded break requires course authorization and produces an audit log", () => {
  assert.match(route, /z\.literal\("correct_break"\)/);
  assert.match(route, /if \(cmd\.action === "correct_break"\)/);
  assert.match(route, /await requireCourseAccess\(db, actor, session\.course_id\)/);
  assert.match(route, /attendance\.break\.corrected/);
  assert.match(panel, /¿Confirmas la corrección del descanso oficial\?/);
});
test("interface shows the exact arithmetic and its server cut-off, without perpetual counters", () => {
  assert.match(panel, /dayTotals\.scheduled\.toFixed\(1\)/);
  assert.match(panel, /dayTotals\.breaks\.toFixed\(1\)/);
  assert.match(panel, /dayTotals\.required\.toFixed\(1\)/);
  assert.match(panel, /formatClock\(snapshot\.serverNow\)/);
  assert.match(panel, /visibilitychange/);
  assert.doesNotMatch(panel, /setInterval\(/);
  assert.doesNotMatch(panel, /setTimeout\(/);
  assert.match(styles, /\.attendanceRegisterFilters/);
  assert.match(styles, /\.attendanceRegisterTable/);
  assert.match(styles, /@media\(max-width:720px\)/);
});
