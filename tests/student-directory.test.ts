import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("exposes a guarded student directory with CRUD and CSV import", async () => {
  const [studentsApi, importApi, page, helper] = await Promise.all([
    readFile(new URL("../app/api/admin/students/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/students/import/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/users/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/students.ts", import.meta.url), "utf8"),
  ]);

  assert.match(studentsApi, /export async function POST/);
  assert.match(studentsApi, /export async function PATCH/);
  assert.match(studentsApi, /export async function DELETE/);
  assert.match(studentsApi, /requirePermission\(request, "users:manage"\)/);
  assert.match(importApi, /TextDecoder\("windows-1252"\)/);
  assert.match(importApi, /const action = form\.get\("action"\) === "apply" \? "apply" : "preview";/);
  assert.match(importApi, /action: "apply"/);
  assert.match(page, /redirect\("\/\?tab=admin&adminTab=users"\)/);
  assert.match(helper, /role !== "student"/);
  assert.match(helper, /DELETE FROM app_profiles WHERE id = \? AND role = 'student'/);
});
