import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hub = readFileSync(new URL("../components/admin-hub.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/admin-experience.css", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");

test("admin uses a single grouped desktop navigation and mobile select", () => {
  for (const label of ["Panel principal", "Organización académica", "Personas y comunicación", "Análisis y sistema"]) {
    assert.ok(hub.includes(label));
  }
  assert.ok(hub.includes('className="adminSidebar"'));
  assert.ok(hub.includes('className="adminMobileNavigation"'));
  assert.ok(hub.includes('className="adminContextBar"'));
  assert.ok(hub.includes('role="tablist"'));
  assert.ok(hub.includes('role="tabpanel"'));
  assert.ok(hub.includes('aria-selected={selected}'));
  assert.ok(hub.includes('aria-orientation="vertical"'));
});

test("mobile navigator and shortcuts respect existing permission checks", () => {
  assert.ok(hub.includes('canAccessAdminTab(capabilities, tab.id === "calendar" ? "tasks" : tab.id)'));
  assert.ok(hub.includes('group.items.filter((id) => visibleTabs.some((tab) => tab.id === id))'));
  assert.ok(hub.includes('if (!visibleTabs.some((entry) => entry.id === tab)) return'));
  assert.ok(hub.includes('shortcuts.filter((shortcut) => accessibleTabs.includes(shortcut.id))'));
  assert.ok(hub.includes('accessibleTabs.includes("materials")'));
});

test("mobile admin navigation remains visible and desktop sidebar is hidden", () => {
  assert.ok(layout.includes('import "./admin-experience.css"'));
  assert.match(styles, /@media \(max-width: 780px\)/);
  assert.match(styles, /\.adminMobileNavigation \{ display: grid;/);
  assert.match(styles, /\.adminSidebar \{ display: none;/);
  assert.match(styles, /\.adminExperienceLayout \{ grid-template-columns: minmax\(0,1fr\);/);
  assert.match(styles, /\.adminExperience \.adminUserFields \{ grid-template-columns: minmax\(0,1fr\);/);
});

test("create forms, catalog editing and role controls remain accessible and present", () => {
  assert.ok(hub.includes('className="adminCreateDisclosure"'));
  assert.ok(hub.includes('className="adminRecordDisclosure"'));
  assert.ok(hub.includes('className="adminPermissionsDisclosure"'));
  assert.ok(hub.includes('className="adminUserRoleField"'));
  assert.ok(hub.includes('className="adminRecordSave"'));
  assert.ok(hub.includes('onUpdate(course.id, { active: !course.active })'));
  assert.ok(hub.includes('canManagePermissions || profile.profile_role === "student"'));
  assert.ok(hub.includes('!canManagePermissions || profile.role === "owner"'));
});
