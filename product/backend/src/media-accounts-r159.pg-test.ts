import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { Pool } from "pg";
import { contractVersion } from "@socialgrowth/product-contracts";
import { OperatorAuthService } from "./operator-auth-service.js";
import { MediaAccountStore } from "./media-account-store.js";
import { MediaCredentialKeyCustodian } from "./media-credential-key-custodian.js";
import { MediaCredentialStore, type MediaCredentialWriteKeys } from "./media-credential-store.js";
import { ResourceReservationError } from "./resource-reservation-core.js";
import { ResourceReservationStore } from "./resource-reservation-store.js";

// This test may reset only the single loopback DB bound to the exact owned
// fixture container established by the lead runner. Never print the URL.
const url = process.env.SG_PRODUCT_TEST_DATABASE_URL;
const containerId = process.env.SG_PRODUCT_TEST_OWNED_PG_CONTAINER_ID;
const ownerLabel = process.env.SG_PRODUCT_TEST_OWNED_PG_LABEL;
const systemIdentifier = process.env.SG_PRODUCT_TEST_EXPECT_DATABASE_SYSTEM_IDENTIFIER;
const expectedDb = process.env.SG_PRODUCT_TEST_EXPECT_DATABASE_NAME;
if (!url || !containerId || !/^[a-f0-9]{64}$/.test(containerId) || !ownerLabel
  || !/^sg-core-local-[0-9a-f-]{36}$/.test(ownerLabel) || !systemIdentifier || !/^\d+$/.test(systemIdentifier)
  || expectedDb !== "sg_core_local" || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1"
  || new URL(url).hostname !== "127.0.0.1" || new URL(url).pathname !== "/sg_core_local" || !/^\d+$/.test(new URL(url).port)) {
  throw new Error("R159 account checks require the exact owned loopback PostgreSQL fixture");
}
const port = new URL(url).port, labelKey = "socialgrowth.fixture", schema = "socialgrowth_product";
const pool = new Pool({ connectionString: url, max: 5, application_name: "sg-media-accounts-r159-pg-test" });
const pepper = "synthetic-media-account-r159-auth-pepper";
const auth = new OperatorAuthService(pool, pepper);
const keys: MediaCredentialWriteKeys = { encryption: { keyId: "media_enc_fixture", key: randomBytes(32) },
  currentDigestKeyId: "media_digest_fixture", digestKeys: [{ keyId: "media_digest_fixture", key: randomBytes(32) }] };
const custodian = new MediaCredentialKeyCustodian(keys), accountStore = new MediaAccountStore(pool, auth, custodian),
  credentialStore = new MediaCredentialStore(pool, auth, custodian), resourceStore = new ResourceReservationStore(pool, auth);

