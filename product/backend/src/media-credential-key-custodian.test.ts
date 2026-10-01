import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { inspect } from "node:util";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { contractVersion } from "@socialgrowth/product-contracts";
import { MediaCredentialStore, type MediaCredentialWriteKeys } from "./media-credential-store.js";
import type { OperatorAuthService } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { MediaCredentialKeyCustodian, MediaCredentialKeyCustodianError } from "./media-credential-key-custodian.js";
const ring = (suffix = "1"): MediaCredentialWriteKeys => ({ encryption: { keyId: `enc_${suffix}`, key: randomBytes(32) },
  currentDigestKeyId: `intent_${suffix}`, digestKeys: [{ keyId: `intent_${suffix}`, key: randomBytes(32) }] });
const keys = (value: MediaCredentialWriteKeys) => [value.encryption.key, ...value.digestKeys.map(key => key.key)];
const unavailable = (error: unknown) => error instanceof MediaCredentialKeyCustodianError && error.message === "CONTROLLED_MEDIA_KEYS_UNAVAILABLE" && !("cause" in error);
test("custodian defaults closed, never serializes key material, and terminal disposal cannot be reopened", () => {
  const closed = new MediaCredentialKeyCustodian(); let calls = 0;
  assert.throws(() => closed.withWriteKeys(() => { calls++; }), unavailable); assert.equal(calls, 0);
  const input = ring(), custodian = new MediaCredentialKeyCustodian(input);
  assert.equal(JSON.stringify(custodian), "{}"); assert.deepEqual(Object.keys(custodian), []);
  assert.ok(!inspect(custodian).includes("enc_1")); assert.ok(!inspect(custodian).includes(input.encryption.key.toString("hex")));
  custodian.dispose(); custodian.dispose(); assert.throws(() => custodian.replace(input), unavailable);
  assert.throws(() => custodian.withWriteKeys(() => { calls++; }), unavailable); assert.equal(calls, 0);
  assert.ok(keys(input).every(key => !key.equals(Buffer.alloc(32))));
});
test("custodian owns original input and leases independent copies, clearing all lent references after use", () => {
  const input = ring(), original = keys(input).map(key => Buffer.from(key)), custodian = new MediaCredentialKeyCustodian(input);
  for (const key of keys(input)) key.fill(0); input.currentDigestKeyId = "changed"; input.encryption.keyId = "changed";
  let lent: Buffer[] = [];
  custodian.withWriteKeys(value => { assert.equal(value.encryption.keyId, "enc_1"); assert.equal(value.currentDigestKeyId, "intent_1"); lent = keys(value);
    lent.forEach((key, index) => assert.ok(key.equals(original[index]!))); });
  assert.ok(lent.every(key => key.equals(Buffer.alloc(32))));
  custodian.withWriteKeys(value => { assert.ok(value.encryption.key.equals(original[0]!)); }); custodian.dispose();
});
test("callback error, result and async return are refused safely and all actual lent bytes are cleared", () => {
  const input = ring(), custodian = new MediaCredentialKeyCustodian(input); let lent: Buffer[] = [];
  const sentinel = new Error("synthetic-key-error-secret");
  assert.throws(() => custodian.withWriteKeys(value => { lent = keys(value); throw sentinel; }), unavailable);
  assert.ok(lent.every(key => key.equals(Buffer.alloc(32))));
  assert.throws(() => custodian.withWriteKeys(value => { lent = keys(value); return value as unknown as void; }), unavailable);
  assert.ok(lent.every(key => key.equals(Buffer.alloc(32))));
  assert.throws(() => custodian.withWriteKeys(value => { lent = keys(value); return Promise.resolve() as unknown as void; }), unavailable);
  assert.ok(lent.every(key => key.equals(Buffer.alloc(32)))); assert.ok(keys(input).every(key => !key.equals(Buffer.alloc(32)))); custodian.dispose();
});
test("callback changes to arrays or key refs cannot hide original buffers from cleanup or wipe foreign replacements", () => {
  const input = ring(), custodian = new MediaCredentialKeyCustodian(input), foreign = randomBytes(32), original = Buffer.from(foreign); let lent: Buffer[] = [];
  custodian.withWriteKeys(value => { lent = keys(value); value.digestKeys = []; value.encryption.key = foreign; });
  assert.ok(lent.every(key => key.equals(Buffer.alloc(32)))); assert.ok(foreign.equals(original));
  custodian.withWriteKeys(value => { assert.equal(value.digestKeys.length, 1); assert.ok(value.encryption.key.equals(input.encryption.key)); }); custodian.dispose();
});
test("valid rotation atomically replaces current ring while in-flight snapshots keep their original key IDs and bytes", () => {
  const initial = ring(), next = ring("2"), custodian = new MediaCredentialKeyCustodian(initial); let lent: Buffer[] = [];
  custodian.withWriteKeys(value => { lent = keys(value); custodian.replace({ ...next, digestKeys: [...initial.digestKeys, ...next.digestKeys] });
    assert.equal(value.currentDigestKeyId, "intent_1"); assert.ok(value.encryption.key.equals(initial.encryption.key)); });
  assert.ok(lent.every(key => key.equals(Buffer.alloc(32))));
  custodian.withWriteKeys(value => { assert.equal(value.currentDigestKeyId, "intent_2"); assert.equal(value.digestKeys.length, 2); assert.ok(value.encryption.key.equals(next.encryption.key)); });
  custodian.replace(null); assert.throws(() => custodian.withWriteKeys(() => {}), unavailable); custodian.replace(next); custodian.dispose();
});
test("malformed rotation cannot replace current ring, duplicate IDs/shared AES-HMAC and missing current key close safely", () => {
  const input = ring(), custodian = new MediaCredentialKeyCustodian(input), bad = ring("2");
  for (const value of [{ ...bad, currentDigestKeyId: "missing" }, { ...bad, digestKeys: [bad.digestKeys[0]!, bad.digestKeys[0]!] },
    { ...bad, digestKeys: [{ keyId: "same_key", key: bad.encryption.key }], currentDigestKeyId: "same_key" },
    { ...bad, encryption: { keyId: "bad\n", key: bad.encryption.key } }, { ...bad, encryption: { keyId: "enc", key: Buffer.alloc(31) } },
    { ...bad, digestKeys: [] }]) {
    assert.throws(() => custodian.replace(value), unavailable);
    custodian.withWriteKeys(current => { assert.equal(current.currentDigestKeyId, "intent_1"); assert.ok(current.encryption.key.equals(input.encryption.key)); });
  }
  assert.ok(keys(input).every(key => !key.equals(Buffer.alloc(32)))); assert.ok(keys(bad).every(key => !key.equals(Buffer.alloc(32)))); custodian.dispose();
});
test("bounded explicit old-key ring accepts sixteen IDs and rejects seventeen without losing valid current configuration", () => {
  const input = ring(), digestKeys = Array.from({ length: 16 }, (_, index) => ({ keyId: `intent_${index}`, key: randomBytes(32) }));
  const custodian = new MediaCredentialKeyCustodian({ ...input, currentDigestKeyId: "intent_0", digestKeys });
  custodian.withWriteKeys(value => { assert.equal(value.digestKeys.length, 16); });
  assert.throws(() => custodian.replace({ ...input, currentDigestKeyId: "intent_0", digestKeys: [...digestKeys, { keyId: "intent_16", key: randomBytes(32) }] }), unavailable);
  custodian.withWriteKeys(value => { assert.equal(value.digestKeys.length, 16); }); custodian.dispose();
});
test("sparse key arrays are refused without replacing current custody or affecting caller bytes", () => {
  const input = ring(), custodian = new MediaCredentialKeyCustodian(input), sparse = new Array<MediaCredentialWriteKeys["digestKeys"][number]>(2);
  sparse[0] = input.digestKeys[0]!;
  assert.throws(() => custodian.replace({ ...input, digestKeys: sparse }), unavailable);
  custodian.withWriteKeys(value => { assert.equal(value.digestKeys.length, 1); assert.ok(value.encryption.key.equals(input.encryption.key)); });
  custodian.dispose(); assert.ok(keys(input).every(key => !key.equals(Buffer.alloc(32))));
});
test("static legacy sparse configuration fails closed only after auth and cannot overwrite auth errors during cleanup", async () => {
  const input = ring(), sparse = new Array<MediaCredentialWriteKeys["digestKeys"][number]>(2); sparse[0] = input.digestKeys[0]!;
  let authenticated = 0, released = 0;
  const pool = { connect: async () => ({ query: async () => ({ rowCount: 1, rows: [] }), release: () => { released++; } }) } as unknown as Pool;
  const auth = { authenticateSessionInTransaction: async () => { authenticated++; throw new ProductTransactionError("AUTHENTICATION_REQUIRED", "synthetic refusal"); } } as unknown as OperatorAuthService;
  const store = new MediaCredentialStore(pool, auth, { ...input, digestKeys: sparse });
  await assert.rejects(store.write("synthetic-token", "synthetic-csrf", { metadata: { contractVersion, requestId: "request-sparse-0001", idempotencyKey: "sparse-intent-0001" },
    credentialId: randomUUID(), accountId: randomUUID(), platform: "facebook", expectedRevision: 0, operation: "put" }, Buffer.from('{"login":"synthetic","password":"synthetic"}')),
  error => error instanceof ProductTransactionError && error.code === "AUTHENTICATION_REQUIRED");
  assert.equal(authenticated, 1); assert.equal(released, 1); assert.ok(keys(input).every(key => !key.equals(Buffer.alloc(32))));
});
test("rejected async copier cannot leak its original error through an unhandled Promise rejection", async () => {
  const input = ring(), custodian = new MediaCredentialKeyCustodian(input); let lent: Buffer[] = [];
  assert.throws(() => custodian.withWriteKeys(value => { lent = keys(value); return Promise.reject(new Error("synthetic-rejected-copier-only")) as unknown as void; }), unavailable);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(lent.every(key => key.equals(Buffer.alloc(32)))); assert.ok(keys(input).every(key => !key.equals(Buffer.alloc(32)))); custodian.dispose();
});
test("native rejected Promise from a trusted vm realm is consumed without extending the byte lease", () => {
  const moduleUrl = new URL("./media-credential-key-custodian.ts", import.meta.url).href;
  const code = `import assert from 'node:assert/strict'; import vm from 'node:vm';
    import { MediaCredentialKeyCustodian } from ${JSON.stringify(moduleUrl)};
    const c = new MediaCredentialKeyCustodian({ encryption: { keyId:'enc', key:Buffer.alloc(32,1) },
      digestKeys:[{keyId:'dig',key:Buffer.alloc(32,2)}], currentDigestKeyId:'dig' }); let borrowed;
    assert.throws(() => c.withWriteKeys(k => { borrowed=[k.encryption.key,k.digestKeys[0].key];
      return vm.runInNewContext('Promise.reject(new Error("synthetic-cross-realm-rejection-only"))');
    }), e => e.message === 'CONTROLLED_MEDIA_KEYS_UNAVAILABLE');
    assert(borrowed.every(v => v.equals(Buffer.alloc(32)))); c.dispose();
    await new Promise(r => setImmediate(r));`;
  const child = spawnSync(process.execPath, ["--import", "tsx", "--unhandled-rejections=strict", "--input-type=module", "-e", code], { encoding: "utf8", timeout: 10_000 });
  assert.equal(child.error, undefined); assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, "");
});
