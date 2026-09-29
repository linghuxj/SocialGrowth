import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";

import { NestFactory, type NestApplication } from "@nestjs/core";
import {
  contractVersion,
  phoneVerificationChallengeResponseSchema,
  phoneVerificationResponseSchema,
  productErrorResponseSchema,
  providerAuthResponseSchema,
  providerLogoutResponseSchema,
  providerRegistrationAuthResponseSchema,
} from "@socialgrowth/product-contracts";
import { Pool } from "pg";

import { AppModule } from "./app.module.js";
import { ProductExceptionFilter } from "./product-exception.filter.js";

const databaseUrl = process.env.SG_PRODUCT_TEST_DATABASE_URL;
if (!databaseUrl || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1") {
  throw new Error(
    "Provider HTTP integration test requires SG_PRODUCT_TEST_DATABASE_URL and SG_PRODUCT_TEST_ALLOW_RESET=1",
  );
}

const pool = new Pool({ connectionString: databaseUrl, max: 8 });
const pepper = "test-provider-http-pepper-00000000000000000001";
const developmentSmsToken = "test-development-sms-token-000000000000000001";
const migrationUrls = [
  new URL("../migrations/0001_identity_and_device.sql", import.meta.url),
  new URL("../migrations/0002_provider_phone_auth.sql", import.meta.url),
  new URL("../migrations/0003_provider_auth_recovery.sql", import.meta.url),
];

let app: NestApplication;
let baseUrl = "";
const configuredEnvironment = [
  "SG_PRODUCT_AUTH_PEPPER",
  "SG_PRODUCT_BACKEND_HOST",
  "SG_PRODUCT_DATABASE_URL",
  "SG_PRODUCT_DEVELOPMENT_SMS_TOKEN",
  "SG_PRODUCT_SMS_MODE",
] as const;
const previousEnvironment = Object.fromEntries(
  configuredEnvironment.map((name) => [name, process.env[name]]),
) as Record<(typeof configuredEnvironment)[number], string | undefined>;

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

async function post(
  path: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<{
  body: unknown;
  response: Response;
}> {
  const response = await fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...extraHeaders },
    method: "POST",
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
  return { body: await response.json(), response };
}

async function readDevelopmentCode(challengeId: string): Promise<string> {
  const result = await post(
    "/internal/development/provider-sms-codes/read",
    { challengeId, requestId: `request-${randomUUID()}` },
    { "x-development-sms-token": developmentSmsToken },
  );
  assert.equal(result.response.status, 200);
  assert.deepEqual(Object.keys(result.body as object).sort(), ["challengeId", "code"]);
  const response = result.body as { challengeId: unknown; code: unknown };
  assert.equal(response.challengeId, challengeId);
  assert.match(String(response.code), /^[0-9]{6}$/);
  return String(response.code);
}

before(async () => {
  await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE");
  for (const migrationUrl of migrationUrls) {
    await pool.query(await readFile(migrationUrl, "utf8"));
  }
  process.env.SG_PRODUCT_AUTH_PEPPER = pepper;
  process.env.SG_PRODUCT_BACKEND_HOST = "127.0.0.1";
  process.env.SG_PRODUCT_DATABASE_URL = databaseUrl;
  process.env.SG_PRODUCT_DEVELOPMENT_SMS_TOKEN = developmentSmsToken;
  process.env.SG_PRODUCT_SMS_MODE = "development_capture";
  app = await NestFactory.create(AppModule, { logger: false });
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
    for (const name of configuredEnvironment) {
      const previous = previousEnvironment[name];
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
  }
});

