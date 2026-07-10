import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("generates a valid P-256 VAPID key pair without printing it", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pscv-vapid-"));
  const privatePath = path.join(directory, "private.key");
  const publicPath = path.join(directory, "public.key");

  try {
    const result = await execFileAsync(process.execPath, [
      "scripts/generate-vapid-keys.mjs",
      privatePath,
      publicPath,
    ]);

    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");

    const [privateKey, publicKey] = await Promise.all([
      readFile(privatePath, "utf8"),
      readFile(publicPath, "utf8"),
    ]);

    assert.equal(Buffer.from(privateKey, "base64url").length, 32);
    const publicBytes = Buffer.from(publicKey, "base64url");
    assert.equal(publicBytes.length, 65);
    assert.equal(publicBytes[0], 0x04);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
