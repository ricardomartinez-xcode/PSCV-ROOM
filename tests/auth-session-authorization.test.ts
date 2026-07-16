import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authzSource = readFileSync(new URL("../lib/server/authz.ts", import.meta.url), "utf8");
const sessionRouteSource = readFileSync(
  new URL("../app/api/auth/session/route.ts", import.meta.url),
  "utf8",
);

test("session endpoint verifies the Cloudflare Access identity once per request", () => {
  assert.match(sessionRouteSource, /const identity = await getCurrentIdentity\(request\);/);
  assert.match(sessionRouteSource, /const profile = await requireProfileForIdentity\(identity\);/);
  assert.doesNotMatch(sessionRouteSource, /Promise\.all\(\[getCurrentIdentity\(request\), requireProfile\(request\)\]\)/);
});

test("authorization normalizes imported student emails without allowing a domain-only fallback", () => {
  assert.match(authzSource, /lower\(trim\(email\)\) = \?/);
  assert.match(authzSource, /a matching email domain is never enough/);
  assert.match(authzSource, /Perfil inactivo/);
});

test("profile resolution uses a short-lived per-identity cache and an indexed email fast path", () => {
  assert.match(authzSource, /const PROFILE_CACHE_TTL_MS = 15_000;/);
  assert.match(authzSource, /const profileLoads = new Map<string, Promise<ServerProfile>>\(\);/);
  assert.match(authzSource, /WHERE email = \? COLLATE NOCASE LIMIT 1/);
  assert.match(authzSource, /const pendingLoad = profileLoads\.get\(cacheKey\);/);
  assert.match(authzSource, /return trimmedEmailMatch \?\? subjectMatch;/);
});

test("Ricardo is enforced as the active PSCV Room owner", () => {
  assert.match(authzSource, /const OWNER_EMAIL = "ricardo_mtzh@outlook\.com";/);
  assert.match(authzSource, /role = 'owner'/);
  assert.match(authzSource, /can_manage_r2 = 1/);
});

test("authenticated mutations reject missing or cross-origin browser requests", () => {
  assert.match(authzSource, /new Set\(\["GET", "HEAD", "OPTIONS"\]\)/);
  assert.match(authzSource, /const origin = request\.headers\.get\("origin"\);/);
  assert.match(authzSource, /origin !== expectedOrigin/);
  assert.match(authzSource, /throw new HttpError\(403, "Origen no permitido\."\)/);
});
