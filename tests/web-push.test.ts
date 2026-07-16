import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { exportJWK, generateKeyPair } from "jose";
import { isSafePushEndpoint } from "../lib/server/push-endpoint-policy.ts";
import {
  getVapidConfiguration,
  isVapidConfigured,
  sendPushWake,
} from "../lib/server/web-push.ts";

const subscriptionRoute = readFileSync(new URL("../app/api/push/subscribe/route.ts", import.meta.url), "utf8");
const wranglerConfig = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");

function base64Url(bytes: number[]) {
  return Buffer.from(bytes).toString("base64url");
}

function validEnv(overrides: Partial<CloudflareEnv> = {}) {
  return {
    VAPID_PUBLIC_KEY: base64Url([4, ...Array.from({ length: 64 }, (_, index) => (index + 1) % 256)]),
    VAPID_PRIVATE_KEY: base64Url(Array.from({ length: 32 }, (_, index) => (index + 7) % 256)),
    VAPID_SUBJECT: "mailto:test@example.com",
    ...overrides,
  } as CloudflareEnv;
}

async function signingEnv() {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const [publicJwk, privateJwk] = await Promise.all([
    exportJWK(publicKey),
    exportJWK(privateKey),
  ]);
  const publicBytes = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(publicJwk.x!, "base64url"),
    Buffer.from(publicJwk.y!, "base64url"),
  ]);
  return validEnv({
    VAPID_PUBLIC_KEY: publicBytes.toString("base64url"),
    VAPID_PRIVATE_KEY: privateJwk.d,
  });
}

test("accepts a structurally valid VAPID configuration", () => {
  const config = getVapidConfiguration(validEnv());
  assert.equal(config.subject, "mailto:test@example.com");
  assert.equal(isVapidConfigured(validEnv()), true);
});

test("rejects missing or malformed VAPID values", () => {
  assert.equal(isVapidConfigured(validEnv({ VAPID_PRIVATE_KEY: undefined })), false);
  assert.equal(isVapidConfigured(validEnv({ VAPID_PUBLIC_KEY: "invalid" })), false);
  assert.throws(() => getVapidConfiguration(validEnv({ VAPID_SUBJECT: "test@example.com" })), /mailto: o https:/);
});

test("push endpoints reject local, private and parser-ambiguous destinations", () => {
  const blocked = [
    "http://push.example.com/message",
    "https://push.example.com:444/message",
    "https://user:secret@push.example.com/message",
    "https://localhost/message",
    "https://service.internal/message",
    "https://intranet/message",
    "https://127.1/message",
    "https://0x7f000001/message",
    "https://10.0.0.1/message",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/message",
    "https://[fc00::1]/message",
    "https://[fe80::1]/message",
    "https://[::ffff:127.0.0.1]/message",
    "https://[2001:db8::1]/message",
  ];

  for (const endpoint of blocked) {
    assert.equal(isSafePushEndpoint(endpoint), false, endpoint);
  }
});

test("push endpoints preserve public HTTPS providers and global IPv6", () => {
  const allowed = [
    "https://fcm.googleapis.com/fcm/send/example-token",
    "https://updates.push.services.mozilla.com/wpush/v2/example-token",
    "https://web.push.apple.com/QP1/example-token?topic=example",
    "https://[2606:4700:4700::1111]/push/example-token",
  ];

  for (const endpoint of allowed) {
    assert.equal(isSafePushEndpoint(endpoint), true, endpoint);
  }
});

test("push delivery never follows redirects and keeps normal success semantics", async () => {
  const env = await signingEnv();
  const originalFetch = globalThis.fetch;
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  let status = 302;
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ input: String(input), init });
    return new Response(null, {
      status,
      headers: status === 302 ? { Location: "https://[::1]/" } : undefined,
    });
  }) as typeof fetch;

  try {
    const subscription = { id: "subscription-1", endpoint: "https://push.example.com/message/token" };
    const redirected = await sendPushWake(subscription, env);
    assert.deepEqual(redirected, { ok: false, status: 302 });
    assert.equal(calls[0]?.init?.redirect, "manual");

    status = 201;
    const delivered = await sendPushWake(subscription, env);
    assert.deepEqual(delivered, { ok: true, status: 201 });
    assert.equal(calls[1]?.init?.redirect, "manual");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("push delivery revalidates stored endpoints before reaching fetch", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response(null, { status: 201 });
  }) as typeof fetch;

  try {
    await assert.rejects(
      sendPushWake({ id: "unsafe", endpoint: "https://[::1]/push" }, validEnv()),
      /Endpoint push inválido/,
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("push subscriptions cannot be reassigned across profiles and outbound fetches use the public route", () => {
  assert.match(subscriptionRoute, /WHERE push_subscriptions\.profile_id = excluded\.profile_id/);
  assert.doesNotMatch(subscriptionRoute, /profile_id = excluded\.profile_id,/);
  assert.match(subscriptionRoute, /throw new HttpError\(409/);
  assert.match(wranglerConfig, /"global_fetch_strictly_public"/);
});
