import {
  createHash,
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import {
  phoneVerificationChallengeResponseSchema,
  phoneVerificationResponseSchema,
  providerAuthResponseSchema,
  providerLoginRequestSchema,
  requestPhoneVerificationSchema,
  verifyPhoneCodeRequestSchema,
  type PhoneVerificationChallengeResponse,
  type PhoneVerificationResponse,
  type ProviderAuthResponse,
  type ProviderLoginRequest,
  type RequestPhoneVerification,
  type VerifyPhoneCodeRequest,
} from "@socialgrowth/product-contracts";
import type { Pool, PoolClient } from "pg";

import { ProductTransactionError } from "./product-transaction-error.js";

const schema = "socialgrowth_product";
const challengeLifetimeMilliseconds = 5 * 60 * 1000;
const resendDelayMilliseconds = 60 * 1000;
const rateLimitWindowMilliseconds = 15 * 60 * 1000;
const rateLimitCount = 5;
const proofLifetimeMilliseconds = 10 * 60 * 1000;
const sessionLifetimeMilliseconds = 30 * 24 * 60 * 60 * 1000;

export interface SmsDeliveryPort {
  sendVerificationCode(input: {
    challengeId: string;
    code: string;
    phoneE164: string;
    purpose: "provider_registration" | "provider_login";
  }): Promise<void>;
}

export class UnavailableSmsDeliveryPort implements SmsDeliveryPort {
  async sendVerificationCode(): Promise<never> {
    throw new ProductTransactionError(
      "SMS_DELIVERY_UNAVAILABLE",
      "SMS delivery is not configured",
      true,
    );
  }
}

interface ChallengeRow {
  challenge_id: string;
  code_digest: Buffer;
  delivery_state: "pending" | "accepted" | "failed";
  expires_at: Date;
  idempotency_key: string;
  phone_e164: string;
  provider_id: string | null;
  purpose: "provider_registration" | "provider_login";
  request_digest: Buffer;
  resend_available_at: Date;
  attempt_count: number;
  verified_at: Date | null;
  verification_id: string | null;
}

interface ProviderSessionRow {
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  session_id: string;
  token_digest: Buffer;
}

interface ProviderRow {
  provider_id: string;
  display_name: string;
  phone_e164: string;
  status: "active" | "disabled";
  created_at: Date;
  updated_at: Date;
}

interface VerificationRow {
  consumed_at: Date | null;
  expires_at: Date;
  phone_e164: string;
  provider_id: string | null;
  purpose: string;
  verified_at: Date | null;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function secretDigest(pepper: string, value: string): Buffer {
  return createHmac("sha256", pepper).update(value, "utf8").digest();
}

function providerSessionToken(pepper: string, verificationId: string): string {
  return createHmac("sha256", pepper)
    .update(`provider-session:${verificationId}`, "utf8")
    .digest("base64url");
}

function requestDigest(value: unknown): Buffer {
  const request = value as Record<string, unknown>;
  const metadata = { ...(request.metadata as Record<string, unknown>) };
  delete metadata.requestId;
  return digest(JSON.stringify({ ...request, metadata }));
}

function maskPhone(phoneE164: string): string {
  return `+${"*".repeat(phoneE164.length - 4)}${phoneE164.slice(-3)}`;
}

async function databaseNow(client: PoolClient): Promise<Date> {
  const result = await client.query<{ database_now: Date }>(
    "SELECT clock_timestamp() AS database_now",
  );
  const now = result.rows[0]?.database_now;
  if (!now) throw new Error("PostgreSQL did not return its wall-clock timestamp");
  return now;
}

async function inTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Transaction rollback failed");
    }
    throw error;
  } finally {
    client.release();
  }
}

function challengeResponse(row: ChallengeRow): PhoneVerificationChallengeResponse {
  return phoneVerificationChallengeResponseSchema.parse({
    challengeId: row.challenge_id,
    purpose: row.purpose,
    phoneHint: maskPhone(row.phone_e164),
    deliveryState: "accepted",
    expiresAt: row.expires_at.toISOString(),
    resendAvailableAt: row.resend_available_at.toISOString(),
  });
}

