import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import test from "node:test";
import ts from "typescript";

// Only the Cloudflare environment boundary is substituted. Routes, JWT signature
// verification, authorization and the session SQL all execute their real code.
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(readFileSync(new URL("../migrations/0001_pscv_room.sql", import.meta.url), "utf8"));
sqlite.exec("ALTER TABLE app_profiles ADD COLUMN profile_role TEXT NOT NULL DEFAULT 'student'; INSERT INTO app_profiles (id,email,full_name,auth_user_id) VALUES ('route-student','route-student@example.com','Route Student','verified-sub')");
sqlite.exec(readFileSync(new URL("../migrations/0020_persistent_sessions.sql", import.meta.url), "utf8"));
const db = {
  prepare(sql: string) {
    let values: unknown[] = [];
    return {
      bind(...args: unknown[]) { values = args; return this; },
      async first() { const row = sqlite.prepare(sql).get(...values as string[]); return row ? { ...row } : null; },
      async run() { sqlite.prepare(sql).run(...values as string[]); return { success: true, results: [] }; },
    };
  },
};
const env = { AUTH_MODE: "cloudflare-access", ACCESS_TEAM_DOMAIN: "identity.example.test", ACCESS_AUD: "pscv-test-audience" };
(globalThis as unknown as Record<symbol, unknown>)[Symbol.for("pscv.session-test-env")] = { db, env };
const fixture = `data:text/javascript,${encodeURIComponent('const state = globalThis[Symbol.for("pscv.session-test-env")]; export const getD1 = async () => state.db; export const getCloudflareEnv = async () => state.env;')}`;
const root = fileURLToPath(new URL("../", import.meta.url));
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@/lib/server/cloudflare") return { url: fixture, shortCircuit: true };
    if (specifier.startsWith("@/")) return { url: pathToFileURL(`${root}${specifier.slice(2)}.ts`).href, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith("file:") && url.endsWith(".ts") && fileURLToPath(url).startsWith(root)) {
      return { format: "module", source: ts.transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText, shortCircuit: true };
    }
    return next(url, context);
  },
});

test("real login, protected API identity, renewal, CSRF and logout stay consistent", async () => {
  const originalFetch = globalThis.fetch;
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "test-key", alg: "RS256", use: "sig" };
  globalThis.fetch = async (input) => {
    assert.equal(String(input), "https://identity.example.test/cdn-cgi/access/certs");
    return Response.json({ keys: [jwk] });
  };
  try {
    const login = await import("../app/api/auth/login/route.ts");
    const session = await import("../app/api/auth/session/route.ts");
    const logout = await import("../app/api/auth/logout/route.ts");
    const { getCurrentIdentity, requirePermission } = await import("../lib/server/authz.ts");
    async function token(audience = "pscv-test-audience", expiration = "1h", email = "route-student@example.com") {
      return new SignJWT({ email }).setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer("https://identity.example.test").setAudience(audience).setSubject("verified-sub").setIssuedAt().setExpirationTime(expiration).sign(privateKey);
    }
    const loginUrl = "https://app.relnets.com/api/auth/login";
    assert.equal((await login.GET(new Request(loginUrl))).status, 401);
    for (const jwt of [await token("wrong-audience"), await token("pscv-test-audience", "-1h"), "forged.token.value"]) {
      assert.equal((await login.GET(new Request(loginUrl, { headers: { "cf-access-jwt-assertion": jwt } }))).status, 401);
    }
    const jwt = await token();
    const accepted = await login.GET(new Request(loginUrl, { headers: { "cf-access-jwt-assertion": jwt } }));
    assert.equal(accepted.status, 303);
    assert.equal(accepted.headers.get("location"), "https://app.relnets.com/");
    const cookie = accepted.headers.get("set-cookie")!.split(";")[0];
    const req = new Request("https://app.relnets.com/api/auth/session", { headers: { cookie } });
    const verified = await session.GET(req);
    assert.equal(verified.status, 200);
    assert.equal((await verified.json()).identity.email, "route-student@example.com");
    assert.match(verified.headers.get("set-cookie") ?? "", /Max-Age=34560000/);
    assert.match(verified.headers.get("cache-control") ?? "", /no-store/);
    assert.deepEqual(await getCurrentIdentity(req), { email: "route-student@example.com", subject: "verified-sub" });
    await assert.rejects(() => requirePermission(new Request("https://app.relnets.com/api/admin/tasks", { headers: { cookie } }), "tasks:edit"), { status: 403 });
    for (const origin of [null, "https://evil.example"]) {
      const headers: Record<string, string> = { cookie };
      if (origin) headers.origin = origin;
      assert.equal((await logout.POST(new Request("https://app.relnets.com/api/auth/logout", { method: "POST", headers }))).status, 403);
      assert.equal((await session.GET(req)).status, 200);
    }
    const closed = await logout.POST(new Request("https://app.relnets.com/api/auth/logout", { method: "POST", headers: { cookie, origin: "https://app.relnets.com" } }));
    assert.equal(closed.status, 200);
    assert.match(closed.headers.get("set-cookie") ?? "", /Max-Age=0/);
    assert.equal((await session.GET(req)).status, 401);
    // Even an unexpired Access assertion cannot silently resurrect a logged-out app session.
    await assert.rejects(() => getCurrentIdentity(new Request(req.url, { headers: { cookie, "cf-access-jwt-assertion": jwt } })), { status: 401 });
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
    hooks.deregister();
  }
});
