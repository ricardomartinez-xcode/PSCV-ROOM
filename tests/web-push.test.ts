import assert from "node:assert/strict";
import test from "node:test";
import { getVapidConfiguration, isVapidConfigured } from "../lib/server/web-push.ts";

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
