import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("persists and validates the complete VAPID key pair before deployment", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/cloudflare.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /secret put VAPID_PRIVATE_KEY/);
  assert.match(workflow, /secret put VAPID_PUBLIC_KEY/);
  assert.match(workflow, /index\("VAPID_PRIVATE_KEY"\)/);
  assert.match(workflow, /index\("VAPID_PUBLIC_KEY"\)/);
  assert.match(workflow, /npm run cf:deploy -- --keep-vars/);
  assert.doesNotMatch(workflow, /--var\s+"VAPID_PUBLIC_KEY:/);
});