test("real provider HTTP reads protected development codes and avoids duplicate facts", async () => {
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

  const deniedCodeResult = await post(
    "/internal/development/provider-sms-codes/read",
    { challengeId: firstChallenge.challengeId, requestId: `request-${randomUUID()}` },
    { "x-development-sms-token": "wrong-development-token" },
  );
  assert.equal(deniedCodeResult.response.status, 403);
  assert.equal(
    productErrorResponseSchema.parse(deniedCodeResult.body).error.code,
    "AUTHORIZATION_DENIED",
  );

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

  const registrationCode = await readDevelopmentCode(firstChallenge.challengeId);
  const storedSecret = await pool.query<{ code_digest: Buffer; leaked_audits: string }>(
    `SELECT code_digest,
       (SELECT count(*)::text FROM socialgrowth_product.audit_records
         WHERE facts::text LIKE $2) AS leaked_audits
       FROM socialgrowth_product.phone_verification_challenges
      WHERE challenge_id = $1`,
    [firstChallenge.challengeId, `%${registrationCode}%`],
  );
  assert.equal(
    storedSecret.rows[0]?.code_digest.includes(Buffer.from(registrationCode, "utf8")),
    false,
  );
  assert.equal(storedSecret.rows[0]?.leaked_audits, "0");
  const wrongCodeResult = await post("/api/provider/phone-verifications/verify", {
    metadata: metadata("http-registration-wrong-code-0001"),
    challengeId: firstChallenge.challengeId,
    code: registrationCode === "000000" ? "111111" : "000000",
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
      code: registrationCode,
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
  const registrationAuth = providerRegistrationAuthResponseSchema.parse(registrationResult.body);
  const registration = registrationAuth.registration;
  assert.equal(registrationAuth.provider.providerId, registration.providerId);
  const recoveredRegistrationResult = await post("/api/provider/register", {
    metadata: { ...registrationMetadata, requestId: `request-${randomUUID()}` },
    invitationCode,
    phoneVerificationId: registrationProof.phoneVerificationId,
  });
  assert.equal(recoveredRegistrationResult.response.status, 201);
  assert.deepEqual(
    providerRegistrationAuthResponseSchema.parse(recoveredRegistrationResult.body),
    registrationAuth,
  );

  const logoutResult = await post(
    "/api/provider/logout",
    { metadata: metadata("http-register-provider-logout-0001") },
    { authorization: `Bearer ${registrationAuth.sessionToken}` },
  );
  assert.equal(logoutResult.response.status, 201);
  providerLogoutResponseSchema.parse(logoutResult.body);

  const loginChallengeResult = await post("/api/provider/phone-verifications", {
    metadata: metadata("http-login-challenge-0001"),
    purpose: "provider_login",
    phoneE164,
  });
  assert.equal(loginChallengeResult.response.status, 201);
  const loginChallenge = phoneVerificationChallengeResponseSchema.parse(
    loginChallengeResult.body,
  );
  const loginCode = await readDevelopmentCode(loginChallenge.challengeId);

  const loginProofResult = await post("/api/provider/phone-verifications/verify", {
    metadata: metadata("http-login-verify-0001"),
    challengeId: loginChallenge.challengeId,
    code: loginCode,
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
    challenges: string;
    invitation_consumptions: string;
    provider_sessions: string;
    providers: string;
    registration_logout_audits: string;
  }>(
    `SELECT
       (SELECT count(*)::text FROM socialgrowth_product.providers
         WHERE phone_e164 = $1) AS providers,
       (SELECT count(*)::text FROM socialgrowth_product.provider_invitation_consumptions
         WHERE provider_id = $2) AS invitation_consumptions,
       (SELECT count(*)::text FROM socialgrowth_product.provider_sessions
         WHERE provider_id = $2) AS provider_sessions,
       (SELECT count(*)::text FROM socialgrowth_product.phone_verification_challenges
         WHERE phone_e164 = $1) AS challenges,
       (SELECT count(*)::text FROM socialgrowth_product.audit_records
         WHERE action = 'provider.logged_out' AND actor_id = $2
           AND facts = '{}'::jsonb) AS registration_logout_audits`,
    [phoneE164, registration.providerId],
  );
  assert.deepEqual(facts.rows[0], {
    challenges: "2",
    invitation_consumptions: "1",
    provider_sessions: "2",
    providers: "1",
    registration_logout_audits: "1",
  });
});
