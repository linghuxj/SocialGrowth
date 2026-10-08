import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { before, after, test } from "node:test";
import { Pool } from "pg";
import { contractVersion, executionLibraryVersion, type IdentityVerificationReceipt } from "@socialgrowth/product-contracts";
import { OperatorAuthService } from "./operator-auth-service.js";
import { AccountPreparationService } from "./account-preparation-service.js";
import { MediaAccountStore } from "./media-account-store.js";
import { canonicalMaterial } from "./material-registry-core.js";
import { sealMediaCredentialPayload } from "./media-credential-envelope.js";

const url = process.env.SG_PRODUCT_TEST_DATABASE_URL;
if (!url || new URL(url).hostname !== "127.0.0.1"
  || !/^\/sg_identity_verification_test_[a-f0-9]{12}$/.test(new URL(url).pathname)) throw new Error("Disposable identity component database required");
const pool = new Pool({ connectionString: url }), s = "socialgrowth_product";
const auth = new OperatorAuthService(pool, "synthetic-identity-verification-pepper-0001");
const metadata = () => ({ contractVersion, requestId: `request-${randomUUID()}`, idempotencyKey: `identity-sync-${randomUUID()}` });
before(async () => {
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, new URL(url).pathname.slice(1));
  const dir = new URL("../migrations/", import.meta.url);
  for (const file of (await readdir(dir)).filter(f => /^\d{4}.*\.sql$/.test(f)).sort()) await pool.query(await readFile(new URL(file, dir), "utf8"));
});
after(async () => pool.end());
async function fixture() {
  const actor = randomUUID(), token = randomBytes(32).toString("base64url"), csrf = randomBytes(32).toString("base64url"),
    projectId = randomUUID(), accountId = randomUUID(), deviceId = randomUUID(), credentialId = randomUUID();
  const hash = (value: string) => createHash("sha256").update(value).digest();
  await pool.query(`INSERT INTO ${s}.operators(operator_id,login_name,display_name,password_hash,status) VALUES($1,$2,'Synthetic identity','not-a-password','active')`, [actor, `fixture-${actor}`]);
  await pool.query(`INSERT INTO ${s}.operator_sessions(session_id,operator_id,token_digest,csrf_digest,credential_version,expires_at) VALUES($1,$2,$3,$4,1,clock_timestamp()+interval '1 day')`, [randomUUID(), actor, hash(token), hash(csrf)]);
  await pool.query(`INSERT INTO ${s}.projects(project_id,name,kind,created_by_operator_id) VALUES($1,'Synthetic identity','company_owned',$2)`, [projectId, actor]);
  const login = `synthetic-${accountId}@example.invalid`;
  await pool.query(`INSERT INTO ${s}.media_accounts(account_id,platform,display_name,login_identifier,normalized_login_identifier) VALUES($1,'facebook','Synthetic parent',$2,$2)`, [accountId, login]);
  const envelope = sealMediaCredentialPayload(Buffer.from(JSON.stringify({ login, password: "synthetic-unused-secret" })),
    { accountId, credentialId, platform: "facebook", revision: 1 }, { keyId: "synthetic", key: randomBytes(32) });
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`INSERT INTO ${s}.media_credential_revisions(credential_id,account_id,platform,revision,state,encryption_key_id,envelope,recorded_by) VALUES($1,$2,'facebook',1,'stored_unverified','synthetic',$3,$4)`, [credentialId, accountId, envelope, actor]);
    await c.query(`INSERT INTO ${s}.media_credentials VALUES($1,$2,'facebook',1)`, [credentialId, accountId]);
    await c.query("COMMIT");
  } finally { c.release(); }
  await pool.query(`INSERT INTO ${s}.devices(device_id,display_name,state) VALUES($1,'Synthetic phone','associated_pending_access')`, [deviceId]);
  await pool.query(`INSERT INTO ${s}.project_account_reservations VALUES($1,$2)`, [accountId, projectId]);
  await pool.query(`INSERT INTO ${s}.project_device_reservations VALUES($1,$2)`, [deviceId, projectId]);
  await pool.query(`INSERT INTO ${s}.project_media_account_assignments(account_id,platform,project_id,device_id,reserved_by_operator_id) VALUES($1,'facebook',$2,$3,$4)`, [accountId, projectId, deviceId, actor]);
  const version = Number((await pool.query(`SELECT version FROM ${s}.resource_reservation_guard`)).rows[0].version);
  let receipt: IdentityVerificationReceipt | null = null, reads = 0;
  let beforeReply: (() => Promise<void>) | undefined;
  const service = new AccountPreparationService(pool, auth, { read: async () => { reads++; await beforeReply?.(); return receipt; } });
  const intent = { accountId, deviceId, mode: "check_only", target: { platform: "facebook", name: "Existing Page", expectedId: null, category: null, description: "" }, scopeRef: "authorized_scope", allowTrustedInstall: false, allowIdentityCreation: false };
  const view = await service.write(token, csrf, { metadata: metadata(), protocolVersion: executionLibraryVersion, projectId,
    expectedProjectVersion: 0, expectedResourceVersion: version, intent }, "request");
  const task = view.tasks[0]!;
  receipt = { requestId: task.taskId, sourceJobId: randomUUID(), traceId: randomUUID(),
    intentDigest: createHash("sha256").update(canonicalMaterial({ ...intent, parentLoginRef: null })).digest("hex"),
    projectId, accountId, deviceId, platform: "facebook", observedLoginIdentifier: login,
    canonicalAccountRef: String(BigInt(`0x${randomBytes(6).toString("hex")}`)), canonicalIdentityRef: String(BigInt(`0x${randomBytes(6).toString("hex")}`)),
    observedName: "Existing Page", scopeRef: "authorized_scope", verifiedAt: new Date().toISOString(), screenshotSha256: "a".repeat(64),
    appReady: true, parentLoginVerified: true, managementVerified: true, identityCreated: false, noPublication: true };
  const request = { metadata: metadata(), protocolVersion: executionLibraryVersion, projectId, taskId: task.taskId,
    expectedTaskVersion: task.taskVersion, expectedResourceVersion: view.resourceVersion };
  return { service, token, csrf, actor, accountId, deviceId, credentialId, projectId, request, receipt,
    reads: () => reads, setReceipt: (value: IdentityVerificationReceipt | null) => { receipt = value; },
    onReply: (fn: () => Promise<void>) => { beforeReply = fn; } };
}
async function count() { return Number((await pool.query(`SELECT count(*) FROM ${s}.account_identity_verifications`)).rows[0].count); }
test("atomic receipt binds existing parent and unique identity, real projections and replay preserve one result", async () => {
  const f = await fixture(), before = await count();
  const result = await f.service.syncIdentity(f.token, f.csrf, f.request);
  assert.equal(result.identityVerifications.length, 1);
  assert.equal(result.identityVerifications[0]!.currentCredentialMatches, true);
  assert.equal(result.tasks[0]!.publicationAllowed, false);
  assert.equal(await count(), before + 1);
  const list = await new MediaAccountStore(pool, auth).read(f.token);
  const account = list.accounts.find(a => a.accountId === f.accountId)!;
  assert.equal(account.parentLoginVerification, "verified");
  assert.equal(account.publishingIdentities[0]!.verificationState, "verified");
  assert.equal(account.publishingIdentities[0]!.managementState, "managed");
  assert.deepEqual(await f.service.syncIdentity(f.token, f.csrf, f.request), result);
  assert.equal(f.reads(), 1); assert.equal(await count(), before + 1);
  await assert.rejects(f.service.syncIdentity(f.token, f.csrf, { ...f.request, taskId: randomUUID() }), /different input/);
  await assert.rejects(pool.query(`UPDATE ${s}.account_identity_verifications SET receipt='{}' WHERE task_id=$1`, [f.request.taskId]));
});
test("authentication, missing source, foreign receipt and stale facts never change registry", async () => {
  const f = await fixture(), before = await count();
  await assert.rejects(f.service.syncIdentity(f.token, "incorrect", f.request)); assert.equal(f.reads(), 0);
  f.setReceipt(null); await assert.rejects(f.service.syncIdentity(f.token, f.csrf, f.request));
  f.setReceipt({ ...f.receipt, accountId: randomUUID() }); await assert.rejects(f.service.syncIdentity(f.token, f.csrf, f.request));
  assert.equal(await count(), before);
  assert.equal((await pool.query(`SELECT canonical_account_ref FROM ${s}.media_accounts WHERE account_id=$1`, [f.accountId])).rows[0].canonical_account_ref, null);
});
test("credential rotation during source fetch cannot grant parent or management verification", async () => {
  const f = await fixture(), before = await count();
  f.onReply(async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`INSERT INTO ${s}.media_credential_revisions(credential_id,account_id,platform,revision,state,recorded_by) VALUES($1,$2,'facebook',2,'invalidated',$3)`, [f.credentialId, f.accountId, f.actor]);
      await c.query(`UPDATE ${s}.media_credentials SET revision=2 WHERE credential_id=$1`, [f.credentialId]); await c.query("COMMIT");
    } finally { c.release(); }
  });
  await assert.rejects(f.service.syncIdentity(f.token, f.csrf, f.request)); assert.equal(await count(), before);
});
test("audit failure rolls back identity, parent, reservation and receipt together", async () => {
  const f = await fixture(), before = await count();
  await pool.query(`CREATE FUNCTION ${s}.identity_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private-test-error'; END $$;
    CREATE TRIGGER identity_test_audit_failure BEFORE INSERT ON ${s}.audit_records FOR EACH ROW EXECUTE FUNCTION ${s}.identity_test_audit_failure()`);
  try {
    await assert.rejects(f.service.syncIdentity(f.token, f.csrf, f.request), error => error instanceof Error && !error.message.includes("private-test-error"));
    assert.equal(await count(), before);
    assert.equal((await pool.query(`SELECT count(*) FROM ${s}.publishing_identities WHERE account_id=$1`, [f.accountId])).rows[0].count, "0");
    assert.equal((await pool.query(`SELECT canonical_account_ref FROM ${s}.media_accounts WHERE account_id=$1`, [f.accountId])).rows[0].canonical_account_ref, null);
  } finally { await pool.query(`DROP TRIGGER identity_test_audit_failure ON ${s}.audit_records; DROP FUNCTION ${s}.identity_test_audit_failure()`); }
});
test("paused device and an identity owned by another account remain blocked", async () => {
  const f = await fixture(), before = await count();
  await pool.query(`UPDATE ${s}.devices SET state='paused' WHERE device_id=$1`, [f.deviceId]);
  await assert.rejects(f.service.syncIdentity(f.token, f.csrf, f.request));
  assert.equal(f.reads(), 0); assert.equal(await count(), before);
  await pool.query(`UPDATE ${s}.devices SET state='associated_pending_access' WHERE device_id=$1`, [f.deviceId]);
  const other = randomUUID();
  await pool.query(`INSERT INTO ${s}.media_accounts(account_id,platform) VALUES($1,'facebook')`, [other]);
  await pool.query(`INSERT INTO ${s}.publishing_identities(identity_id,account_id,platform,canonical_identity_ref) VALUES($1,$2,'facebook',$3)`, [randomUUID(), other, f.receipt.canonicalIdentityRef]);
  await assert.rejects(f.service.syncIdentity(f.token, f.csrf, f.request));
  assert.equal(await count(), before);
  assert.equal((await pool.query(`SELECT canonical_account_ref FROM ${s}.media_accounts WHERE account_id=$1`, [f.accountId])).rows[0].canonical_account_ref, null);
});
