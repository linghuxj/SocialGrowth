import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, chmodSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { readMediaCredentialKeysFile } from "./media-credential-key-file.js";
import { MediaCredentialKeyCustodian } from "./media-credential-key-custodian.js";

test("protected media credential key file loads exact key set and invalid paths fail closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "sg-media-key-")), path = join(dir, "keys.json"), link = join(dir, "link.json");
  const encryption = randomBytes(32), digest = randomBytes(32);
  try {
    writeFileSync(path, JSON.stringify({ encryption: { keyId: "enc_v1", keyBase64: encryption.toString("base64") },
      currentDigestKeyId: "digest_v1", digestKeys: [{ keyId: "digest_v1", keyBase64: digest.toString("base64") }] }), { mode: 0o600 });
    chmodSync(path, 0o600);
    const keys = readMediaCredentialKeysFile(path); assert.ok(keys); assert.ok(keys.encryption.key.equals(encryption));
    const custodian = new MediaCredentialKeyCustodian(keys);
    keys.encryption.key.fill(0); for (const key of keys.digestKeys) key.key.fill(0);
    custodian.withWriteKeys(value => { assert.ok(value.encryption.key.equals(encryption)); assert.ok(value.digestKeys[0]!.key.equals(digest)); });
    custodian.dispose();
    chmodSync(path, 0o644); assert.equal(readMediaCredentialKeysFile(path), null); chmodSync(path, 0o600);
    writeFileSync(join(dir, "bad.json"), "not valid"); chmodSync(join(dir, "bad.json"), 0o600);
    symlinkSync(path, link); assert.equal(readMediaCredentialKeysFile(link), null);
    assert.equal(readMediaCredentialKeysFile(undefined), null); assert.equal(readMediaCredentialKeysFile("relative-key-file"), null);
  } finally { encryption.fill(0); digest.fill(0); rmSync(dir, { recursive: true, force: true }); }
});