export class ProviderAuthService {
  constructor(
    private readonly pool: Pool,
    private readonly securityPepper: string,
    private readonly smsDelivery: SmsDeliveryPort,
    private readonly codeLength = 6,
  ) {
    if (codeLength < 4 || codeLength > 8) {
      throw new Error("SMS verification code length must be between 4 and 8");
    }
  }

  async requestVerification(
    input: RequestPhoneVerification,
  ): Promise<PhoneVerificationChallengeResponse> {
    const request = requestPhoneVerificationSchema.parse(input);
    const requestHash = requestDigest(request);
    const reservation = await inTransaction(this.pool, async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`${request.purpose}:${request.phoneE164}`],
      );
      const now = await databaseNow(client);
      const existing = await client.query<ChallengeRow>(
        `SELECT * FROM ${schema}.phone_verification_challenges
          WHERE purpose = $1 AND phone_e164 = $2 AND idempotency_key = $3
          FOR UPDATE`,
        [request.purpose, request.phoneE164, request.metadata.idempotencyKey],
      );
      const replay = existing.rows[0];
      if (replay) {
        if (
          replay.request_digest.length !== requestHash.length ||
          !timingSafeEqual(replay.request_digest, requestHash)
        ) {
          throw new ProductTransactionError(
            "IDEMPOTENCY_KEY_REUSED",
            "Idempotency key was already used for another verification request",
          );
        }
        if (replay.delivery_state === "accepted") {
          return { code: null, row: replay };
        }
        throw new ProductTransactionError(
          replay.delivery_state === "pending"
            ? "IDEMPOTENCY_KEY_REUSED"
            : "SMS_DELIVERY_UNAVAILABLE",
          replay.delivery_state === "pending"
            ? "The verification request is still processing"
            : "The original SMS delivery attempt failed",
          true,
        );
      }

      let providerId: string | null = null;
      if (request.purpose === "provider_registration") {
        const invitation = await client.query<{
          consumed_uses: number;
          expires_at: Date;
          max_uses: number;
          revoked_at: Date | null;
        }>(
          `SELECT max_uses, consumed_uses, expires_at, revoked_at
             FROM ${schema}.provider_invitations WHERE code_digest = $1`,
          [digest(request.invitationCode)],
        );
        const row = invitation.rows[0];
        if (!row) throw new ProductTransactionError("INPUT_INVALID", "Invitation was not found");
        if (row.revoked_at) throw new ProductTransactionError("INVITATION_REVOKED", "Invitation was revoked");
        if (row.expires_at <= now) throw new ProductTransactionError("INVITATION_EXPIRED", "Invitation expired");
        if (row.consumed_uses >= row.max_uses) throw new ProductTransactionError("INVITATION_EXHAUSTED", "Invitation is exhausted");
        const registered = await client.query("SELECT 1 FROM socialgrowth_product.providers WHERE phone_e164 = $1", [request.phoneE164]);
        if (registered.rowCount) throw new ProductTransactionError("PHONE_ALREADY_REGISTERED", "Phone number already belongs to a provider");
      } else {
        const provider = await client.query<Pick<ProviderRow, "provider_id" | "status">>(
          `SELECT provider_id, status FROM ${schema}.providers WHERE phone_e164 = $1`,
          [request.phoneE164],
        );
        const row = provider.rows[0];
        if (!row) throw new ProductTransactionError("PHONE_NOT_REGISTERED", "Phone number is not registered");
        if (row.status !== "active") throw new ProductTransactionError("PROVIDER_DISABLED", "Provider is disabled");
        providerId = row.provider_id;
      }

