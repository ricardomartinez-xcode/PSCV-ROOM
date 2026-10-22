import test from "node:test";
import assert from "node:assert/strict";
import { getRoleLabel, getSessionCapabilities } from "../lib/auth-permissions.ts";
import type { Profile } from "../lib/app-data.ts";

function user(role: Profile["role"], profileRole: Profile["profileRole"], permissions = false): Profile {
  return {
    id: profileRole, email: profileRole + "@example.org", fullName: "Cuenta de prueba",
    role, profileRole,
    preferences: { calendarView: "month", taskDensity: "medium", materialPreviewSize: "medium", showCompleted: false, theme: "system" },
    canEditTasks: permissions, canDeleteTasks: permissions, canManageMaterials: permissions,
    canManageUsers: permissions, canManageSettings: permissions, canManageGroup: permissions,
    canManageNotifications: permissions, canViewReports: permissions, canManageR2: permissions,
  };
}
test("interfaz únicamente muestra Administrador, Profesor o Alumno", () => {
  assert.equal(getRoleLabel(user("owner", "administrator")), "Administrador");
  assert.equal(getRoleLabel(user("admin", "professor")), "Profesor");
  assert.equal(getRoleLabel(user("student", "student")), "Alumno");
});

test("profesor administra asistencia sin privilegios de usuarios, informes globales o configuración", () => {
  const capabilities = getSessionCapabilities(user("admin", "professor", true));
  assert.equal(capabilities.canManageAttendance, true);
  assert.equal(capabilities.canViewAttendance, true);
  assert.equal(capabilities.canManageUsers, false);
  assert.equal(capabilities.canManageSettings, false);
  assert.equal(capabilities.canViewReports, false);
  assert.equal(capabilities.canAccessAdmin, false);
});

test("alumno solo puede ver su propia asistencia, no modificarla", () => {
  const capabilities = getSessionCapabilities(user("student", "student", true));
  assert.equal(capabilities.canViewAttendance, true);
  assert.equal(capabilities.canManageAttendance, false);
  assert.equal(capabilities.canAccessAdmin, false);
});

test("administrador tiene permiso de asistencia al gestionar el grupo", () => {
  const admin = getSessionCapabilities(user("admin", "administrator", true));
  assert.equal(admin.canManageAttendance, true);
  assert.equal(admin.canManageUsers, true);
  assert.equal(admin.canAccessAdmin, true);
  const restricted = getSessionCapabilities(user("admin", "administrator", false));
  assert.equal(restricted.canManageAttendance, false);
});
