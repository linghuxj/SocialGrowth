import assert from "node:assert/strict";
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("explicit custodian setup protects independent persistent keys and never overwrites", async () => {
  const taskDirectory = await realpath(await mkdtemp(join(tmpdir(), "sg-media-key-cli-check-")));
  try {
    const path = join(taskDirectory, "keys.json");
    const run = target => spawnSync(process.execPath, ["scripts/create-product-media-key-file.mjs", target], { encoding: "utf8" });
    const first = run(path);
    assert.equal(first.status, 0);
    assert.ok(first.stderr.length === 0);
    const bytes = await readFile(path);
    const keys = JSON.parse(bytes);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal(Buffer.from(keys.encryption.keyBase64, "base64").length, 32);
    assert.equal(Buffer.from(keys.digestKeys[0].keyBase64, "base64").length, 32);
    // Keep assertions boolean so failed tests cannot print key values or file bytes.
    assert.ok(keys.encryption.keyBase64 !== keys.digestKeys[0].keyBase64);
    assert.ok(keys.currentDigestKeyId === keys.digestKeys[0].keyId);
    assert.ok(!first.stdout.includes(keys.encryption.keyBase64));
    assert.ok(!first.stdout.includes(keys.digestKeys[0].keyBase64));
    assert.equal(run(path).status, 1);
    assert.ok((await readFile(path)).equals(bytes));
    const publicDirectory = join(taskDirectory, "public");
    await mkdir(publicDirectory, { mode: 0o755 });
    await chmod(publicDirectory, 0o755);
    assert.equal(run(join(publicDirectory, "keys.json")).status, 1);
    const unsafeAncestor = join(taskDirectory, "unsafe-ancestor");
    await mkdir(unsafeAncestor, { mode: 0o777 });
    await chmod(unsafeAncestor, 0o777);
    const secureChild = join(unsafeAncestor, "private");
    await mkdir(secureChild, { mode: 0o700 });
    assert.equal(run(join(secureChild, "keys.json")).status, 1);
    const alias = join(taskDirectory, "alias");
    await symlink(taskDirectory, alias);
    assert.equal(run(join(alias, "another.json")).status, 1);
    const fileAlias = join(taskDirectory, "file-alias.json");
    await symlink(path, fileAlias);
    assert.equal(run(fileAlias).status, 1);
    assert.ok((await readFile(path)).equals(bytes));
    assert.equal(run("relative.json").status, 1);
  } finally {
    await rm(taskDirectory, { recursive: true });
  }
});

test("grant signing setup writes a separate P-256 PKCS8 file and prints only public key ID", async () => {
  const taskDirectory = await realpath(await mkdtemp(join(tmpdir(), "sg-media-grant-cli-check-")));
  try {
    const path = join(taskDirectory, "grant.pem");
    const result = spawnSync(process.execPath, ["scripts/create-product-media-key-file.mjs", "--grant-signing", path], { encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.ok(result.stderr.length === 0);
    const bytes = await readFile(path);
    const privateKey = createPrivateKey(bytes);
    assert.ok(bytes.toString("utf8").startsWith("-----BEGIN PRIVATE KEY-----\n"));
    assert.equal(privateKey.asymmetricKeyType, "ec");
    assert.equal(privateKey.asymmetricKeyDetails.namedCurve, "prime256v1");
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const publicKey = createPublicKey(privateKey);
    const publicId = createHash("sha256").update(publicKey.export({ format: "der", type: "spki" })).digest("hex");
    const emitted = JSON.parse(result.stdout.trim().split("\n").at(-1));
    assert.ok(emitted.publicGrantKeyId === publicId);
    assert.ok(!result.stdout.includes("PRIVATE KEY"));
    assert.ok(!result.stdout.includes(bytes.toString("utf8")));
    const challenge = Buffer.from("synthetic key setup proof");
    assert.ok(verify("sha256", challenge, publicKey, sign("sha256", challenge, privateKey)));
    const duplicate = spawnSync(process.execPath, ["scripts/create-product-media-key-file.mjs", "--grant-signing", path], { encoding: "utf8" });
    assert.equal(duplicate.status, 1);
    assert.ok((await readFile(path)).equals(bytes));
    bytes.fill(0);
  } finally {
    await rm(taskDirectory, { recursive: true });
  }
});
