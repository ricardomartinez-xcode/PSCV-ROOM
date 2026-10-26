import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = (name: string) => readFileSync(new URL("../" + name, import.meta.url), "utf8");

test("task and notification images use authenticated R2 upload without Cloudflare Images credentials", () => {
  const input = source("components/cloudflare-image-upload.tsx");
  const upload = source("app/api/admin/images/r2/route.ts");
  const serve = source("app/api/media/images/[id]/route.ts");
  const store = source("lib/server/task-image-r2.ts");
  assert.match(input, /\/api\/admin\/images\/r2/);
  assert.match(upload, /requirePermission\(request, category === "announcement" \? "notifications:manage" : "tasks:edit"\)/);
  assert.match(store, /getMaterialsBucket/);
  assert.match(store, /10 \* 1024 \* 1024/);
  assert.match(store, /__pscv_media__\/images\//);
  assert.match(serve, /requireProfile\(request\)/);
  assert.match(serve, /Cache-Control": "private, no-store"/);
});

test("app media assets never enter R2 material catalogue", () => {
  assert.match(source("lib/server/materials-r2-sync.ts"), /!key\.startsWith\("__pscv_media__\/"\)/);
  assert.match(source("app/api/admin/r2/import-materials/route.ts"), /!object\.key\.startsWith\("__pscv_media__\/"\)/);
});

test("material edit/delete always enforce authorization and destructive confirmation", () => {
  const api = source("app/api/admin/materials/[id]/route.ts");
  const replacement = source("app/api/admin/materials/[id]/file/route.ts");
  assert.match(api, /requirePermission\(request, "materials:manage"\)/);
  assert.match(api, /requirePermission\(request, "r2:manage"\)/);
  assert.match(api, /ELIMINAR_RECURSO/);
  assert.match(api, /await bucket\.delete\(original\.r2_key\)/);
  assert.match(api, /DELETE FROM materials WHERE id =/);
  assert.match(api, /material\.deleted\.r2_and_d1/);
  assert.match(replacement, /extension\(file\.name\) !== extension\(record\.r2_key\)/);
  assert.match(replacement, /await bucket\.put\(record\.r2_key/);
});

test("manual metadata remains intact when R2 is imported again", () => {
  const importer = source("app/api/admin/r2/import-materials/route.ts");
  assert.match(importer, /UPDATE materials SET size_bytes = \?, r2_missing_at = NULL/);
  assert.doesNotMatch(importer, /UPDATE materials SET section_id = \?, title = \?/);
});

test("admin console provides edit, replace, visibility and deletion controls", () => {
  const ui = source("components/admin-hub.tsx");
  assert.match(ui, /\/api\/admin\/materials/);
  assert.match(ui, /setEditVisibility/);
  assert.match(ui, /ELIMINAR_RECURSO/);
  assert.match(ui, /r2-and-d1/);
  assert.match(ui, /startEditing\(material\)/);
});
