import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { MediaCredentialError, sealMediaCredentialPayload, withDecryptedMediaCredential, maxMediaCredentialPayloadBytes } from "./media-credential-envelope.js";

const context = () => ({ credentialId: randomUUID(), accountId: randomUUID(), platform: "facebook" as const, revision: 1 });
const key = () => ({ keyId: "synthetic_media_key_1", key: randomBytes(32) });
const secret = () => Buffer.from('{"password":"  synthetic-密碼\\n🧪  ","login":" synthetic@example.invalid "}', "utf8");
const safe = (error: unknown) => {
  assert.ok(error instanceof MediaCredentialError); assert.equal(error.message, "MEDIA_CREDENTIAL_UNAVAILABLE");
  assert.equal(error.cause, undefined); assert.equal(JSON.stringify(error), "{}"); return true;
};
test("media credential envelope binds account and preserves exact secret bytes; owned lent bytes clear after sink and originals remain", async () => {
  const c = context(), k = key(), p = secret(), before = Buffer.from(p), kb = Buffer.from(k.key), envelope = sealMediaCredentialPayload(p, c, k);
  let lent: Buffer | undefined, calls = 0;
  const result = await withDecryptedMediaCredential(envelope, c, async value => { lent = value; calls++; assert.deepEqual(value, before); }, k);
  assert.equal(result, undefined); assert.equal(calls, 1); assert.ok(lent); assert.deepEqual(lent, Buffer.alloc(before.length));
  assert.deepEqual(p, before); assert.deepEqual(k.key, kb);
  assert.ok(!JSON.stringify(envelope).includes("synthetic@example.invalid")); assert.ok(!JSON.stringify(envelope).includes("password"));
  assert.deepEqual(Object.keys(envelope).sort(), ["format", "context", "keyId", "payloadBytes", "nonce", "tag", "ciphertext"].sort());
});
test("media credential fresh envelopes use independent nonce and authenticate full account, platform, credential revision and key binding", async () => {
  const c = context(), k = key(), p = secret(), envelope = sealMediaCredentialPayload(p, c, k), next = sealMediaCredentialPayload(p, c, k);
  assert.notEqual(envelope.nonce, next.nonce); assert.notEqual(envelope.ciphertext, next.ciphertext);
  let calls = 0; const sink = async () => { calls++; };
  for (const expected of [{ ...c, accountId: randomUUID() }, { ...c, credentialId: randomUUID() }, { ...c, platform: "youtube" }, { ...c, revision: 2 }]) {
    await assert.rejects(withDecryptedMediaCredential(envelope, expected, sink, k), safe);
  }
  for (const change of [{ context: { ...c, accountId: randomUUID() } }, { context: { ...c, revision: 2 } }, { keyId: "synthetic_media_key_2" },
    { payloadBytes: envelope.payloadBytes - 1 }, { format: "foreign-vault-v1" }, { actionPermissionGranted: true },
    { ciphertext: Buffer.alloc(p.length).toString("base64") }, { nonce: Buffer.alloc(12).toString("base64") }, { tag: Buffer.alloc(16).toString("base64") }]) {
    await assert.rejects(withDecryptedMediaCredential({ ...envelope, ...change }, c, sink, k), safe);
  }
  await assert.rejects(withDecryptedMediaCredential(envelope, c, sink, { ...k, key: randomBytes(32) }), safe);
  await assert.rejects(withDecryptedMediaCredential(envelope, c, sink, { ...k, keyId: "another_key" }), safe); assert.equal(calls, 0);
});
test("media credentials default closed, invalid bounded UTF8/secret/context/key has only fixed errors and never reaches sensitive sink", async () => {
  const c = context(), k = key(), p = secret(), envelope = sealMediaCredentialPayload(p, c, k); let calls = 0;
  assert.throws(() => sealMediaCredentialPayload(p, c), safe);
  await assert.rejects(withDecryptedMediaCredential(envelope, c, async () => { calls++; }), safe);
  for (const invalid of [null, "synthetic-secret", Buffer.alloc(0), Buffer.alloc(maxMediaCredentialPayloadBytes + 1), Buffer.from([0xff]),
    Buffer.from('{"login":"x","password":"secret","actorId":"fake"}'), Buffer.from('{"login":"x","password":""}'),
    Buffer.from(JSON.stringify({ login: "x", password: "x".repeat(4097) })), Buffer.from('not-json-secret')]) assert.throws(() => sealMediaCredentialPayload(invalid, c, k), safe);
  for (const invalid of [{ ...c, accountId: c.accountId.toUpperCase() }, { ...c, revision: 0 }, { ...c, revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...c, accountId: c.accountId + "\n" }, { ...c, acceptanceStarted: true }]) assert.throws(() => sealMediaCredentialPayload(p, invalid, k), safe);
  for (const badKey of [{ ...k, keyId: "bad\n" }, { ...k, key: Buffer.alloc(31) }, { ...k, keyId: "密钥" }]) assert.throws(() => sealMediaCredentialPayload(p, c, badKey), safe);
  await assert.rejects(withDecryptedMediaCredential({ ...envelope, ciphertext: envelope.ciphertext + "\n" }, c, async () => { calls++; }, k), safe);
  assert.equal(calls, 0);
});
test("media credential async sink receives private owned bytes, input/key/context changes cannot substitute them; sink outputs/errors are not propagated", async () => {
  const c = context(), k = key(), p = secret(), envelope = sealMediaCredentialPayload(p, c, k), before = Buffer.from(p); let lent: Buffer | undefined;
  let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
  const promise = withDecryptedMediaCredential(envelope, c, async value => { lent = value; await wait; assert.deepEqual(value, before); return "do-not-return-sensitive-sink-output" as unknown as void; }, k);
  p.fill(0); k.key.fill(0); c.accountId = randomUUID(); envelope.context.accountId = randomUUID(); release();
  assert.equal(await promise, undefined); assert.ok(lent); assert.deepEqual(lent, Buffer.alloc(before.length));
  const k2 = key(), c2 = context(), e2 = sealMediaCredentialPayload(secret(), c2, k2); let rejectedLent: Buffer | undefined;
  await assert.rejects(withDecryptedMediaCredential(e2, c2, async value => { rejectedLent = value; throw new Error(value.toString("utf8")); }, k2), safe);
  assert.ok(rejectedLent); assert.deepEqual(rejectedLent, Buffer.alloc(rejectedLent.length));
});
test("media credential sealing validates an owned raw-byte snapshot, never a caller Buffer toString override", async () => {
  const c = context(), k = key(), p = secret(), original = Buffer.from(p); let calls = 0;
  Object.defineProperty(p, "toString", { value: () => { calls++; throw new Error("Synthetic caller method must not run"); } });
  const envelope = sealMediaCredentialPayload(p, c, k);
  await withDecryptedMediaCredential(envelope, c, async value => { assert.deepEqual(value, original); }, k); assert.equal(calls, 0);
  const malformed = Buffer.from([0xff]);
  Object.defineProperty(malformed, "toString", { value: () => { calls++; return original.toString("utf8"); } });
  assert.throws(() => sealMediaCredentialPayload(malformed, c, k), safe); assert.equal(calls, 0);
});
