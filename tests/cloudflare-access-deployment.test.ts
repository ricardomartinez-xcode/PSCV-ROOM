import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("uses the canonical Worker host and renders a recoverable Access state", async () => {
  const [wrangler, authGate, authSessionProvider, accessRunbook] = await Promise.all([
    readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
    readFile(new URL("../components/auth-gate.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/auth-session-provider.tsx", import.meta.url), "utf8"),
    readFile(new URL("../docs/CLOUDFLARE_ACCESS_DEPLOYMENT.md", import.meta.url), "utf8"),
  ]);

  assert.match(wrangler, /"pattern": "app\.rlead\.xyz"/);
  assert.doesNotMatch(wrangler, /app\.relead\.xyz/);
  assert.match(authGate, /useAuthSession/);
  assert.match(authSessionProvider, /AbortController/);
  assert.match(authSessionProvider, /SESSION_TIMEOUT_MS/);
  assert.match(authGate, /Verificando acceso institucional/);
  assert.match(authGate, /Volver a iniciar acceso/);
  assert.match(accessRunbook, /ACCESS_TEAM_DOMAIN/);
  assert.match(accessRunbook, /ACCESS_AUD/);
});
