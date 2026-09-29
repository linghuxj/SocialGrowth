import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";

import { contractVersion } from "@socialgrowth/product-contracts";
import { Pool } from "pg";

import { IdentityTransactionService } from "./identity-transactions.js";
import { ProductTransactionError } from "./product-transaction-error.js";

const databaseUrl = process.env.SG_PRODUCT_TEST_DATABASE_URL;
if (!databaseUrl || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1") {
  throw new Error(
    "PostgreSQL integration test requires SG_PRODUCT_TEST_DATABASE_URL and SG_PRODUCT_TEST_ALLOW_RESET=1",
  );
}

const pool = new Pool({ connectionString: databaseUrl, max: 8 });
const service = new IdentityTransactionService(pool);
const migrationUrl = new URL("../migrations/0001_identity_and_device.sql", import.meta.url);

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function metadata(idempotencyKey: string) {
  return {
    contractVersion,
    idempotencyKey,
    requestId: `request-${randomUUID()}`,
  };
}

async function seedOperator(): Promise<string> {
  const operatorId = randomUUID();
  await pool.query(
    `INSERT INTO socialgrowth_product.operators (
       operator_id, login_name, password_hash, status
     ) VALUES ($1, $2, 'not-a-real-password-hash', 'active')`,
    [operatorId, `operator-${operatorId}`],
  );
  return operatorId;
}

async function seedInvitation(
  operatorId: string,
  code: string,
  maxUses: number,
): Promise<string> {
  const invitationId = randomUUID();
  await pool.query(
    `INSERT INTO socialgrowth_product.provider_invitations (
       invitation_id, code_digest, created_by_operator_id, max_uses, expires_at
     ) VALUES ($1, $2, $3, $4, transaction_timestamp() + interval '1 day')`,
    [invitationId, digest(code), operatorId, maxUses],
  );
  return invitationId;
}

async function seedVerification(phone: string): Promise<string> {
  const verificationId = randomUUID();
  await pool.query(
    `INSERT INTO socialgrowth_product.phone_verifications (
       verification_id, phone_e164, purpose, verified_at, expires_at
     ) VALUES (
       $1, $2, 'provider_registration', transaction_timestamp(),
       transaction_timestamp() + interval '1 hour'
     )`,
    [verificationId, phone],
  );
  return verificationId;
}

async function seedProvider(phone: string): Promise<string> {
  const providerId = randomUUID();
  await pool.query(
    `INSERT INTO socialgrowth_product.providers (
       provider_id, phone_e164, display_name, status
     ) VALUES ($1, $2, 'Integration Provider', 'active')`,
    [providerId, phone],
  );
  return providerId;
}

async function seedInstallation(): Promise<string> {
  const installationId = randomUUID();
  await pool.query(
    `INSERT INTO socialgrowth_product.installations (
       installation_id, credential_digest, generation, status
     ) VALUES ($1, $2, 1, 'active')`,
    [installationId, digest(`credential-${installationId}`)],
  );
  return installationId;
}

before(async () => {
  const migration = await readFile(migrationUrl, "utf8");
  await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE");
  await pool.query(migration);
});

after(async () => {
  try {
    await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE");
  } finally {
    await pool.end();
  }
});

