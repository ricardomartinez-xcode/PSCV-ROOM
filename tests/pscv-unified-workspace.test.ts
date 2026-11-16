import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("../components/app-shell-v5.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const style = readFileSync(new URL("../app/pscv-unified.css", import.meta.url), "utf8");
const attendance = readFileSync(new URL("../components/attendance-panel.tsx", import.meta.url), "utf8");
const student = readFileSync(new URL("../components/attendance-student-panel.tsx", import.meta.url), "utf8");

test("all principal workspaces use a shared identity without replacing Materials/Admin", () => {
  assert.match(layout, /import "\.\/pscv-unified\.css";/);
  assert.match(shell, /pscvUnifiedWorkspace density-/);
  for (const title of [
    "Calendario y agenda", "Tareas y actividades", "Registro de asistencia",
    "Actividades entregadas", "Lista de grupo", "Preferencias",
  ]) assert.ok(shell.includes(title), title);
  assert.match(shell, /className="pscvSectionIntro"/);
  assert.match(shell, /tab === "materials" \? \(/);
  assert.match(shell, /<MaterialLibrary previewSize=/);
  assert.match(shell, /<AdminHub/);
  assert.match(shell, /<ScheduleAndProfessors/);
});

test("new task controls respect the same edit permission", () => {
  assert.match(shell, /capabilities\.canEditTasks && \(activeNavTab === "calendar" \|\| activeNavTab === "tasks"\)/);
  assert.match(shell, /openTaskForm\(activeNavTab,/);
  assert.match(shell, /onCreate=\{capabilities\.canEditTasks \?/);
  assert.match(shell, /const filteredTasks = tasks\.filter/);
  assert.match(shell, /taskPriority === "all"/);
  assert.match(shell, /taskTime === "week"/);
  assert.match(shell, /taskTime === "overdue"/);
  assert.match(shell, /taskSort === "priority"/);
  assert.match(shell, /const resetTaskFilters =/);
});

test("calendar retains the agenda, month view and date-picker interaction", () => {
  assert.match(shell, /const monthActivityCount = new Set/);
  assert.match(shell, /setExpandedDay\(null\); setCursor\(new Date\(\)\)/);
  assert.match(shell, /className="calendarMobileMode"/);
  assert.match(shell, /onClick=\{\(\) => setMobileView\("agenda"\)\}/);
  assert.match(shell, /onClick=\{\(\) => setMobileView\("month"\)\}/);
  assert.match(shell, /onCreateDate\(key\)/);
});

test("responsive layout keeps tables selectable, navigation accessible, and original auth", () => {
  for (const token of ["--pscv-border", "--pscv-accent", "--pscv-shadow"]) assert.ok(style.includes(token));
  assert.match(style, /\.pscvUnifiedWorkspace \.bottomNav button\.active/);
  assert.match(style, /\.pscvUnifiedWorkspace \.taskListWorkspace \.dataRow/);
  assert.match(style, /\.pscvUnifiedWorkspace \.attendancePage/);
  assert.match(style, /\.pscvUnifiedWorkspace \.groupScreen/);
  assert.match(style, /\.pscvUnifiedWorkspace \.settingsScreen/);
  assert.match(style, /\.pscvUnifiedWorkspace \.scheduleScreen/);
  assert.match(style, /@media \(max-width: 560px\)/);
  assert.doesNotMatch(style, /position:\s*fixed/);
  assert.match(shell, /canViewAttendance=\{capabilities\.canViewAttendance\}/);
  assert.match(shell, /canAccessAdmin=\{capabilities\.canAccessAdmin\}/);
  assert.match(shell, /getSessionCapabilities\(profile\)/);
});

test("attendance calculations and student access are not modified by the styling", () => {
  assert.match(attendance, /accountingWindow\(session\)/);
  assert.match(attendance, /accountingPresence\(session, presence\)/);
  assert.match(attendance, /Asistencia del día/);
  assert.match(student, /Mi historial de asistencia/);
  assert.match(student, /attendancePeriodBounds\(date, period\)/);
});
