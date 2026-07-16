import assert from "node:assert/strict";

const baseUrl = new URL(process.env.SMOKE_BASE_URL ?? "http://localhost:3000");

function url(path) {
  return new URL(path, baseUrl).toString();
}

async function request(path, options = {}) {
  const response = await fetch(url(path), {
    redirect: "manual",
    ...options,
    headers: {
      "user-agent": "pscv-smoke-tests/1.0",
      ...(options.headers ?? {}),
    },
  });
  return response;
}

async function json(path) {
  const response = await request(path);
  assert.equal(response.ok, true, `${path} should return 2xx, got ${response.status}`);
  return response.json();
}

async function checkHome() {
  const response = await request("/");
  assert.equal(response.ok, true, `/ should return 2xx, got ${response.status}`);
  const html = await response.text();
  assert.match(html, /PSCV Room 2\.0|PSCV Room/, "home page should render the PSCV app shell");
}

async function checkHealth() {
  const health = await json("/api/health");
  assert.equal(health.ok, true, "health.ok should be true");
  assert.equal(health.app, "PSCV Room 2.0", "health app name should match");
  assert.equal(typeof health.integrations, "object", "health should include integrations");
  assert.equal(typeof health.integrations.r2, "boolean", "health should report R2 config");
  assert.equal(typeof health.integrations.d1, "boolean", "health should report D1 config");
}

async function checkProtectedOperationsRoutes() {
  for (const route of [
    { path: "/api/tasks", method: "GET" },
    { path: "/api/materials/library?limit=25", method: "GET" },
    { path: "/api/uploads/destinations", method: "GET" },
    { path: "/api/notifications", method: "GET" },
    { path: "/api/reports/operations", method: "GET" },
    { path: "/api/admin/notifications", method: "GET" },
    { path: "/api/admin/r2/status", method: "GET" },
    { path: "/api/uploads/presign", method: "POST", body: { fileName: "smoke.txt", contentType: "text/plain" } },
    { path: "/api/uploads/direct", method: "POST", body: { fileName: "smoke.txt", contentType: "text/plain" } },
  ]) {
    const response = await fetch(new URL(route.path, baseUrl), {
      method: route.method,
      headers: route.body ? { "content-type": "application/json" } : undefined,
      body: route.body ? JSON.stringify(route.body) : undefined,
    });
    const path = `${route.method} ${route.path}`;
    assert.ok([401, 403].includes(response.status), `${path} should require an authenticated session, got ${response.status}`);
  }
}

const checks = [
  ["home", checkHome],
  ["health", checkHealth],
  ["protected operations routes", checkProtectedOperationsRoutes],
];

console.log(`Running PSCV smoke tests against ${baseUrl.toString()}`);

for (const [name, check] of checks) {
  await check();
  console.log(`ok - ${name}`);
}

console.log("Smoke tests passed.");
