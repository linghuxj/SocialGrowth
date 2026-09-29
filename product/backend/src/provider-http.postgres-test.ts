import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";

import { Module } from "@nestjs/common";
import { NestFactory, type NestApplication } from "@nestjs/core";
import {
  contractVersion,
  phoneVerificationChallengeResponseSchema,
  phoneVerificationResponseSchema,
  productErrorResponseSchema,
  providerAuthResponseSchema,
  registerProviderResponseSchema,
} from "@socialgrowth/product-contracts";
import { Pool } from "pg";

import { IdentityTransactionService } from "./identity-transactions.js";
import {
  ProviderAuthService,
  type SmsDeliveryPort,
} from "./provider-auth-service.js";
import { ProductExceptionFilter } from "./product-exception.filter.js";
import { ProviderController } from "./provider.controller.js";

const databaseUrl = process.env.SG_PRODUCT_TEST_DATABASE_URL;
if (!databaseUrl || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1") {
  throw new Error(
    "Provider HTTP integration test requires SG_PRODUCT_TEST_DATABASE_URL and SG_PRODUCT_TEST_ALLOW_RESET=1",
  );
}

const pool = new Pool({ connectionString: databaseUrl, max: 8 });
const pepper = "test-provider-http-pepper-00000000000000000001";
const migrationUrls = [
  new URL("../migrations/0001_identity_and_device.sql", import.meta.url),
  new URL("../migrations/0002_provider_phone_auth.sql", import.meta.url),
  new URL("../migrations/0003_provider_auth_recovery.sql", import.meta.url),
];

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

const sms = new RecordingSmsPort();
const auth = new ProviderAuthService(pool, pepper, sms);
const identity = new IdentityTransactionService(pool);

class ProviderHttpTestModule {}
Module({
  controllers: [ProviderController],
  providers: [
    { provide: ProviderAuthService, useValue: auth },
    { provide: IdentityTransactionService, useValue: identity },
  ],
})(ProviderHttpTestModule);

let app: NestApplication;
let baseUrl = "";

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

async function seedInvitation(code: string): Promise<void> {
  const operatorId = randomUUID();
  await pool.query(
    `INSERT INTO socialgrowth_product.operators (
       operator_id, login_name, display_name, password_hash, status
     ) VALUES ($1, $2, 'Provider HTTP Operator', 'not-a-password', 'active')`,
    [operatorId, `operator-${operatorId}`],
  );
  await pool.query(
    `INSERT INTO socialgrowth_product.provider_invitations (
       invitation_id, code_digest, created_by_operator_id, max_uses, expires_at
     ) VALUES ($1, $2, $3, 2, transaction_timestamp() + interval '1 day')`,
    [randomUUID(), digest(code), operatorId],
  );
}

async function post(path: string, body: unknown): Promise<{
  body: unknown;
  response: Response;
}> {
  const response = await fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
  return { body: await response.json(), response };
}

before(async () => {
  await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE");
  for (const migrationUrl of migrationUrls) {
    await pool.query(await readFile(migrationUrl, "utf8"));
  }
  app = await NestFactory.create(ProviderHttpTestModule, { logger: false });
  app.useGlobalFilters(new ProductExceptionFilter());
  await app.listen(0, "127.0.0.1");
  baseUrl = await app.getUrl();
});

after(async () => {
  try {
    await app.close();
    await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE");
  } finally {
    await pool.end();
  }
});

