import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const importerSource = readFileSync(
  new URL("../app/api/admin/r2/import-materials/route.ts", import.meta.url),
  "utf8",
);

test("material import calculates public URLs once and never launches one promise per object", () => {
  assert.match(importerSource, /const env = await getCloudflareEnv\(\);/);
  assert.match(importerSource, /\.map\(\(object\) => toImportable\(object, env\.R2_PUBLIC_BASE_URL\)\)/);
  assert.doesNotMatch(importerSource, /Promise\.all\(\(await listNativeR2Objects/);
});

test("material import writes, lookups and reset operations in throttled batches", () => {
  assert.match(importerSource, /const DEFAULT_IMPORT_BATCH_SIZE = 40;/);
  assert.match(importerSource, /const MAX_IMPORT_BATCH_SIZE = 100;/);
  assert.match(importerSource, /const objectBatches = chunk\(objects, batchSize\);/);
  assert.match(importerSource, /for \(const \[batchIndex, objectBatch\] of objectBatches\.entries\(\)\)/);
  assert.match(importerSource, /if \(batchIndex < objectBatches\.length - 1\) await delay\(IMPORT_BATCH_DELAY_MS\);/);
  assert.match(importerSource, /const keyChunks = chunk\(keys, DATABASE_LOOKUP_BATCH_SIZE\);/);
  assert.match(importerSource, /const idChunks = chunk\(ids, batchSize\);/);
});