async function guard(): Promise<void> {
  const inspect = JSON.parse(execFileSync("docker", ["inspect", containerId!], { encoding: "utf8" }))[0];
  assert.equal(inspect.Id, containerId);
  assert.equal(inspect.State.Running, true);
  assert.equal(inspect.Config.Labels?.[labelKey], ownerLabel);
  assert.deepEqual(inspect.NetworkSettings.Ports?.["5432/tcp"], [{ HostIp: "127.0.0.1", HostPort: port }]);
  const current = (await pool.query("SELECT current_database() AS name,system_identifier::text AS system_identifier FROM pg_control_system()")).rows[0];
  assert.equal(current.name, expectedDb);
  assert.equal(current.system_identifier, systemIdentifier);
}
async function ddl(sql: string): Promise<void> { await guard(); await pool.query(sql); }
async function migration(file: string): Promise<void> {
  await guard(); const client = await pool.connect();
  try { await client.query(await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8")); }
  catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}
function requestMeta(kind: string) { const key = `${kind}_${randomUUID().replaceAll("-", "")}`; return { contractVersion, requestId: `request-${randomUUID()}`, idempotencyKey: key }; }
async function actor() {
  const operatorId = randomUUID(), sessionId = randomUUID(), token = randomBytes(32).toString("base64url"), csrf = randomBytes(32).toString("base64url");
  const digest = (value: string) => createHash("sha256").update(value).digest();
  await pool.query(`INSERT INTO ${schema}.operators(operator_id,login_name,display_name,password_hash,status) VALUES($1,$2,'Synthetic R159 operator','not-a-password','active')`, [operatorId, `fixture-${operatorId}`]);
  await pool.query(`INSERT INTO ${schema}.operator_sessions(session_id,operator_id,token_digest,csrf_digest,credential_version,expires_at) VALUES($1,$2,$3,$4,1,clock_timestamp()+interval '1 day')`, [sessionId, operatorId, digest(token), digest(csrf)]);
  return { operatorId, token, csrf };
}

let sourceOperator: string, projectId: string, device1: string, device2: string, accountId: string, identity1: string, identity2: string;
let oldCanonical: string;
before(async () => {
  await guard();
  await ddl(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  const migrationFiles = (await readdir(new URL("../migrations/", import.meta.url))).filter(file => /^\d{4}.*\.sql$/.test(file)).sort();
  const legacyMigrations = migrationFiles.filter(file => Number(file.slice(0, 4)) <= 38);
  assert.ok(legacyMigrations.some(file => file.startsWith("0038_")));
  for (const file of legacyMigrations) await migration(file);
  const owner = await actor(); sourceOperator = owner.operatorId;
  projectId = randomUUID(); device1 = randomUUID(); device2 = randomUUID(); accountId = randomUUID(); identity1 = randomUUID(); identity2 = randomUUID();
  oldCanonical = `legacy_${randomUUID().replaceAll("-", "")}`;
  await pool.query(`INSERT INTO ${schema}.projects(project_id,name,kind,owner_operator_id,created_by_operator_id) VALUES($1,'R159 migration fixture','company_owned',$2,$2)`, [projectId, sourceOperator]);
  await pool.query(`INSERT INTO ${schema}.devices(device_id,display_name,state) VALUES($1,'R159 old phone','access_ready'),($2,'R159 new phone','access_ready')`, [device1, device2]);
  await pool.query(`INSERT INTO ${schema}.media_accounts(account_id,platform,canonical_account_ref) VALUES($1,'facebook',$2)`, [accountId, oldCanonical]);
  await pool.query(`INSERT INTO ${schema}.publishing_identities(identity_id,account_id,platform,canonical_identity_ref) VALUES($1,$2,'facebook',$3),($4,$2,'facebook',$5)`,
    [identity1, accountId, `page_${randomUUID().replaceAll("-", "")}`, identity2, `page_${randomUUID().replaceAll("-", "")}`]);
  await pool.query(`INSERT INTO ${schema}.project_device_reservations(device_id,project_id) VALUES($1,$2),($3,$2)`, [device1, projectId, device2]);
  await pool.query(`INSERT INTO ${schema}.project_account_reservations(account_id,project_id) VALUES($1,$2)`, [accountId, projectId]);
  await pool.query(`INSERT INTO ${schema}.project_identity_reservations(identity_id,account_id,platform,device_id,project_id,reserved_by_operator_id) VALUES($1,$2,'facebook',$3,$4,$5),($6,$2,'facebook',$7,$4,$5)`,
    [identity1, accountId, device1, projectId, sourceOperator, identity2, device2]);
  const task1 = randomUUID(), task2 = randomUUID(), ref1 = `old_${randomUUID().replaceAll("-", "")}`, ref2 = `old_${randomUUID().replaceAll("-", "")}`;
  const intent = (ref: string) => ({ accountId, deviceId: device1, parentLoginRef: ref, mode: "check_only", target: { platform: "facebook", name: "Synthetic Page", expectedId: null, category: null, description: "" }, scopeRef: "synthetic_scope", allowTrustedInstall: false, allowIdentityCreation: false });
  const insertTask = (taskId: string, ref: string) => pool.query(`INSERT INTO ${schema}.account_preparation_tasks(task_id,project_id,parent_login_ref,platform,intent,intent_digest,selected_account_id,selected_device_id,state,blockers,requested_by)
    VALUES($1,$2,$3,'facebook',$4,$5,$6,$7,'waiting_resources','[]'::jsonb,$8)`, [taskId, projectId, ref, intent(ref), "a".repeat(64), accountId, device1, sourceOperator]);
  await insertTask(task1, ref1);

  // Existing account->two-phone history must fail the migration without choosing
  // a row. The task index is clean here, so this isolates the pair conflict.
  await assert.rejects(migration("0039_media_accounts_r159.sql"), error => typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "23505");
  await pool.query(`DELETE FROM ${schema}.project_identity_reservations WHERE identity_id=$1`, [identity2]);
  // With the binding conflict removed, two tasks for the same project/account
  // independently prove the new task unique index also fails closed.
  await insertTask(task2, ref2);
  await assert.rejects(migration("0039_media_accounts_r159.sql"), error => typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "23505");
  await pool.query(`DELETE FROM ${schema}.account_preparation_tasks WHERE task_id=$1`, [task2]);
  await migration("0039_media_accounts_r159.sql");
});
after(async () => { try { await guard(); await ddl(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
  finally { custodian.dispose(); keys.encryption.key.fill(0); for (const key of keys.digestKeys) key.key.fill(0); await pool.end(); } });

test("migration fails closed on contradictory legacy reservations/tasks, then preserves the single old device binding", async () => {
  await guard();
  const old = (await pool.query(`SELECT account_id,canonical_account_ref,legacy_declared_canonical_account_ref,parent_login_verification FROM ${schema}.media_accounts WHERE account_id=$1`, [accountId])).rows[0];
  assert.equal(old.canonical_account_ref, null); assert.equal(old.legacy_declared_canonical_account_ref, oldCanonical); assert.equal(old.parent_login_verification, "registered_unverified");
  const assignments = await pool.query(`SELECT project_id,device_id FROM ${schema}.project_media_account_assignments WHERE account_id=$1`, [accountId]);
  assert.deepEqual(assignments.rows, [{ project_id: projectId, device_id: device1 }]);
  await assert.rejects(pool.query(`UPDATE ${schema}.project_media_account_assignments SET device_id=$2 WHERE account_id=$1`, [accountId, device2]),
    error => typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "P0001");
  await assert.rejects(pool.query(`DELETE FROM ${schema}.project_media_account_assignments WHERE account_id=$1`, [accountId]),
    error => typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "P0001");
  const work = await actor(), read = await resourceStore.readAccountAssignments(work.token, projectId);
  assert.equal(read.assignments.length, 1); assert.equal(read.assignments[0]?.deviceId, device1);
});

test("account credential creation, pre-Page assignment, one-phone ownership and blocked handover stay transactional", async () => {
  await guard();
  const work = await actor();
  const legacyCredential = await credentialStore.write(work.token, work.csrf, { metadata: requestMeta("legacy_credential"), credentialId: null, accountId,
    platform: "facebook", expectedRevision: 0, operation: "put", loginIdentifier: "legacy-fb-login" }, Buffer.from('{"login":"legacy-fb-login","password":"synthetic-secret"}'));
  assert.equal(legacyCredential.credential.state, "stored_unverified");
  const currentVersion = Number((await pool.query(`SELECT version::text FROM ${schema}.resource_reservation_guard WHERE singleton=true`)).rows[0].version);
  const created = await accountStore.create(work.token, work.csrf, { metadata: requestMeta("create_youtube"), expectedResourceVersion: currentVersion,
    platform: "youtube", displayName: "Synthetic YT", loginIdentifier: "legacy-yt-login", password: "synthetic-only" });
  assert.equal(created.account.canonicalAccountRef, null); assert.equal(created.account.credential?.state, "stored_unverified");
  const before = await resourceStore.readAccountAssignments(work.token, projectId), device = before.eligibleDevices.find(row => row.deviceId === device2);
  assert.ok(device);
  const assigned = await resourceStore.assignAccounts(work.token, work.csrf, { metadata: requestMeta("assign_yt"), expectedResourceVersion: before.resourceVersion,
    expectedProjectVersion: before.projectVersion, expectedDeviceVersion: device.deviceVersion, projectId, deviceId: device2, accountIds: [created.account.accountId] });
  assert.equal(assigned.assignments.length, 1); assert.equal(assigned.assignments[0]?.deviceId, device2);
  const fresh = await resourceStore.readAccountAssignments(work.token, projectId), otherDevice = fresh.eligibleDevices.find(row => row.deviceId === device1)!;
  await assert.rejects(resourceStore.assignAccounts(work.token, work.csrf, { metadata: requestMeta("move_without_handover"), expectedResourceVersion: fresh.resourceVersion,
    expectedProjectVersion: fresh.projectVersion, expectedDeviceVersion: otherDevice.deviceVersion, projectId, deviceId: device1, accountIds: [created.account.accountId] }),
    error => error instanceof ResourceReservationError && error.code === "HANDOVER_REQUIRED");
  const handover = await resourceStore.requestHandover(work.token, work.csrf, { metadata: requestMeta("handover"), expectedResourceVersion: fresh.resourceVersion,
    sourceProjectId: projectId, sourceDeviceId: device2, targetProjectId: projectId, targetDeviceId: device1, accountIds: [created.account.accountId] });
  assert.equal(handover.state, "blocked"); assert.equal(handover.currentAssignments[0]?.deviceId, device2);
  await assert.rejects(resourceStore.assignAccounts(work.token, work.csrf, { metadata: requestMeta("orphan_move"), expectedResourceVersion: handover.resourceVersion,
    expectedProjectVersion: fresh.projectVersion, expectedDeviceVersion: device.deviceVersion, projectId, deviceId: device2, accountIds: [accountId] }),
    error => error instanceof ResourceReservationError && error.code === "HANDOVER_REQUIRED");

  const canonical = `verified_${randomUUID().replaceAll("-", "")}`;
  await pool.query(`UPDATE ${schema}.media_accounts SET canonical_account_ref=$2,parent_login_verification='verified' WHERE account_id=$1`, [created.account.accountId, canonical]);
  const rotated = await credentialStore.write(work.token, work.csrf, { metadata: requestMeta("rotate_verified"), credentialId: created.account.credential!.credentialId,
    accountId: created.account.accountId, platform: "youtube", expectedRevision: created.account.credential!.revision, operation: "put", loginIdentifier: "rotated-yt-login" },
    Buffer.from('{"login":"rotated-yt-login","password":"synthetic-rotated-secret"}'));
  assert.equal(rotated.credential.revision, 2);
  const afterRotation = (await pool.query(`SELECT canonical_account_ref,parent_login_verification FROM ${schema}.media_accounts WHERE account_id=$1`, [created.account.accountId])).rows[0];
  assert.equal(afterRotation.canonical_account_ref, canonical); assert.equal(afterRotation.parent_login_verification, "registered_unverified");
  const listedAfterRotation = await accountStore.read(work.token);
  const rotatedAccount = listedAfterRotation.accounts.find(account => account.accountId === created.account.accountId);
  assert.equal(rotatedAccount?.canonicalAccountRef, canonical);
  assert.equal(rotatedAccount?.parentLoginVerification, "registered_unverified");
  assert.equal(rotatedAccount?.credential?.revision, 2);
});
