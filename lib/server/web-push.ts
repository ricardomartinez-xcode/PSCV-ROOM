import { importJWK, SignJWT, type JWK } from "jose";

export type PushSubscriptionRecord = {
  id: string;
  endpoint: string;
};

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(normalized + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64Url(value: Uint8Array) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function createVapidToken(endpoint: string, env: CloudflareEnv) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
    throw new Error("VAPID no está configurado.");
  }
  const publicBytes = decodeBase64Url(env.VAPID_PUBLIC_KEY);
  const privateBytes = decodeBase64Url(env.VAPID_PRIVATE_KEY);
  if (publicBytes.length !== 65 || publicBytes[0] !== 4 || privateBytes.length !== 32) {
    throw new Error("Las claves VAPID no tienen un formato válido.");
  }
  const jwk: JWK = {
    kty: "EC",
    crv: "P-256",
    x: encodeBase64Url(publicBytes.slice(1, 33)),
    y: encodeBase64Url(publicBytes.slice(33, 65)),
    d: encodeBase64Url(privateBytes),
  };
  const key = await importJWK(jwk, "ES256");
  const audience = new URL(endpoint).origin;
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setAudience(audience)
    .setSubject(env.VAPID_SUBJECT)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(key);
}

export async function sendPushWake(subscription: PushSubscriptionRecord, env: CloudflareEnv) {
  const token = await createVapidToken(subscription.endpoint, env);
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      TTL: "60",
      Urgency: "high",
      Authorization: `vapid t=${token}, k=${env.VAPID_PUBLIC_KEY}`,
    },
  });
  return { ok: response.ok, status: response.status };
}
