import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";

import { contractVersion } from "@socialgrowth/product-contracts";
import { Pool } from "pg";

import { IdentityTransactionService } from "./identity-transactions.js";
import {
  ProviderAuthService,
  type SmsDeliveryPort,
} from "./provider-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";

const databaseUrl = process.env.SG_PRODUCT_TEST_DATABASE_URL;
if (!databaseUrl || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1") {
  throw new Error(
    "PostgreSQL integration test requires SG_PRODUCT_TEST_DATABASE_URL and SG_PRODUCT_TEST_ALLOW_RESET=1",
  );
}

const pool = new Pool({ connectionString: databaseUrl, max: 8 });
const migrationUrls = [
  new URL("../migrations/0001_identity_and_device.sql", import.meta.url),
  new URL("../migrations/0002_provider_phone_auth.sql", import.meta.url),
];
const pepper = "test-provider-auth-pepper-00000000000000000001";

interface Delivery {
  challengeId: string;
  code: string;
  phoneE164: string;
  purpose: "provider_registration" | "provider_login";
}

class RecordingSmsPort implements SmsDeliveryPort {
  readonly deliveries: Delivery[] = [];

  async sendVerificationCode(input: Delivery): Promise<void> {
    const committed = await pool.query<{ delivery_state: string }>(
      `SELECT delivery_state
         FROM socialgrowth_product.phone_verification_challenges
        WHERE challenge_id = $1`,
      [input.challengeId],
    );
    assert.equal(committed.rows[0]?.delivery_state, "pending");
    this.deliveries.push(input);
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function metadata(key: string) {
  return {
    contractVersion,
    idempotencyKey: key,
    requestId: `request-${randomUUID()}`,
  };
}

async function waitForBlockedQuery(fragment: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND state = 'active'
          AND wait_event_type = 'Lock'
          AND query LIKE $1`,
      [`%${fragment}%`],
    );
    if (result.rows[0]?.count !== "0") return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for blocked PostgreSQL query: ${fragment}`);
}

async function seedInvitation(code: string): Promise<void> {
  const operatorId = randomUUID();
  await pool.query(
    `INSERT INTO socialgrowth_product.operators (
       operator_id, login_name, display_name, password_hash, status
     ) VALUES ($1, $2, 'Provider Auth Operator', 'not-a-password', 'active')`,
    [operatorId, `operator-${operatorId}`],
  );
  await pool.query(
    `INSERT INTO socialgrowth_product.provider_invitations (
       invitation_id, code_digest, created_by_operator_id, max_uses, expires_at
     ) VALUES ($1, $2, $3, 2, transaction_timestamp() + interval '1 day')`,
    [randomUUID(), digest(code), operatorId],
  );
}

before(async () => {
  await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE");
  for (const migrationUrl of migrationUrls) {
    await pool.query(await readFile(migrationUrl, "utf8"));
  }
});

after(async () => {
  try {
    await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE");
  } finally {
    await pool.end();
  }
});

test("registration challenge is committed before SMS and replays without sending twice", async () => {
  const invitationCode = `invite-${randomUUID()}`;
  await seedInvitation(invitationCode);
  const sms = new RecordingSmsPort();
  const service = new ProviderAuthService(pool, pepper, sms);
  const request = {
    metadata: metadata("registration-challenge-replay-0001"),
    purpose: "provider_registration" as const,
    phoneE164: "+8613800000101",
    invitationCode,
  };

  const first = await service.requestVerification(request);
  const replay = await service.requestVerification({
    ...request,
    metadata: { ...request.metadata, requestId: `request-${randomUUID()}` },
  });

  assert.deepEqual(replay, first);
  assert.equal(first.deliveryState, "accepted");
  assert.match(first.phoneHint, /\*/);
  assert.equal(sms.deliveries.length, 1);
  assert.equal(sms.deliveries[0]?.code.length, 6);
  const stored = await pool.query<{ code_digest: Buffer; delivery_state: string }>(
    `SELECT code_digest, delivery_state
       FROM socialgrowth_product.phone_verification_challenges
      WHERE challenge_id = $1`,
    [first.challengeId],
  );
  assert.equal(stored.rows[0]?.delivery_state, "accepted");
  assert.equal(stored.rows[0]?.code_digest.includes(Buffer.from(sms.deliveries[0]!.code)), false);

  await assert.rejects(
    service.requestVerification({
      ...request,
      metadata: metadata("registration-challenge-too-soon-0001"),
    }),
    (error: unknown) =>
      error instanceof ProductTransactionError &&
      error.code === "PHONE_VERIFICATION_RATE_LIMITED",
  );
});

test("wrong code persists attempts while correct code creates a purpose-bound proof", async () => {
  const invitationCode = `invite-${randomUUID()}`;
  await seedInvitation(invitationCode);
  const sms = new RecordingSmsPort();
  const service = new ProviderAuthService(pool, pepper, sms);
  const challenge = await service.requestVerification({
    metadata: metadata("registration-verify-0001"),
    purpose: "provider_registration",
    phoneE164: "+8613800000102",
    invitationCode,
  });
  await assert.rejects(
    service.verifyCode({
      metadata: metadata("registration-wrong-code-0001"),
      challengeId: challenge.challengeId,
      code: "000000",
    }),
    (error: unknown) =>
      error instanceof ProductTransactionError &&
      error.code === "PHONE_VERIFICATION_CODE_INVALID",
  );
  const attempts = await pool.query<{ attempt_count: number }>(
    `SELECT attempt_count FROM socialgrowth_product.phone_verification_challenges
      WHERE challenge_id = $1`,
    [challenge.challengeId],
  );
  assert.equal(attempts.rows[0]?.attempt_count, 1);

  const proof = await service.verifyCode({
    metadata: metadata("registration-correct-code-0001"),
    challengeId: challenge.challengeId,
    code: sms.deliveries.at(-1)!.code,
  });
  assert.equal(proof.purpose, "provider_registration");
  assert.match(proof.phoneHint, /\*/);
});

test("concurrent challenge requests for one phone send exactly one SMS", async () => {
  const invitationCode = `invite-${randomUUID()}`;
  await seedInvitation(invitationCode);
  const sms = new RecordingSmsPort();
  const service = new ProviderAuthService(pool, pepper, sms);
  const outcomes = await Promise.allSettled([
    service.requestVerification({
      metadata: metadata("concurrent-challenge-a-0001"),
      purpose: "provider_registration",
      phoneE164: "+8613800000105",
      invitationCode,
    }),
    service.requestVerification({
      metadata: metadata("concurrent-challenge-b-0001"),
      purpose: "provider_registration",
      phoneE164: "+8613800000105",
      invitationCode,
    }),
  ]);
  assert.equal(outcomes.filter(({ status }) => status === "fulfilled").length, 1);
  const rejected = outcomes.find(({ status }) => status === "rejected");
  assert.ok(rejected?.status === "rejected");
  assert.ok(rejected.reason instanceof ProductTransactionError);
  assert.equal(rejected.reason.code, "PHONE_VERIFICATION_RATE_LIMITED");
  assert.equal(sms.deliveries.filter(({ phoneE164 }) => phoneE164 === "+8613800000105").length, 1);
});

test("registered provider verifies login, receives a stored-digest session, and cannot replay proof", async () => {
  const invitationCode = `invite-${randomUUID()}`;
  const phone = "+8613800000103";
  await seedInvitation(invitationCode);
  const sms = new RecordingSmsPort();
  const auth = new ProviderAuthService(pool, pepper, sms);
  const registrationChallenge = await auth.requestVerification({
    metadata: metadata("register-before-login-challenge-0001"),
    purpose: "provider_registration",
    phoneE164: phone,
    invitationCode,
  });
  const registrationProof = await auth.verifyCode({
    metadata: metadata("register-before-login-verify-0001"),
    challengeId: registrationChallenge.challengeId,
    code: sms.deliveries.at(-1)!.code,
  });
  await new IdentityTransactionService(pool).registerProvider(
    {
      metadata: metadata("register-before-login-0001"),
      invitationCode,
      phoneVerificationId: registrationProof.phoneVerificationId,
    },
    { verifiedPhoneVerificationId: registrationProof.phoneVerificationId },
  );

  const loginChallenge = await auth.requestVerification({
    metadata: metadata("provider-login-challenge-0001"),
    purpose: "provider_login",
    phoneE164: phone,
  });
  const loginProof = await auth.verifyCode({
    metadata: metadata("provider-login-verify-0001"),
    challengeId: loginChallenge.challengeId,
    code: sms.deliveries.at(-1)!.code,
  });
  const providerId = await pool.query<{ provider_id: string }>(
    "SELECT provider_id FROM socialgrowth_product.providers WHERE phone_e164 = $1",
    [phone],
  );
  await pool.query(
    "UPDATE socialgrowth_product.providers SET phone_e164 = '+8613800000999' WHERE provider_id = $1",
    [providerId.rows[0]!.provider_id],
  );
  await assert.rejects(
    auth.login({
      metadata: metadata("provider-login-old-phone-0001"),
      phoneVerificationId: loginProof.phoneVerificationId,
    }),
    (error: unknown) =>
      error instanceof ProductTransactionError &&
      error.code === "PHONE_VERIFICATION_INVALID",
  );
  await pool.query(
    "UPDATE socialgrowth_product.providers SET phone_e164 = $2 WHERE provider_id = $1",
    [providerId.rows[0]!.provider_id, phone],
  );
  const response = await auth.login({
    metadata: metadata("provider-login-0001"),
    phoneVerificationId: loginProof.phoneVerificationId,
  });
  assert.equal(response.provider.displayName, "设备提供者");
  assert.equal("phoneE164" in response.provider, false);
  assert.equal(response.sessionToken.length, 43);
  const session = await pool.query<{ token_digest: Buffer }>(
    `SELECT token_digest FROM socialgrowth_product.provider_sessions
      WHERE session_id = $1`,
    [response.session.sessionId],
  );
  assert.equal(session.rows[0]?.token_digest.includes(Buffer.from(response.sessionToken)), false);
  await assert.rejects(
    auth.login({
      metadata: metadata("provider-login-replay-0001"),
      phoneVerificationId: loginProof.phoneVerificationId,
    }),
    (error: unknown) =>
      error instanceof ProductTransactionError &&
      error.code === "PHONE_VERIFICATION_INVALID",
  );
});

test("SMS provider failure is truthful and leaves no accepted challenge", async () => {
  const invitationCode = `invite-${randomUUID()}`;
  await seedInvitation(invitationCode);
  const service = new ProviderAuthService(pool, pepper, {
    async sendVerificationCode() {
      throw new Error("provider unavailable");
    },
  });
  await assert.rejects(
    service.requestVerification({
      metadata: metadata("sms-failure-0001"),
      purpose: "provider_registration",
      phoneE164: "+8613800000104",
      invitationCode,
    }),
    (error: unknown) =>
      error instanceof ProductTransactionError &&
      error.code === "SMS_DELIVERY_UNAVAILABLE" &&
      error.retryable,
  );
  const state = await pool.query<{ delivery_state: string }>(
    `SELECT delivery_state FROM socialgrowth_product.phone_verification_challenges
      WHERE phone_e164 = '+8613800000104'`,
  );
  assert.equal(state.rows[0]?.delivery_state, "failed");
  await assert.rejects(
    service.requestVerification({
      metadata: metadata("sms-failure-new-key-0001"),
      purpose: "provider_registration",
      phoneE164: "+8613800000104",
      invitationCode,
    }),
    (error: unknown) =>
      error instanceof ProductTransactionError &&
      error.code === "PHONE_VERIFICATION_RATE_LIMITED",
  );
});

test("challenge expiry is rechecked after waiting for its row lock", async () => {
  const invitationCode = `invite-${randomUUID()}`;
  await seedInvitation(invitationCode);
  const sms = new RecordingSmsPort();
  const service = new ProviderAuthService(pool, pepper, sms);
  const challenge = await service.requestVerification({
    metadata: metadata("challenge-lock-expiry-0001"),
    purpose: "provider_registration",
    phoneE164: "+8613800000106",
    invitationCode,
  });
  await pool.query(
    `UPDATE socialgrowth_product.phone_verification_challenges
        SET expires_at = clock_timestamp() + interval '500 milliseconds',
            resend_available_at = LEAST(resend_available_at, clock_timestamp() + interval '400 milliseconds')
      WHERE challenge_id = $1`,
    [challenge.challengeId],
  );
  const blocker = await pool.connect();
  try {
    await blocker.query("BEGIN");
    await blocker.query(
      "SELECT challenge_id FROM socialgrowth_product.phone_verification_challenges WHERE challenge_id = $1 FOR UPDATE",
      [challenge.challengeId],
    );
    const verification = service.verifyCode({
      metadata: metadata("challenge-lock-expiry-verify-0001"),
      challengeId: challenge.challengeId,
      code: sms.deliveries.at(-1)!.code,
    });
    await waitForBlockedQuery("WHERE challenge_id = $1 FOR UPDATE");
    await new Promise((resolve) => setTimeout(resolve, 650));
    await blocker.query("COMMIT");
    await assert.rejects(
      verification,
      (error: unknown) =>
        error instanceof ProductTransactionError &&
        error.code === "PHONE_VERIFICATION_EXPIRED",
    );
  } finally {
    try { await blocker.query("ROLLBACK"); } catch { /* transaction already closed */ }
    blocker.release();
  }
});

test("login proof expiry is rechecked after waiting for provider locks", async () => {
  const providerId = randomUUID();
  const verificationId = randomUUID();
  const phone = "+8613800000107";
  await pool.query(
    `INSERT INTO socialgrowth_product.providers (
       provider_id, phone_e164, display_name, status
     ) VALUES ($1, $2, 'Lock Wait Provider', 'active')`,
    [providerId, phone],
  );
  await pool.query(
    `INSERT INTO socialgrowth_product.phone_verifications (
       verification_id, phone_e164, purpose, provider_id, verified_at, expires_at
     ) VALUES ($1, $2, 'provider_login', $3, transaction_timestamp(),
       clock_timestamp() + interval '500 milliseconds')`,
    [verificationId, phone, providerId],
  );
  const blocker = await pool.connect();
  try {
    await blocker.query("BEGIN");
    await blocker.query(
      "SELECT verification_id FROM socialgrowth_product.phone_verifications WHERE verification_id = $1 FOR UPDATE",
      [verificationId],
    );
    const login = new ProviderAuthService(pool, pepper, new RecordingSmsPort()).login({
      metadata: metadata("login-lock-expiry-0001"),
      phoneVerificationId: verificationId,
    });
    await waitForBlockedQuery("WHERE verification_id = $1 FOR UPDATE");
    await new Promise((resolve) => setTimeout(resolve, 650));
    await blocker.query("COMMIT");
    await assert.rejects(
      login,
      (error: unknown) =>
        error instanceof ProductTransactionError &&
        error.code === "PHONE_VERIFICATION_INVALID",
    );
  } finally {
    try { await blocker.query("ROLLBACK"); } catch { /* transaction already closed */ }
    blocker.release();
  }
});
