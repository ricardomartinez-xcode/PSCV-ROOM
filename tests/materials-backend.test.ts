import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MATERIAL_LIBRARY_SEARCH_COLUMNS,
  buildMaterialLibrarySearch,
} from "../lib/server/material-search.ts";
import {
  encodeMaterialR2KeyForUrl,
  materialR2KeyLookupCandidates,
  normalizeMaterialImportRoot,
} from "../lib/server/r2-paths.ts";
import {
  diffTaskMaterialIds,
  taskRejectsBucketMaterials,
} from "../lib/server/task-material-links.ts";

test("material library search covers bucket keys and section labels", () => {
  const filter = buildMaterialLibrarySearch("  Compendio%_\\  ");

  assert.ok(filter);
  assert.equal(filter.query, "Compendio%_\\");
  assert.equal(filter.values.length, MATERIAL_LIBRARY_SEARCH_COLUMNS.length);
  assert.equal(filter.values[0], "%Compendio\\%\\_\\\\%");
  assert.ok(filter.values.every((value) => value === filter.values[0]));
  assert.match(filter.sql, /m\.r2_key LIKE \?/);
  assert.match(filter.sql, /ms\.name LIKE \?/);
  assert.match(filter.sql, /ms\.path LIKE \?/);
});

test("R2 import treats the bucket name as root and preserves exact prefix spaces", () => {
  assert.equal(normalizeMaterialImportRoot(undefined), "");
  assert.equal(normalizeMaterialImportRoot("psicologia"), "");
  assert.equal(normalizeMaterialImportRoot("Psicología/"), "");
  assert.equal(
    normalizeMaterialImportRoot("Compendio de Psicología/Articulos de Investigación /"),
    "Compendio de Psicología/Articulos de Investigación ",
  );
});

test("R2 lookup and URL encoding keep the opaque raw key first", () => {
  const rawKey = "Compendio de Psicología/Articulos de Investigación /Manual Clínico.pdf";
  const candidates = materialR2KeyLookupCandidates(rawKey);

  assert.equal(candidates[0], rawKey);
  assert.equal(
    encodeMaterialR2KeyForUrl(rawKey),
    "Compendio%20de%20Psicolog%C3%ADa/Articulos%20de%20Investigaci%C3%B3n%20/Manual%20Cl%C3%ADnico.pdf",
  );
  assert.ok(candidates.some((candidate) => candidate.includes("Investigación/Manual")));
  const nativeR2Source = readFileSync(new URL("../lib/server/r2-native.ts", import.meta.url), "utf8");
  assert.match(nativeR2Source, /const comparableMatches = new Set<string>\(\)/);
  assert.match(nativeR2Source, /comparableMatches\.size === 1/);
  assert.match(nativeR2Source, /comparableMatches\.size > 1/);
});

test("file route authorizes and proxies safe previews and downloads", () => {
  const source = readFileSync(
    new URL("../app/api/materials/[id]/file/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /await requireProfile\(request\)/);
  assert.match(source, /INLINE_PREVIEW_TYPES/);
  assert.match(source, /!canPreviewInline\(contentType\)/);
  assert.match(source, /headers\.set\("etag", object\.httpEtag\)/);
  assert.match(source, /mode === "download" \? "attachment" : "inline"/);
  assert.match(source, /x-content-type-options/);
  assert.match(source, /El archivo no está disponible temporalmente/);
  assert.doesNotMatch(source, /readError instanceof Error \? readError\.message : "No se pudo leer el documento R2\."/);
  assert.doesNotMatch(source, /NextResponse\.redirect/);
});

test("task-material endpoint exposes an idempotent replace contract and protects events", () => {
  const source = readFileSync(
    new URL("../app/api/admin/tasks/[id]/materials/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /const materialSetSchema = z\.object\(\{[\s\S]*materialIds: z\.array\(materialIdSchema\)\.max\(50\)/);
  assert.match(source, /export async function PUT/);
  assert.match(source, /DELETE FROM task_materials WHERE task_id = \?/);
  assert.match(source, /Los eventos no admiten materiales del bucket/);
  assert.match(source, /export async function DELETE/);
  assert.match(source, /materials: await linkedMaterials\(id\)/);
  assert.match(source, /AND m\.visibility = 'visible'/);
  assert.match(source, /r2_key: "protected"/);
});

test("task material set diff is deterministic, deduplicated and supports clearing", () => {
  assert.deepEqual(diffTaskMaterialIds(["a", "b"], ["b", "c", "c"]), {
    materialIds: ["b", "c"],
    toAdd: ["c"],
    toRemove: ["a"],
    changed: true,
  });
  assert.deepEqual(diffTaskMaterialIds(["a"], ["a"]), {
    materialIds: ["a"],
    toAdd: [],
    toRemove: [],
    changed: false,
  });
  assert.deepEqual(diffTaskMaterialIds(["a"], []), {
    materialIds: [],
    toAdd: [],
    toRemove: ["a"],
    changed: true,
  });
  assert.equal(taskRejectsBucketMaterials("event", "Tarea"), true);
  assert.equal(taskRejectsBucketMaterials("task", "Evento"), true);
  assert.equal(taskRejectsBucketMaterials("task", "Proyecto"), false);
});

test("R2 diagnostics and importer use the real bucket root", () => {
  const importer = readFileSync(
    new URL("../app/api/admin/r2/import-materials/route.ts", import.meta.url),
    "utf8",
  );
  const status = readFileSync(
    new URL("../app/api/admin/r2/status/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(importer, /normalizeMaterialImportRoot\(body\.root \?\? MATERIALS_R2_ROOT\)/);
  assert.match(status, /const samplePrefix = MATERIALS_R2_ROOT \? `\$\{MATERIALS_R2_ROOT\}\/` : ""/);
  assert.match(status, /listNativeR2Objects\(samplePrefix, 5\)/);
});
