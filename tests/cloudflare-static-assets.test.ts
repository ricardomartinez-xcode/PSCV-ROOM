import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const wranglerConfig = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const homePage = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const deployWorkflow = readFileSync(
  new URL("../.github/workflows/cloudflare.yml", import.meta.url),
  "utf8",
);

test("Cloudflare deployment uploads the OpenNext static asset directory", () => {
  assert.match(wranglerConfig, /"assets"\s*:\s*\{[\s\S]*"directory"\s*:\s*"\.open-next\/assets"/);
  assert.match(wranglerConfig, /"binding"\s*:\s*"ASSETS"/);
  assert.match(deployWorkflow, /npm run cf:deploy -- --keep-vars/);
});

test("home page is dynamic so it cannot cache stale HTML chunk references", () => {
  assert.match(homePage, /export const dynamic = "force-dynamic";/);
  assert.match(homePage, /export const revalidate = 0;/);
});
