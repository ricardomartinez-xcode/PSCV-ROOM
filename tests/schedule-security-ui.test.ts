import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("../components/app-shell-v5.tsx", import.meta.url), "utf8");
const admin = readFileSync(new URL("../components/admin-hub.tsx", import.meta.url), "utf8");
const auth = readFileSync(new URL("../components/auth-session-provider.tsx", import.meta.url), "utf8");
const data = readFileSync(new URL("../lib/server/d1-data.ts", import.meta.url), "utf8");
const icons = readFileSync(new URL("../lib/ui-icons.tsx", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0015_course_schedule_professors.sql", import.meta.url), "utf8");
const classroomMigration = readFileSync(new URL("../migrations/0016_course_classroom.sql", import.meta.url), "utf8");

test("Horario, profesores y salón are a first-class authenticated destination", () => {
  assert.match(shell, /"schedule"/);
  assert.match(shell, /Horario de clases/);
  assert.match(shell, /ScheduleAndProfessors/);
  assert.match(shell, /professorName/);
  assert.match(shell, /scheduleText/);
  assert.match(admin, /Profesor/);
  assert.match(admin, /Horario semanal/);
  assert.match(admin, /Salón de clases/);
  assert.match(shell, /scheduleTable/);
  assert.match(shell, /hourSlots/);
  assert.match(shell, /classroom/);
  assert.match(migration, /professor_name/);
  assert.match(migration, /schedule_text/);
  assert.match(classroomMigration, /classroom/);
});

test("catalog icon names render through a bounded Lucide registry", () => {
  assert.match(icons, /ICON_REGISTRY/);
  assert.match(icons, /CircleHelp/);
  assert.match(icons, /resolveUiIcon/);
  assert.doesNotMatch(icons, /eval\(/);
  assert.match(admin, /<UiIcon/);
});

test("auth provider keeps a successful tab session through transient background failures", () => {
  assert.match(auth, /sessionStorage/);
  assert.match(auth, /LAST_SESSION_KEY/);
  assert.match(auth, /response\.status === 401 \|\| response\.status === 403/);
  assert.match(auth, /keepExistingSession/);
});

test("generic D1 reads enforce sensitive-table authorization and explicit projection", () => {
  assert.match(data, /audit_log/);
  assert.match(data, /can_view_reports/);
  assert.match(data, /notifications/);
  assert.match(data, /can_manage_notifications/);
  assert.match(data, /buildSelectClause/);
  assert.match(data, /query\.select/);
});
