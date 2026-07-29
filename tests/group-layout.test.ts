import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import test from "node:test";

const appShell = readFileSync(new URL("../components/app-shell-v5.tsx", import.meta.url), "utf8");

test("keeps the group toolbar in normal flow above the table headers", async () => {
  const css = await readFile(new URL("../app/operational-polish.css", import.meta.url), "utf8");
  const toolbarRule = css.match(/\.groupToolbar\s*\{([^}]*)\}/)?.[1] ?? "";

  assert.doesNotMatch(toolbarRule, /position:\s*sticky/);
  assert.match(css, /\.memberTable th\s*\{[^}]*z-index:\s*2/s);
});

test("group list supports adding, editing and deleting students", () => {
  assert.match(appShell, /className="groupMemberForm"/);
  assert.match(appShell, /method: editing \? "PATCH" : "POST"/);
  assert.match(appShell, /method: "DELETE"/);
  assert.match(appShell, /editMember\(member\)/);
  assert.match(appShell, /removeMember\(member\)/);
});