test("last invitation slot is consumed by exactly one concurrent registration", async () => {
  const operatorId = await seedOperator();
  const invitationCode = `invite-${randomUUID()}`;
  await seedInvitation(operatorId, invitationCode, 1);
  const verificationA = await seedVerification("+8613800000001");
  const verificationB = await seedVerification("+8613800000002");

  const results = await Promise.allSettled([
    service.registerProvider(
      {
        displayName: "Provider A",
        invitationCode,
        metadata: metadata("register-slot-A-0001"),
        phoneVerificationId: verificationA,
      },
      { verifiedPhoneVerificationId: verificationA },
    ),
    service.registerProvider(
      {
        displayName: "Provider B",
        invitationCode,
        metadata: metadata("register-slot-B-0001"),
        phoneVerificationId: verificationB,
      },
      { verifiedPhoneVerificationId: verificationB },
    ),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejection = results.find((result) => result.status === "rejected");
  assert.ok(rejection && rejection.status === "rejected");
  assert.ok(rejection.reason instanceof ProductTransactionError);
  assert.equal(rejection.reason.code, "INVITATION_EXHAUSTED");
  const invitation = await pool.query<{ consumed_uses: number }>(
    "SELECT consumed_uses FROM socialgrowth_product.provider_invitations WHERE code_digest = $1",
    [digest(invitationCode)],
  );
  assert.equal(invitation.rows[0]?.consumed_uses, 1);
});

test("registration retry returns the original result without consuming twice", async () => {
  const operatorId = await seedOperator();
  const invitationCode = `invite-${randomUUID()}`;
  await seedInvitation(operatorId, invitationCode, 2);
  const verificationId = await seedVerification("+8613800000011");
  const request = {
    displayName: "Provider Retry",
    invitationCode,
    metadata: metadata("register-retry-key-0001"),
    phoneVerificationId: verificationId,
  };

  const first = await service.registerProvider(request, {
    verifiedPhoneVerificationId: verificationId,
  });
  const second = await service.registerProvider(
    {
      ...request,
      metadata: { ...request.metadata, requestId: `request-${randomUUID()}` },
    },
    { verifiedPhoneVerificationId: verificationId },
  );

  assert.deepEqual(second, first);
  const invitation = await pool.query<{ consumed_uses: number }>(
    "SELECT consumed_uses FROM socialgrowth_product.provider_invitations WHERE code_digest = $1",
    [digest(invitationCode)],
  );
  assert.equal(invitation.rows[0]?.consumed_uses, 1);
  await assert.rejects(
    service.registerProvider(
      { ...request, displayName: "Changed Payload" },
      { verifiedPhoneVerificationId: verificationId },
    ),
    (error: unknown) =>
      error instanceof ProductTransactionError &&
      error.code === "IDEMPOTENCY_KEY_REUSED",
  );
});

test("same phone concurrent registration creates exactly one provider", async () => {
  const operatorId = await seedOperator();
  const invitationA = `invite-${randomUUID()}`;
  const invitationB = `invite-${randomUUID()}`;
  await seedInvitation(operatorId, invitationA, 1);
  await seedInvitation(operatorId, invitationB, 1);
  const phone = "+8613800000012";
  const verificationA = await seedVerification(phone);
  const verificationB = await seedVerification(phone);

  const results = await Promise.allSettled([
    service.registerProvider(
      {
        displayName: "Phone Race A",
        invitationCode: invitationA,
        metadata: metadata("same-phone-race-A-0001"),
        phoneVerificationId: verificationA,
      },
      { verifiedPhoneVerificationId: verificationA },
    ),
    service.registerProvider(
      {
        displayName: "Phone Race B",
        invitationCode: invitationB,
        metadata: metadata("same-phone-race-B-0001"),
        phoneVerificationId: verificationB,
      },
      { verifiedPhoneVerificationId: verificationB },
    ),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejection = results.find((result) => result.status === "rejected");
  assert.ok(rejection && rejection.status === "rejected");
  assert.ok(rejection.reason instanceof ProductTransactionError);
  assert.equal(rejection.reason.code, "PHONE_ALREADY_REGISTERED");
  const providers = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM socialgrowth_product.providers WHERE phone_e164 = $1",
    [phone],
  );
  assert.equal(providers.rows[0]?.count, "1");
});

test("association session replacement and confirmation are atomic and idempotent", async () => {
  const installationId = await seedInstallation();
  const providerId = await seedProvider("+8613800000021");
  const firstSession = await service.createAssociationSession(
    { deviceLabel: "Phone A", metadata: metadata("association-create-key-0001") },
    { installationGeneration: 1, installationId },
  );
  const secondSession = await service.createAssociationSession(
    { deviceLabel: "Phone A", metadata: metadata("association-create-key-0002") },
    { installationGeneration: 1, installationId },
  );
  assert.equal(firstSession.replacedPreviousSession, false);
  assert.equal(secondSession.replacedPreviousSession, true);
  await assert.rejects(
    service.inspectAssociationCode(
      {
        associationCode: firstSession.associationCode,
        metadata: metadata("association-inspect-old-0001"),
      },
      { providerId },
    ),
    (error: unknown) =>
      error instanceof ProductTransactionError &&
      error.code === "ASSOCIATION_SESSION_EXPIRED",
  );
  const inspected = await service.inspectAssociationCode(
    {
      associationCode: secondSession.associationCode,
      metadata: metadata("association-inspect-key-0001"),
    },
    { providerId },
  );
  assert.equal(inspected.installation.deviceLabel, "Phone A");
  assert.equal(inspected.installation.installationId, installationId);

  const request = {
    associationSessionId: secondSession.associationSessionId,
    expectedInstallationId: installationId,
    metadata: metadata("association-confirm-key-0001"),
  };
  const first = await service.confirmAssociation(request, { providerId });
  const retry = await service.confirmAssociation(request, { providerId });

  assert.deepEqual(retry, first);
  const facts = await pool.query<{ associations: string; consumed: string; state: string }>(
    `SELECT
       (SELECT count(*) FROM socialgrowth_product.device_associations
         WHERE installation_id = $1 AND ended_at IS NULL)::text AS associations,
       (SELECT count(*) FROM socialgrowth_product.association_sessions
         WHERE association_session_id = $2 AND consumed_at IS NOT NULL)::text AS consumed,
       (SELECT state FROM socialgrowth_product.devices WHERE device_id = $3) AS state`,
    [installationId, secondSession.associationSessionId, first.deviceId],
  );
  assert.deepEqual(facts.rows[0], {
    associations: "1",
    consumed: "1",
    state: "associated_pending_access",
  });
  const audit = await pool.query<{ actions: string[] }>(
    `SELECT array_agg(action ORDER BY action) AS actions
       FROM socialgrowth_product.audit_records
      WHERE object_id IN ($1, $2)`,
    [secondSession.associationSessionId, first.associationId],
  );
  assert.deepEqual(audit.rows[0]?.actions, [
    "association_session.created",
    "device.associated",
  ]);
});

test("one-time association session permits only one concurrent provider", async () => {
  const installationId = await seedInstallation();
  const providerA = await seedProvider("+8613800000031");
  const providerB = await seedProvider("+8613800000032");
  const session = await service.createAssociationSession(
    { deviceLabel: "Phone Race", metadata: metadata("association-race-create-0001") },
    { installationGeneration: 1, installationId },
  );

  const results = await Promise.allSettled([
    service.confirmAssociation(
      {
        associationSessionId: session.associationSessionId,
        expectedInstallationId: installationId,
        metadata: metadata("association-race-A-0001"),
      },
      { providerId: providerA },
    ),
    service.confirmAssociation(
      {
        associationSessionId: session.associationSessionId,
        expectedInstallationId: installationId,
        metadata: metadata("association-race-B-0001"),
      },
      { providerId: providerB },
    ),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejection = results.find((result) => result.status === "rejected");
  assert.ok(rejection && rejection.status === "rejected");
  assert.ok(rejection.reason instanceof ProductTransactionError);
  assert.equal(rejection.reason.code, "ASSOCIATION_SESSION_CONSUMED");
});