      const recent = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM ${schema}.phone_verification_challenges
          WHERE phone_e164 = $1 AND created_at > $2
          `,
        [request.phoneE164, new Date(now.getTime() - rateLimitWindowMilliseconds)],
      );
      if (Number(recent.rows[0]?.count ?? 0) >= rateLimitCount) {
        throw new ProductTransactionError(
          "PHONE_VERIFICATION_RATE_LIMITED",
          "Too many verification requests",
          true,
        );
      }
      const latest = await client.query<{ resend_available_at: Date }>(
        `SELECT resend_available_at
           FROM ${schema}.phone_verification_challenges
          WHERE phone_e164 = $1 AND purpose = $2
          ORDER BY created_at DESC LIMIT 1`,
        [request.phoneE164, request.purpose],
      );
      if ((latest.rows[0]?.resend_available_at?.getTime() ?? 0) > now.getTime()) {
        throw new ProductTransactionError(
          "PHONE_VERIFICATION_RATE_LIMITED",
          "Verification code cannot be resent yet",
          true,
        );
      }

      const code = Array.from({ length: this.codeLength }, () => randomInt(10)).join("");
      const challengeId = randomUUID();
      const expiresAt = new Date(now.getTime() + challengeLifetimeMilliseconds);
      const resendAvailableAt = new Date(now.getTime() + resendDelayMilliseconds);
      const inserted = await client.query<ChallengeRow>(
        `INSERT INTO ${schema}.phone_verification_challenges (
           challenge_id, phone_e164, purpose, provider_id, code_digest,
           delivery_state, idempotency_key, request_digest, expires_at,
           resend_available_at, created_at
         ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10)
         RETURNING *`,
        [challengeId, request.phoneE164, request.purpose, providerId,
          secretDigest(this.securityPepper, `${challengeId}:${code}`),
          request.metadata.idempotencyKey, requestHash, expiresAt, resendAvailableAt, now],
      );
      return { code, row: inserted.rows[0]! };
    });

    if (reservation.code === null) return challengeResponse(reservation.row);
    try {
      await this.smsDelivery.sendVerificationCode({
        challengeId: reservation.row.challenge_id,
        code: reservation.code,
        phoneE164: reservation.row.phone_e164,
        purpose: reservation.row.purpose,
      });
    } catch (error) {
      await inTransaction(this.pool, async (client) => {
        const failed = await client.query(
          `UPDATE ${schema}.phone_verification_challenges
              SET delivery_state = 'failed'
            WHERE challenge_id = $1 AND delivery_state = 'pending'
            RETURNING challenge_id`,
          [reservation.row.challenge_id],
        );
        if (failed.rowCount) {
          await client.query(
            `INSERT INTO ${schema}.audit_records (
               audit_record_id, actor_type, action, object_type, object_id,
               request_id, facts
             ) VALUES ($1, 'system', 'sms.delivery_failed',
               'phone_verification_challenge', $2, $3,
               jsonb_build_object('purpose', $4::text))`,
            [randomUUID(), reservation.row.challenge_id,
              request.metadata.requestId, reservation.row.purpose],
          );
        }
      });
      if (error instanceof ProductTransactionError) throw error;
      throw new ProductTransactionError(
        "SMS_DELIVERY_UNAVAILABLE",
        "SMS delivery provider rejected the request",
        true,
      );
    }
    const row = await inTransaction(this.pool, async (client) => {
      const accepted = await client.query<ChallengeRow>(
        `UPDATE ${schema}.phone_verification_challenges
            SET delivery_state = 'accepted'
          WHERE challenge_id = $1 AND delivery_state = 'pending'
          RETURNING *`,
        [reservation.row.challenge_id],
      );
      const acceptedRow = accepted.rows[0];
      if (acceptedRow) {
        await client.query(
          `INSERT INTO ${schema}.audit_records (
             audit_record_id, actor_type, action, object_type, object_id,
             request_id, facts
           ) VALUES ($1, 'system', 'sms.delivery_accepted',
             'phone_verification_challenge', $2, $3,
             jsonb_build_object('purpose', $4::text))`,
          [randomUUID(), acceptedRow.challenge_id,
            request.metadata.requestId, acceptedRow.purpose],
        );
      }
      return acceptedRow;
    });
    if (!row) throw new Error("Verification challenge did not transition to accepted");
    return challengeResponse(row);
  }

  async verifyCode(input: VerifyPhoneCodeRequest): Promise<PhoneVerificationResponse> {
    const request = verifyPhoneCodeRequestSchema.parse(input);
    const outcome = await inTransaction(this.pool, async (client) => {
      const result = await client.query<ChallengeRow>(
        `SELECT * FROM ${schema}.phone_verification_challenges
          WHERE challenge_id = $1 FOR UPDATE`,
        [request.challengeId],
      );
      const challenge = result.rows[0];
      if (!challenge || challenge.delivery_state !== "accepted") {
        throw new ProductTransactionError("PHONE_VERIFICATION_INVALID", "Verification challenge is unavailable");
      }
      const now = await databaseNow(client);
      if (challenge.attempt_count >= 5) {
        throw new ProductTransactionError("PHONE_VERIFICATION_RATE_LIMITED", "Verification attempts exhausted");
      }
      if (challenge.verified_at) {
        if (!challenge.verification_id) {
          throw new ProductTransactionError(
            "PHONE_VERIFICATION_INVALID",
            "Legacy verification result cannot be recovered safely",
          );
        }
        const replayDigest = secretDigest(
          this.securityPepper,
          `${challenge.challenge_id}:${request.code}`,
        );
        if (!timingSafeEqual(challenge.code_digest, replayDigest)) {
          await client.query(
            `UPDATE ${schema}.phone_verification_challenges
                SET attempt_count = attempt_count + 1 WHERE challenge_id = $1`,
            [challenge.challenge_id],
          );
          return {
            error: new ProductTransactionError(
              "PHONE_VERIFICATION_CODE_INVALID",
              "Verification code is invalid",
            ),
            response: null,
          };
        }
        const replay = await client.query<{
          expires_at: Date;
          verified_at: Date;
        }>(
          `SELECT verified_at, expires_at FROM ${schema}.phone_verifications
            WHERE verification_id = $1`,
          [challenge.verification_id],
        );
        const proof = replay.rows[0];
        if (!proof) throw new Error("Verified challenge lost its proof");
        if (proof.expires_at <= now) {
          throw new ProductTransactionError(
            "PHONE_VERIFICATION_EXPIRED",
            "Verification proof expired",
          );
        }
        return {
          error: null,
          response: phoneVerificationResponseSchema.parse({
            phoneVerificationId: challenge.verification_id,
            purpose: challenge.purpose,
            phoneHint: maskPhone(challenge.phone_e164),
            verifiedAt: proof.verified_at.toISOString(),
            expiresAt: proof.expires_at.toISOString(),
          }),
        };
      }
      if (challenge.expires_at <= now) {
        throw new ProductTransactionError("PHONE_VERIFICATION_EXPIRED", "Verification challenge expired");
      }
      const actual = secretDigest(this.securityPepper, `${challenge.challenge_id}:${request.code}`);
      if (!timingSafeEqual(challenge.code_digest, actual)) {
        await client.query(
          `UPDATE ${schema}.phone_verification_challenges
              SET attempt_count = attempt_count + 1 WHERE challenge_id = $1`,
          [challenge.challenge_id],
        );
        return {
          error: new ProductTransactionError(
            "PHONE_VERIFICATION_CODE_INVALID",
            "Verification code is invalid",
          ),
          response: null,
        };
      }
      const verificationId = randomUUID();
      const proofExpiresAt = new Date(now.getTime() + proofLifetimeMilliseconds);
      await client.query(
        `INSERT INTO ${schema}.phone_verifications (
           verification_id, phone_e164, purpose, provider_id, verified_at,
           expires_at, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $5)`,
        [verificationId, challenge.phone_e164, challenge.purpose,
          challenge.provider_id, now, proofExpiresAt],
      );
      await client.query(
        `UPDATE ${schema}.phone_verification_challenges
            SET verified_at = $2, verification_id = $3 WHERE challenge_id = $1`,
        [challenge.challenge_id, now, verificationId],
      );
      await client.query(
        `INSERT INTO ${schema}.audit_records (
           audit_record_id, actor_type, action, object_type, object_id,
           request_id, facts
         ) VALUES ($1, 'system', 'phone.verified', 'phone_verification', $2, $3,
           jsonb_build_object('purpose', $4::text))`,
        [randomUUID(), verificationId, request.metadata.requestId, challenge.purpose],
      );
      return {
        error: null,
        response: phoneVerificationResponseSchema.parse({
          phoneVerificationId: verificationId,
          purpose: challenge.purpose,
          phoneHint: maskPhone(challenge.phone_e164),
          verifiedAt: now.toISOString(),
          expiresAt: proofExpiresAt.toISOString(),
        }),
      };
    });
    if (outcome.error) throw outcome.error;
    return outcome.response;
  }

  async login(input: ProviderLoginRequest): Promise<ProviderAuthResponse> {
    const request = providerLoginRequestSchema.parse(input);
    return inTransaction(this.pool, async (client) => {
      const proofResult = await client.query<VerificationRow>(
        `SELECT phone_e164, purpose, provider_id, verified_at, expires_at, consumed_at
           FROM ${schema}.phone_verifications WHERE verification_id = $1 FOR UPDATE`,
        [request.phoneVerificationId],
      );
      const proof = proofResult.rows[0];
      if (!proof || proof.purpose !== "provider_login" || !proof.provider_id ||
          !proof.verified_at) {
        throw new ProductTransactionError("PHONE_VERIFICATION_INVALID", "Login proof is unavailable");
      }
      const providerResult = await client.query<ProviderRow>(
        `SELECT provider_id, display_name, phone_e164, status, created_at, updated_at
           FROM ${schema}.providers WHERE provider_id = $1 FOR UPDATE`,
        [proof.provider_id],
      );
      const provider = providerResult.rows[0];
      if (!provider) throw new ProductTransactionError("PHONE_NOT_REGISTERED", "Provider was not found");
      if (provider.status !== "active") throw new ProductTransactionError("PROVIDER_DISABLED", "Provider is disabled");
      const now = await databaseNow(client);
      if (proof.expires_at <= now || proof.phone_e164 !== provider.phone_e164) {
        throw new ProductTransactionError(
          "PHONE_VERIFICATION_INVALID",
          "Login proof expired or no longer matches the provider phone",
        );
      }
      const token = providerSessionToken(this.securityPepper, request.phoneVerificationId);
      if (proof.consumed_at) {
        const replay = await client.query<ProviderSessionRow>(
          `SELECT session_id, token_digest, created_at, expires_at, revoked_at
             FROM ${schema}.provider_sessions
            WHERE phone_verification_id = $1`,
          [request.phoneVerificationId],
        );
        const session = replay.rows[0];
        if (!session || session.revoked_at || session.expires_at <= now) {
          throw new ProductTransactionError("PHONE_VERIFICATION_INVALID", "Login proof was already consumed");
        }
        const replayDigest = secretDigest(this.securityPepper, token);
        if (
          session.token_digest.length !== replayDigest.length ||
          !timingSafeEqual(session.token_digest, replayDigest)
        ) {
          throw new ProductTransactionError(
            "PHONE_VERIFICATION_INVALID",
            "Login session cannot be recovered with the active key",
          );
        }
        return providerAuthResponseSchema.parse({
          provider: {
            providerId: provider.provider_id,
            displayName: provider.display_name,
            phoneHint: maskPhone(provider.phone_e164),
            status: provider.status,
            createdAt: provider.created_at.toISOString(),
            updatedAt: provider.updated_at.toISOString(),
          },
          session: {
            sessionId: session.session_id,
            createdAt: session.created_at.toISOString(),
            expiresAt: session.expires_at.toISOString(),
          },
          sessionToken: token,
        });
      }
      const sessionId = randomUUID();
      const expiresAt = new Date(now.getTime() + sessionLifetimeMilliseconds);
      await client.query(
        `INSERT INTO ${schema}.provider_sessions (
           session_id, provider_id, token_digest, expires_at, created_at,
           phone_verification_id
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [sessionId, provider.provider_id, secretDigest(this.securityPepper, token),
          expiresAt, now, request.phoneVerificationId],
      );
      await client.query(
        `UPDATE ${schema}.phone_verifications SET consumed_at = $2 WHERE verification_id = $1`,
        [request.phoneVerificationId, now],
      );
      await client.query(
        `INSERT INTO ${schema}.audit_records (
           audit_record_id, actor_type, actor_id, action, object_type,
           object_id, request_id, facts
         ) VALUES ($1, 'provider', $2, 'provider.logged_in', 'provider_session',
           $3, $4, '{}'::jsonb)`,
        [randomUUID(), provider.provider_id, sessionId, request.metadata.requestId],
      );
      return providerAuthResponseSchema.parse({
        provider: {
          providerId: provider.provider_id,
          displayName: provider.display_name,
          phoneHint: maskPhone(provider.phone_e164),
          status: provider.status,
          createdAt: provider.created_at.toISOString(),
          updatedAt: provider.updated_at.toISOString(),
        },
        session: { sessionId, createdAt: now.toISOString(), expiresAt: expiresAt.toISOString() },
        sessionToken: token,
      });
    });
  }
}