test("real provider HTTP recovers registration and login results without duplicating facts", async () => {
  const invitationCode = `invite-${randomUUID()}`;
  const phoneE164 = "+8613800000301";
  await seedInvitation(invitationCode);

  const registrationRequest = {
    metadata: metadata("http-registration-challenge-0001"),
    purpose: "provider_registration" as const,
    phoneE164,
    invitationCode,
  };
  const firstChallengeResult = await post(
    "/api/provider/phone-verifications",
    registrationRequest,
  );
  assert.equal(firstChallengeResult.response.status, 201);
  const firstChallenge = phoneVerificationChallengeResponseSchema.parse(
    firstChallengeResult.body,
  );
  assert.equal(sms.deliveries.length, 1);

  const recoveredChallengeResult = await post(
    "/api/provider/phone-verifications",
    {
      ...registrationRequest,
      metadata: {
        ...registrationRequest.metadata,
        requestId: `request-${randomUUID()}`,
      },
    },
  );
  assert.equal(recoveredChallengeResult.response.status, 201);
  assert.deepEqual(
    phoneVerificationChallengeResponseSchema.parse(recoveredChallengeResult.body),
    firstChallenge,
  );
  assert.equal(sms.deliveries.length, 1);

  const registrationDelivery = sms.deliveries[0]!;
  const wrongCodeResult = await post("/api/provider/phone-verifications/verify", {
    metadata: metadata("http-registration-wrong-code-0001"),
    challengeId: firstChallenge.challengeId,
    code: registrationDelivery.code === "000000" ? "111111" : "000000",
  });
  assert.equal(wrongCodeResult.response.status, 400);
  assert.equal(
    productErrorResponseSchema.parse(wrongCodeResult.body).error.code,
    "PHONE_VERIFICATION_CODE_INVALID",
  );

  const registrationProofResult = await post(
    "/api/provider/phone-verifications/verify",
    {
      metadata: metadata("http-registration-verify-0001"),
      challengeId: firstChallenge.challengeId,
      code: registrationDelivery.code,
    },
  );
  assert.equal(registrationProofResult.response.status, 201);
  const registrationProof = phoneVerificationResponseSchema.parse(
    registrationProofResult.body,
  );

  const registrationMetadata = metadata("http-register-provider-0001");
  const registrationResult = await post("/api/provider/register", {
    metadata: registrationMetadata,
    invitationCode,
    phoneVerificationId: registrationProof.phoneVerificationId,
  });
  assert.equal(registrationResult.response.status, 201);
  const registration = registerProviderResponseSchema.parse(registrationResult.body);
  const recoveredRegistrationResult = await post("/api/provider/register", {
    metadata: { ...registrationMetadata, requestId: `request-${randomUUID()}` },
    invitationCode,
    phoneVerificationId: registrationProof.phoneVerificationId,
  });
  assert.equal(recoveredRegistrationResult.response.status, 201);
  assert.deepEqual(
    registerProviderResponseSchema.parse(recoveredRegistrationResult.body),
    registration,
  );

  const loginChallengeResult = await post("/api/provider/phone-verifications", {
    metadata: metadata("http-login-challenge-0001"),
    purpose: "provider_login",
    phoneE164,
  });
  assert.equal(loginChallengeResult.response.status, 201);
  const loginChallenge = phoneVerificationChallengeResponseSchema.parse(
    loginChallengeResult.body,
  );
  const loginDelivery = sms.deliveries.at(-1)!;
  assert.equal(loginDelivery.purpose, "provider_login");

  const loginProofResult = await post("/api/provider/phone-verifications/verify", {
    metadata: metadata("http-login-verify-0001"),
    challengeId: loginChallenge.challengeId,
    code: loginDelivery.code,
  });
  assert.equal(loginProofResult.response.status, 201);
  const loginProof = phoneVerificationResponseSchema.parse(loginProofResult.body);

  const loginResult = await post("/api/provider/login", {
    metadata: metadata("http-login-provider-0001"),
    phoneVerificationId: loginProof.phoneVerificationId,
  });
  assert.equal(loginResult.response.status, 201);
  const login = providerAuthResponseSchema.parse(loginResult.body);
  assert.equal(login.provider.providerId, registration.providerId);
  assert.equal("phoneE164" in login.provider, false);

  const recoveredLoginResult = await post("/api/provider/login", {
    metadata: metadata("http-login-provider-replay-0001"),
    phoneVerificationId: loginProof.phoneVerificationId,
  });
  assert.equal(recoveredLoginResult.response.status, 201);
  assert.deepEqual(providerAuthResponseSchema.parse(recoveredLoginResult.body), login);

  const facts = await pool.query<{
    invitation_consumptions: string;
    provider_sessions: string;
    providers: string;
  }>(
    `SELECT
       (SELECT count(*)::text FROM socialgrowth_product.providers
         WHERE phone_e164 = $1) AS providers,
       (SELECT count(*)::text FROM socialgrowth_product.provider_invitation_consumptions
         WHERE provider_id = $2) AS invitation_consumptions,
       (SELECT count(*)::text FROM socialgrowth_product.provider_sessions
         WHERE provider_id = $2) AS provider_sessions`,
    [phoneE164, registration.providerId],
  );
  assert.deepEqual(facts.rows[0], {
    invitation_consumptions: "1",
    provider_sessions: "1",
    providers: "1",
  });
});
