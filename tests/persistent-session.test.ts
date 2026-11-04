import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  createPersistentSession,
  readPersistentIdentity,
  revokePersistentSession,
  renewedSessionCookie,
} from "../lib/server/persistent-session.ts";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON; CREATE TABLE app_profiles (id TEXT PRIMARY KEY, email TEXT, active INTEGER); INSERT INTO app_profiles VALUES ('student-1', 'student@example.com', 1)");
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
  } as unknown as D1Database;
  return { sqlite, db };
}

function request(cookie: string) {
  return new Request("https://app.relnets.com/api/auth/session", { headers: { cookie: cookie.split(";")[0] } });
}

test("persistent identity survives the former 12-hour Access expiry and server restarts", async () => {
  const { sqlite, db } = database();
  try {
    const cookie = await createPersistentSession(db, "student-1", "access-subject");
    const now = Date.now;
    Date.now = () => now() + 365 * 24 * 60 * 60 * 1000;
    try {
      assert.deepEqual(await readPersistentIdentity(db, request(cookie)), { email: "student@example.com", subject: "access-subject" });
      // Reading again has no dependency on in-memory state or an Access token.
      assert.deepEqual(await readPersistentIdentity(db, request(cookie)), { email: "student@example.com", subject: "access-subject" });
    } finally { Date.now = now; }
  } finally { sqlite.close(); }
});

test("explicit logout revokes replay of the cookie without logging out another device", async () => {
  const { sqlite, db } = database();
  try {
    const first = await createPersistentSession(db, "student-1", "access-subject");
    const second = await createPersistentSession(db, "student-1", "access-subject");
    const cleared = await revokePersistentSession(db, request(first));
    assert.match(cleared, /Max-Age=0/);
    assert.equal(await readPersistentIdentity(db, request(first)), null);
    assert.ok(await readPersistentIdentity(db, request(second)));
    await revokePersistentSession(db, request(first));
    assert.equal(await readPersistentIdentity(db, request(first)), null);
  } finally { sqlite.close(); }
});

test("the database stores only a digest and the browser cookie is protected and renewable", async () => {
  const { sqlite, db } = database();
  try {
    const cookie = await createPersistentSession(db, "student-1", "access-subject");
    assert.match(cookie, /^__Host-pscv_session=[a-f0-9]{64};/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\//);
    assert.doesNotMatch(cookie, /Domain=/);
    const stored = sqlite.prepare("SELECT token_hash FROM app_sessions").get();
    assert.notEqual(stored?.token_hash, cookie.split(";")[0].split("=")[1]);
    assert.match(renewedSessionCookie(request(cookie)) ?? "", /Max-Age=34560000/);
    assert.equal(renewedSessionCookie(request("__Host-pscv_session=bad")), null);
  } finally { sqlite.close(); }
});

test("missing, forged, ambiguous, deleted and inactive identities fail closed", async () => {
  const { sqlite, db } = database();
  try {
    assert.equal(await readPersistentIdentity(db, request("")), null);
    assert.equal(await readPersistentIdentity(db, request(`__Host-pscv_session=${"a".repeat(64)}`)), null);
    const cookie = await createPersistentSession(db, "student-1", "access-subject");
    const duplicate = new Request("https://app.relnets.com/api/tasks", { headers: { cookie: `${cookie.split(";")[0]}; ${cookie.split(";")[0]}` } });
    assert.equal(await readPersistentIdentity(db, duplicate), null);
    sqlite.exec("UPDATE app_profiles SET active=0 WHERE id='student-1'");
    assert.equal(await readPersistentIdentity(db, request(cookie)), null);
    sqlite.exec("DELETE FROM app_profiles WHERE id='student-1'");
    assert.equal(await readPersistentIdentity(db, request(cookie)), null);
  } finally { sqlite.close(); }
});
