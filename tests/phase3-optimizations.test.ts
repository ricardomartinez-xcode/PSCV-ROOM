import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("../components/app-shell-v5.tsx", import.meta.url), "utf8");
const materials = readFileSync(new URL("../components/material-library.tsx", import.meta.url), "utf8");
const domain = readFileSync(new URL("../lib/domain.ts", import.meta.url), "utf8");
const eslint = readFileSync(new URL("../eslint.config.mjs", import.meta.url), "utf8");

test("admin code is loaded only when the administrative surface is requested", () => {
  assert.match(shell, /dynamic\(/);
  assert.match(shell, /import\("@\/components\/admin-hub"\)/);
  assert.match(shell, /ssr:\s*false/);
  assert.match(shell, /Cargando administración/);
});

test("material library uses an exhaustive stable loader effect", () => {
  assert.match(materials, /const loadLibrary = useCallback/);
  assert.match(materials, /\}, \[query\]\);/);
  assert.match(materials, /\}, \[loadLibrary\]\);/);
});

test("presentation roles are distinct from identity roles", () => {
  assert.match(domain, /export type ViewRole = "reader" \| "admin"/);
  assert.doesNotMatch(domain, /export type Role =/);
  assert.match(shell, /ViewRole/);
});

test("duplicate admin clients are retired and generated moodboards stay outside lint", () => {
  assert.equal(existsSync(new URL("../components/academic-manager.tsx", import.meta.url)), false);
  assert.equal(existsSync(new URL("../components/student-directory.tsx", import.meta.url)), false);
  assert.match(eslint, /outputs\/\*\*/);
});
