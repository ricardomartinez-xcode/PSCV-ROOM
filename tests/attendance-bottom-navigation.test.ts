import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("../components/app-shell-v5.tsx", import.meta.url), "utf8");
const nav = shell.match(/<nav className=\{`bottomNav[\s\S]*?<\/nav>/)?.[0];

test("la barra inferior muestra Asistencia en lugar de Horario", () => {
  assert.ok(nav, "La barra inferior debe existir.");
  assert.match(nav, /capabilities\.canViewAttendance/);
  assert.match(nav, /go\("attendance"\)/);
  assert.match(nav, /activeNavTab === "attendance"/);
  assert.match(nav, /<ClipboardCheck size=\{22\} \/>Asistencia<\/button>/);
  assert.doesNotMatch(nav, /go\("schedule"\)/);
  assert.doesNotMatch(nav, />Horario<\/button>/);
});

test("Horario permanece disponible en el menú lateral", () => {
  assert.match(shell, /label="Horario" active=\{active === "schedule"\} onClick=\{\(\) => onSelect\("schedule"\)\}/);
  assert.match(shell, /tab === "schedule" \? <ScheduleAndProfessors/);
});

test("el botón Asistencia utiliza la vista correspondiente al rol", () => {
  assert.match(shell, /tab === "attendance" && capabilities\.canViewAttendance/);
  assert.match(shell, /capabilities\.canManageAttendance \? <AttendancePanel \/> : <AttendanceStudentPanel \/>/);
});
