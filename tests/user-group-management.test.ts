import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const adminHub = readFileSync(new URL("../components/admin-hub.tsx", import.meta.url), "utf8");
const appShell = readFileSync(new URL("../components/app-shell-v5.tsx", import.meta.url), "utf8");
const usersRoute = readFileSync(new URL("../app/api/admin/users/route.ts", import.meta.url), "utf8");
const d1Data = readFileSync(new URL("../lib/server/d1-data.ts", import.meta.url), "utf8");

test("admin users UI persists profile data, roles and permission flags through the guarded users endpoint", () => {
  assert.match(adminHub, /fetch\("\/api\/admin\/users"/);
  assert.match(adminHub, /body: JSON\.stringify\(\{ id, \.\.\.patch \}\)/);
  assert.match(adminHub, /method: "DELETE"/);
  assert.match(adminHub, /onDelete=\{\(id\) => deleteProfile\(id\)\}/);
  assert.match(adminHub, /can_manage_users/);
  assert.match(adminHub, /can_manage_group/);
  assert.match(usersRoute, /requirePermission\(request, "users:manage"\)/);
  assert.match(usersRoute, /export async function PATCH/);
  assert.match(usersRoute, /export async function DELETE/);
  assert.match(usersRoute, /Sólo el propietario puede cambiar roles o permisos/);
  assert.match(usersRoute, /El propietario canónico no se puede eliminar/);
});

test("generic D1 profile mutations cannot be used by an admin to escalate privileges", () => {
  assert.match(d1Data, /if \(profile\.role === "owner"\) return/);
  assert.match(d1Data, /Las mutaciones administrativas de perfiles deben usar la API protegida de usuarios/);
});

test("group list persists member CRUD, custom columns and per-member boolean values", () => {
  assert.match(appShell, /method: editing \? "PATCH" : "POST"/);
  assert.match(appShell, /removeMember\(member/);
  assert.match(appShell, /from\("group_columns"\)[\s\S]*\.insert\(/);
  assert.match(appShell, /from\("group_columns"\)[\s\S]*\.update\(\{ label/);
  assert.match(appShell, /from\("group_columns"\)[\s\S]*\.update\(\{ active: false/);
  assert.match(appShell, /from\("group_column_values"\)[\s\S]*\.upsert\(/);
});
