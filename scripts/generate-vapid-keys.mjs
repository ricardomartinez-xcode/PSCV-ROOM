import { generateKeyPairSync } from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";

const [privateOutput, publicOutput] = process.argv.slice(2);

if (!privateOutput || !publicOutput) {
  throw new Error("Usage: node scripts/generate-vapid-keys.mjs <private-output> <public-output>");
}

const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
});

const privateJwk = privateKey.export({ format: "jwk" });
const publicJwk = publicKey.export({ format: "jwk" });

if (!privateJwk.d || !publicJwk.x || !publicJwk.y) {
  throw new Error("Node did not export a complete P-256 key pair.");
}

const publicBytes = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.from(publicJwk.x, "base64url"),
  Buffer.from(publicJwk.y, "base64url"),
]);

if (Buffer.from(privateJwk.d, "base64url").length !== 32 || publicBytes.length !== 65) {
  throw new Error("Generated VAPID keys have an invalid length.");
}

await writeFile(privateOutput, privateJwk.d, { encoding: "utf8", mode: 0o600 });
await writeFile(publicOutput, publicBytes.toString("base64url"), { encoding: "utf8", mode: 0o600 });
await Promise.all([chmod(privateOutput, 0o600), chmod(publicOutput, 0o600)]);
