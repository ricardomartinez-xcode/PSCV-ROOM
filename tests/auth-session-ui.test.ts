import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ACCESS_LOGOUT_PATH,
  canAccessAdminTab,
  getRoleLabel,
  getSessionCapabilities,
  type AuthSessionProfile,
} from "../lib/auth-permissions.ts";

const appShellSource = readFileSync(new URL("../components/app-shell-v5.tsx", import.meta.url), "utf8");
const authGateSource = readFileSync(new URL("../components/auth-gate.tsx", import.meta.url), "utf8");
const providerSource = readFileSync(new URL("../components/providers.tsx", import.meta.url), "utf8");
const authzSource = readFileSync(new URL("../lib/server/authz.ts", import.meta.url), "utf8");

function profile(role: AuthSessionProfile["role"], permissions: Partial<AuthSessionProfile> = {}): AuthSessionProfile {
  return {
    id: `${role}-1`,
    email: `${role}@example.com`,
    fullName: role,
    role,
    preferences: {
      calendarView: "month",
      taskDensity: "medium",
      materialPreviewSize: "medium",
      showCompleted: false,
      theme: "system",
    },
    canEditTasks: false,
    canDeleteTasks: false,
    canManageMaterials: false,
    canManageUsers: false,
    canManageSettings: false,
    canManageGroup: false,
    canManageNotifications: false,
    canViewReports: false,
    canManageR2: false,
    ...permissions,
  };
}

test("role labels distinguish student, admin and owner", () => {
  assert.equal(getRoleLabel(profile("student")), "Alumno");
  assert.equal(getRoleLabel(profile("admin")), "Administrador");
  assert.equal(getRoleLabel(profile("owner")), "Propietario");
});

test("student has no administrative capabilities", () => {
  const capabilities = getSessionCapabilities(profile("student", { canEditTasks: true }));

  assert.equal(capabilities.isStudent, true);
  assert.equal(capabilities.isAdmin, false);
  assert.equal(capabilities.isOwner, false);
  assert.equal(capabilities.canAccessAdmin, false);
  assert.equal(capabilities.canEditTasks, false);
  assert.equal(canAccessAdminTab(capabilities, "tasks"), false);
});

test("admin capabilities are limited by individual permission flags", () => {
  const capabilities = getSessionCapabilities(profile("admin", {
    canEditTasks: true,
    canManageUsers: false,
    canManageNotifications: true,
  }));

  assert.equal(capabilities.isAdmin, true);
  assert.equal(capabilities.isOwner, false);
  assert.equal(capabilities.canAccessAdmin, true);
  assert.equal(canAccessAdminTab(capabilities, "tasks"), true);
  assert.equal(canAccessAdminTab(capabilities, "users"), false);
  assert.equal(canAccessAdminTab(capabilities, "notifications"), true);
});

test("owner receives every administrative capability", () => {
  const capabilities = getSessionCapabilities(profile("owner"));

  assert.equal(capabilities.isOwner, true);
  assert.equal(capabilities.canEditTasks, true);
  assert.equal(capabilities.canDeleteTasks, true);
  assert.equal(capabilities.canManageUsers, true);
  assert.equal(capabilities.canManageR2, true);
  assert.equal(canAccessAdminTab(capabilities, "diagnostics"), true);
});

test("app shell uses the session provider instead of demo or Supabase profile fallback", () => {
  assert.match(providerSource, /AuthSessionProvider/);
  assert.match(authGateSource, /useAuthSession/);
  assert.match(appShellSource, /useAuthSession/);
  assert.doesNotMatch(appShellSource, /demoProfile|local-demo-admin|Entrar en demo|demo\.admin@pscv\.local/);
  assert.doesNotMatch(appShellSource, /from\("app_profiles"\)\.select\("\*"\)\.eq\("email"/);
});

test("logout redirects to the Cloudflare Access logout path", () => {
  assert.equal(ACCESS_LOGOUT_PATH, "/cdn-cgi/access/logout");
  assert.match(appShellSource, /window\.location\.assign\(ACCESS_LOGOUT_PATH\)/);
});

test("administrative server routes keep requirePermission authorization", () => {
  const protectedRoutes = [
    "../app/api/admin/notifications/route.ts",
    "../app/api/admin/notifications/generate/route.ts",
    "../app/api/admin/r2/import-materials/route.ts",
    "../app/api/admin/r2/status/route.ts",
    "../app/api/admin/students/route.ts",
    "../app/api/admin/tasks/route.ts",
    "../app/api/admin/tasks/[id]/route.ts",
    "../app/api/admin/tasks/[id]/materials/route.ts",
    "../app/api/reports/operations/route.ts",
    "../app/api/uploads/direct/route.ts",
  ];

  for (const route of protectedRoutes) {
    const source = readFileSync(new URL(route, import.meta.url), "utf8");
    assert.match(source, /requirePermission\(request,/u, `${route} must call requirePermission`);
  }

  assert.match(authzSource, /if \(profile\.role === "owner"\) return profile;/);
  assert.match(authzSource, /if \(profile\.role !== "admin"\) throw new HttpError\(403, "No autorizado\."\);/);
  assert.match(authzSource, /if \(!enabled\(profile\[grants\[permission\]\] as number\)\) throw new HttpError\(403, "No autorizado\."\);/);
});
