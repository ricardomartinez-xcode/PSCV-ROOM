import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("R2 inventory requires complete pagination before modifying the index", () => {
  const sync = source("lib/server/materials-r2-sync.ts");
  assert.match(sync, /while \(cursor\)/);
  assert.match(sync, /page\.truncated && \(!page\.cursor \|\| page\.cursor === cursor\)/);
  assert.match(sync, /objects\.length > MAX_OBJECTS/);
  assert.ok(sync.indexOf("await readCompleteR2Inventory(bucket)") < sync.indexOf("await runStatements(db, updates)"));
});

test("deleted R2 documents are excluded without deleting D1 rows or task links", () => {
  const sync = source("lib/server/materials-r2-sync.ts");
  const migration = source("migrations/0017_materials_r2_missing.sql");
  const library = source("app/api/materials/library/route.ts");
  const tasks = source("app/api/admin/tasks/[id]/materials/route.ts");
  const file = source("app/api/materials/[id]/file/route.ts");
  assert.match(migration, /ADD COLUMN r2_missing_at TEXT/);
  assert.match(sync, /UPDATE materials SET r2_missing_at = \?/);
  assert.match(sync, /UPDATE materials SET r2_missing_at = NULL/);
  assert.doesNotMatch(sync, /DELETE FROM materials|DELETE FROM task_materials|bucket\.delete/);
  assert.match(library, /await reconcileR2Materials\(await getD1\(\), await getMaterialsBucket\(\)\)/);
  assert.match(library, /m\.r2_missing_at IS NULL/);
  assert.match(library, /Cache-Control.*private, no-store/);
  assert.match(tasks, /m\.r2_missing_at IS NULL/);
  assert.match(file, /if \(data\.r2_missing_at\)/);
});

test("new objects are indexed and cron reconciles unattended", () => {
  const sync = source("lib/server/materials-r2-sync.ts");
  const cron = source("custom-worker.ts");
  const importer = source("app/api/admin/r2/import-materials/route.ts");
  const ui = source("components/material-library.tsx");
  assert.match(sync, /ON CONFLICT\(r2_key\) DO NOTHING/);
  assert.match(sync, /materialR2KeyLookupCandidates/);
  assert.match(cron, /reconcileR2Materials\(env\.DB, env\.MATERIALS_BUCKET\)/);
  assert.match(importer, /r2_missing_at = NULL/);
  assert.match(importer, /listedObjects\.length > maxItems/);
  assert.match(ui, /window\.addEventListener\("focus", refresh\)/);
  assert.match(ui, /window\.setInterval\(refresh, 60_000\)/);
});
