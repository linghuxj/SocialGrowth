import assert from "node:assert/strict";
import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { chmod, link, lstat, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { loadMediaInputGrantSigningKey, MediaInputGrantKeyFileError } from "./media-input-grant-key-file.js";

async function owned<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const created = await mkdtemp(join(tmpdir(), "sg-media-input-key-"));
  const directory = await realpath(created);
  await chmod(directory, 0o700);
  try { return await run(directory); }
  finally { await rm(created, { recursive: true, force: true }); }
}

function keyMaterial(curve = "prime256v1") {
  const pair = generateKeyPairSync("ec", { namedCurve: curve });
  const pem = Buffer.from(pair.privateKey.export({ type: "pkcs8", format: "pem" }));
  const spki = createPublicKey(pair.privateKey).export({ type: "spki", format: "der" }) as Buffer;
  const keyId = createHash("sha256").update(spki).digest("hex");
  return { pair, pem, spki, keyId };
}

test("loads only the exact deployed P-256 PKCS#8 key whose SPKI hash matches the selected key ID", async () => {
  await owned(async directory => {
    const material = keyMaterial(), path = join(directory, `${material.keyId}.pem`);
    await writeFile(path, material.pem, { mode: 0o600, flag: "wx" });
    const loaded = await loadMediaInputGrantSigningKey(path, material.keyId);
    const loadedSpki = createPublicKey(loaded.privateKey).export({ type: "spki", format: "der" });
    assert.equal(loaded.keyId, material.keyId);
    assert.deepEqual(loadedSpki, material.spki);
    assert.equal((await lstat(path)).mode & 0o7777, 0o600);
  });
});

test("missing, mismatched, malformed, wrong-curve, oversized, or permissive key files fail closed without repair", async () => {
  await owned(async directory => {
    const material = keyMaterial(), path = join(directory, "grant.pem");
    await assert.rejects(loadMediaInputGrantSigningKey(path, material.keyId), MediaInputGrantKeyFileError);
    assert.equal((await lstat(directory)).isDirectory(), true, "missing key is not generated");

    await writeFile(path, material.pem, { mode: 0o600, flag: "wx" });
    await assert.rejects(loadMediaInputGrantSigningKey(path, "0".repeat(64)), MediaInputGrantKeyFileError);
    await chmod(path, 0o640);
    await assert.rejects(loadMediaInputGrantSigningKey(path, material.keyId), MediaInputGrantKeyFileError);
    assert.equal((await lstat(path)).mode & 0o7777, 0o640, "unsafe permissions are not repaired");
  });

  await owned(async directory => {
    const path = join(directory, "malformed.pem");
    await writeFile(path, Buffer.from("-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----\n"), { mode: 0o600 });
    await assert.rejects(loadMediaInputGrantSigningKey(path, "0".repeat(64)), MediaInputGrantKeyFileError);
  });

  await owned(async directory => {
    const material = keyMaterial("secp256k1"), path = join(directory, "wrong-curve.pem");
    await writeFile(path, material.pem, { mode: 0o600 });
    await assert.rejects(loadMediaInputGrantSigningKey(path, material.keyId), MediaInputGrantKeyFileError);
  });

  await owned(async directory => {
    const path = join(directory, "oversized.pem");
    await writeFile(path, Buffer.alloc(4097, 0x41), { mode: 0o600 });
    await assert.rejects(loadMediaInputGrantSigningKey(path, "0".repeat(64)), MediaInputGrantKeyFileError);
  });
});

test("rejects symlinked parent/file paths, hard links, and noncanonical absolute paths", async () => {
  await owned(async directory => {
    const material = keyMaterial(), path = join(directory, "grant.pem"), alias = join(directory, "grant-link.pem");
    await writeFile(path, material.pem, { mode: 0o600 });
    await symlink(path, alias);
    await assert.rejects(loadMediaInputGrantSigningKey(alias, material.keyId), MediaInputGrantKeyFileError);

    const hard = join(directory, "grant-hardlink.pem");
    await link(path, hard);
    await assert.rejects(loadMediaInputGrantSigningKey(hard, material.keyId), MediaInputGrantKeyFileError);
    await assert.rejects(loadMediaInputGrantSigningKey(`${directory}/./grant.pem`, material.keyId), MediaInputGrantKeyFileError);
  });

  await owned(async directory => {
    const material = keyMaterial(), path = join(directory, "grant.pem"), aliasDir = join(directory, "alias");
    await writeFile(path, material.pem, { mode: 0o600 });
    await symlink(directory, aliasDir);
    await assert.rejects(loadMediaInputGrantSigningKey(join(aliasDir, "grant.pem"), material.keyId), MediaInputGrantKeyFileError);
  });
});

test("refuses a non-absolute key path and never creates signing material", async () => {
  const material = keyMaterial();
  await assert.rejects(loadMediaInputGrantSigningKey("grant.pem", material.keyId), MediaInputGrantKeyFileError);
});
