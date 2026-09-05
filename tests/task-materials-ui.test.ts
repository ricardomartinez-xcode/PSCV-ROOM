import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("../components/app-shell-v5.tsx", import.meta.url), "utf8");
const materials = readFileSync(new URL("../components/task-materials.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const route = readFileSync(
  new URL("../app/api/admin/tasks/[id]/materials/route.ts", import.meta.url),
  "utf8",
);

test("task forms replace a complete multi-material selection", () => {
  assert.match(shell, /materialIds: string\[\]/);
  assert.match(shell, /method: "PUT"/);
  assert.match(shell, /JSON\.stringify\(\{ materialIds \}\)/);
  assert.match(materials, /type="checkbox"/);
  assert.match(materials, /selectedIds\.includes\(material\.id\)/);
  assert.match(materials, /MAX_TASK_MATERIALS/);
});

test("events do not expose bucket-material controls and may clean legacy links", () => {
  assert.match(shell, /form\.itemKind === "task"/);
  assert.match(shell, /task\.itemKind === "task" && task\.linkedMaterials/);
  assert.match(route, /allowEmptyCleanup/);
  assert.match(route, /materialIds\.length === 0/);
});

test("each linked material has its own preview and download actions", () => {
  assert.match(materials, /function materialPreviewUrl/);
  assert.match(materials, /function materialDownloadUrl/);
  assert.match(materials, /mode=preview/);
  assert.match(materials, /mode=download/);
  assert.match(materials, /role="dialog"/);
  assert.match(materials, /aria-modal="true"/);
  assert.match(materials, /Vista previa segura no disponible/);
  assert.match(materials, /canRenderAsPdf/);
});

test("the legacy DOM interception layer is no longer mounted", () => {
  assert.doesNotMatch(layout, /TaskMaterialExperience/);
  assert.match(layout, /pscv\.css/);
  assert.doesNotMatch(shell, /MutationObserver/);
});
