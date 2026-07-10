import { importJWK, SignJWT, type JWK } from "jose";

export type PushSubscriptionRecord = {
  id: string;
  endpoint: string;
};

type VapidConfiguration = {
  publicKey: string;
  privateKey: string;
  subject: string;
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

export function getVapidConfiguration(env: CloudflareEnv): VapidConfiguration {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) {
    throw new Error("VAPID no está configurado.");
  }
  if (!subject.startsWith("mailto:") && !subject.startsWith("https://")) {
    throw new Error("VAPID_SUBJECT debe usar mailto: o https://.");
  }
  const publicBytes = decodeBase64Url(publicKey);
  const privateBytes = decodeBase64Url(privateKey);
  if (publicBytes.length !== 65 || publicBytes[0] !== 4 || privateBytes.length !== 32) {
    throw new Error("Las claves VAPID no tienen un formato válido.");
  }
  return { publicKey, privateKey, subject };
}

export function isVapidConfigured(env: CloudflareEnv) {
  try {
    getVapidConfiguration(env);
    return true;
  } catch {
    return false;
  }
}

async function createVapidToken(endpoint: string, env: CloudflareEnv) {
  const config = getVapidConfiguration(env);
  const publicBytes = decodeBase64Url(config.publicKey);
  const privateBytes = decodeBase64Url(config.privateKey);
  const jwk: JWK = {
    kty: "EC",
    crv: "P-256",
    x: encodeBase64Url(publicBytes.slice(1, 33)),
    y: encodeBase64Url(publicBytes.slice(33, 65)),
    d: encodeBase64Url(privateBytes),
  };
  const key = await importJWK(jwk, "ES256");
  const audience = new URL(endpoint).origin;
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256" })
    .setAudience(audience)
    .setSubject(config.subject)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(key);
  return { token, publicKey: config.publicKey };
}

export async function sendPushWake(subscription: PushSubscriptionRecord, env: CloudflareEnv) {
  const { token, publicKey } = await createVapidToken(subscription.endpoint, env);
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      TTL: "60",
      Urgency: "high",
      Authorization: `vapid t=${token}, k=${publicKey}`,
    },
    signal: AbortSignal.timeout(15_000),
  });
  return { ok: response.ok, status: response.status };
}
