import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  confirmAssociationRequestSchema,
  confirmAssociationResponseSchema,
  associationSessionViewSchema,
  createAssociationSessionRequestSchema,
  createAssociationSessionResponseSchema,
  inspectAssociationCodeRequestSchema,
  registerProviderRequestSchema,
  registerProviderResponseSchema,
  type ConfirmAssociationRequest,
  type RegisterProviderRequest,
} from "@socialgrowth/product-contracts";
import type { Pool, PoolClient, QueryResult } from "pg";

import { ProductTransactionError } from "./product-transaction-error.js";

const schema = "socialgrowth_product";
const responseRetentionMilliseconds = 24 * 60 * 60 * 1000;

type PrincipalType = "installation" | "provider" | "registration";

interface IdempotencyRow {
  request_digest: Buffer;
  response_available_until: Date;
  response_body: unknown;
  status: "failed" | "processing" | "succeeded";
}

interface VerificationRow {
  consumed_at: Date | null;
  expires_at: Date;
  phone_e164: string;
  purpose: string;
  verified_at: Date | null;
}

interface InvitationRow {
  consumed_uses: number;
  expires_at: Date;
  invitation_id: string;
  max_uses: number;
  revoked_at: Date | null;
}

interface AssociationSessionRow {
  association_session_id: string;
  consumed_at: Date | null;
  device_label: string;
  expected_installation_generation: string;
  expires_at: Date;
  installation_id: string;
  invalidated_at: Date | null;
}

interface CurrentAssociationRow {
  association_id: string;
  device_id: string;
  provider_id: string;
}

interface IdempotencyIdentity {
  operation: string;
  principalId: string;
  principalType: PrincipalType;
}

interface RegistrationContext {
  verifiedPhoneVerificationId: string;
}

interface ProviderContext {
  providerId: string;
}

interface InstallationContext {
  installationGeneration: bigint;
  installationId: string;
}

interface DatabaseTimeRow {
  database_now: Date;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function requestDigest(value: unknown): Buffer {
  if (
    typeof value === "object" &&
    value !== null &&
    "metadata" in value &&
    typeof value.metadata === "object" &&
    value.metadata !== null
  ) {
    const stableMetadata = {
      ...(value.metadata as Record<string, unknown>),
    };
    delete stableMetadata.requestId;
    return digest(
      JSON.stringify({
        ...(value as Record<string, unknown>),
        metadata: stableMetadata,
      }),
    );
  }
  return digest(JSON.stringify(value));
}

async function databaseNow(client: PoolClient): Promise<Date> {
  const result = await client.query<DatabaseTimeRow>(
    "SELECT transaction_timestamp() AS database_now",
  );
  const now = result.rows[0]?.database_now;
  if (!now) throw new Error("PostgreSQL did not return its transaction timestamp");
  return now;
}

async function writeAudit(
  client: PoolClient,
  actorType: "installation" | "provider" | "system",
  actorId: string | null,
  action: string,
  objectType: string,
  objectId: string,
  requestId: string,
  facts: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO ${schema}.audit_records (
       audit_record_id, actor_type, actor_id, action, object_type,
       object_id, request_id, facts
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [randomUUID(), actorType, actorId, action, objectType, objectId, requestId, facts],
  );
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === constraint
  );
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

async function beginIdempotentRequest(
  client: PoolClient,
  identity: IdempotencyIdentity,
  idempotencyKey: string,
  payloadDigest: Buffer,
  now: Date,
): Promise<IdempotencyRow | null> {
  const inserted = await client.query(
    `INSERT INTO ${schema}.idempotency_requests (
       idempotency_request_id, operation, principal_type, principal_id,
       idempotency_key, request_digest, status, created_at,
       response_available_until
     ) VALUES ($1, $2, $3, $4, $5, $6, 'processing', $7, $8)
     ON CONFLICT (operation, principal_type, principal_id, idempotency_key)
     DO NOTHING`,
    [
      randomUUID(),
      identity.operation,
      identity.principalType,
      identity.principalId,
      idempotencyKey,
      payloadDigest,
      now,
      new Date(now.getTime() + responseRetentionMilliseconds),
    ],
  );
  if (inserted.rowCount === 1) return null;

  const existing = await client.query<IdempotencyRow>(
    `SELECT request_digest, response_available_until, response_body, status
       FROM ${schema}.idempotency_requests
      WHERE operation = $1 AND principal_type = $2 AND principal_id = $3
        AND idempotency_key = $4
      FOR UPDATE`,
    [
      identity.operation,
      identity.principalType,
      identity.principalId,
      idempotencyKey,
    ],
  );
  const row = existing.rows[0];
  if (!row) {
    throw new ProductTransactionError(
      "IDEMPOTENCY_KEY_REUSED",
      "Idempotency record disappeared during conflict resolution",
      true,
    );
  }
  if (!row.request_digest.equals(payloadDigest)) {
    throw new ProductTransactionError(
      "IDEMPOTENCY_KEY_REUSED",
      "Idempotency key was already used with another payload",
    );
  }
  if (row.status === "processing") {
    throw new ProductTransactionError(
      "IDEMPOTENCY_KEY_REUSED",
      "Idempotent request is still processing",
      true,
    );
  }
  if (row.response_available_until.getTime() < now.getTime()) {
    throw new ProductTransactionError(
      "IDEMPOTENCY_RESULT_EXPIRED",
      "The retained response has expired; the operation was not repeated",
    );
  }
  return row;
}

async function completeIdempotentRequest(
  client: PoolClient,
  identity: IdempotencyIdentity,
  idempotencyKey: string,
  response: unknown,
  resultObjectType: string,
  resultObjectId: string,
): Promise<void> {
  await client.query(
    `UPDATE ${schema}.idempotency_requests
        SET status = 'succeeded', response_status = 200, response_body = $5,
            result_object_type = $6, result_object_id = $7
      WHERE operation = $1 AND principal_type = $2 AND principal_id = $3
        AND idempotency_key = $4`,
    [
      identity.operation,
      identity.principalType,
      identity.principalId,
      idempotencyKey,
      response,
      resultObjectType,
      resultObjectId,
    ],
  );
}

export class IdentityTransactionService {
  constructor(private readonly pool: Pool) {}

  async registerProvider(
    input: RegisterProviderRequest,
    context: RegistrationContext,
  ): Promise<ReturnType<typeof registerProviderResponseSchema.parse>> {
    const request = registerProviderRequestSchema.parse(input);
    if (request.phoneVerificationId !== context.verifiedPhoneVerificationId) {
      throw new ProductTransactionError(
        "PHONE_VERIFICATION_INVALID",
        "Registration proof does not match the request",
      );
    }

    return inTransaction(this.pool, async (client) => {
      const now = await databaseNow(client);
      const verificationResult = await client.query<VerificationRow>(
        `SELECT phone_e164, purpose, verified_at, expires_at, consumed_at
           FROM ${schema}.phone_verifications
          WHERE verification_id = $1
          FOR UPDATE`,
        [request.phoneVerificationId],
      );
      const verification = verificationResult.rows[0];
      if (
        !verification ||
        verification.purpose !== "provider_registration" ||
        !verification.verified_at ||
        verification.expires_at.getTime() < now.getTime()
      ) {
        throw new ProductTransactionError(
          "PHONE_VERIFICATION_INVALID",
          "Phone verification is unavailable, expired, or has the wrong purpose",
        );
      }

      const identity: IdempotencyIdentity = {
        operation: "register_provider",
        principalId: request.phoneVerificationId,
        principalType: "registration",
      };
      const existing = await beginIdempotentRequest(
        client,
        identity,
        request.metadata.idempotencyKey,
        requestDigest(request),
        now,
      );
      if (existing) return registerProviderResponseSchema.parse(existing.response_body);
      if (verification.consumed_at) {
        throw new ProductTransactionError(
          "PHONE_VERIFICATION_INVALID",
          "Phone verification was already consumed by another request",
        );
      }

      const invitationResult = await client.query<InvitationRow>(
        `SELECT invitation_id, max_uses, consumed_uses, expires_at, revoked_at
           FROM ${schema}.provider_invitations
          WHERE code_digest = $1
          FOR UPDATE`,
        [digest(request.invitationCode)],
      );
      const invitation = invitationResult.rows[0];
      if (!invitation) {
        throw new ProductTransactionError("INPUT_INVALID", "Invitation was not found");
      }
      if (invitation.revoked_at) {
        throw new ProductTransactionError("INVITATION_REVOKED", "Invitation was revoked");
      }
      if (invitation.expires_at.getTime() < now.getTime()) {
        throw new ProductTransactionError("INVITATION_EXPIRED", "Invitation expired");
      }
      if (invitation.consumed_uses >= invitation.max_uses) {
        throw new ProductTransactionError("INVITATION_EXHAUSTED", "Invitation is exhausted");
      }

      const providerId = randomUUID();
      try {
        await client.query(
          `INSERT INTO ${schema}.providers (
             provider_id, phone_e164, display_name, status, created_at, updated_at
           ) VALUES ($1, $2, $3, 'active', $4, $4)`,
          [providerId, verification.phone_e164, request.displayName, now],
        );
      } catch (error) {
        if (isUniqueViolation(error, "providers_phone_e164_key")) {
          throw new ProductTransactionError(
            "PHONE_ALREADY_REGISTERED",
            "Phone number already belongs to a provider",
          );
        }
        throw error;
      }

      await client.query(
        `INSERT INTO ${schema}.provider_invitation_consumptions (
           consumption_id, invitation_id, provider_id, verification_id, consumed_at
         ) VALUES ($1, $2, $3, $4, $5)`,
        [
          randomUUID(),
          invitation.invitation_id,
          providerId,
          request.phoneVerificationId,
          now,
        ],
      );
      await client.query(
        `UPDATE ${schema}.provider_invitations
            SET consumed_uses = consumed_uses + 1
          WHERE invitation_id = $1`,
        [invitation.invitation_id],
      );
      await client.query(
        `UPDATE ${schema}.phone_verifications
            SET consumed_at = $2
          WHERE verification_id = $1`,
        [request.phoneVerificationId, now],
      );

      const response = registerProviderResponseSchema.parse({
        invitationId: invitation.invitation_id,
        providerId,
        registeredAt: now.toISOString(),
      });
      await completeIdempotentRequest(
        client,
        identity,
        request.metadata.idempotencyKey,
        response,
        "provider",
        providerId,
      );
      await writeAudit(
        client,
        "system",
        null,
        "provider.registered",
        "provider",
        providerId,
        request.metadata.requestId,
        { invitationId: invitation.invitation_id },
      );
      return response;
    });
  }

  async createAssociationSession(
    input: unknown,
    context: InstallationContext,
  ): Promise<ReturnType<typeof createAssociationSessionResponseSchema.parse>> {
    const request = createAssociationSessionRequestSchema.parse(input);
    return inTransaction(this.pool, async (client) => {
      const now = await databaseNow(client);
      const installation = await client.query<{ generation: string; status: string }>(
        `SELECT generation, status FROM ${schema}.installations
          WHERE installation_id = $1 FOR UPDATE`,
        [context.installationId],
      );
      const row = installation.rows[0];
      if (
        !row ||
        row.status !== "active" ||
        row.generation !== context.installationGeneration.toString()
      ) {
        throw new ProductTransactionError(
          "AUTHORIZATION_DENIED",
          "Installation identity or generation is no longer active",
        );
      }

      const identity: IdempotencyIdentity = {
        operation: "create_association_session",
        principalId: context.installationId,
        principalType: "installation",
      };
      const existing = await beginIdempotentRequest(
        client,
        identity,
        request.metadata.idempotencyKey,
        requestDigest(request),
        now,
      );
      if (existing) {
        return createAssociationSessionResponseSchema.parse(existing.response_body);
      }

      const currentAssociation = await client.query(
        `SELECT 1 FROM ${schema}.device_associations
          WHERE installation_id = $1 AND ended_at IS NULL
          FOR UPDATE`,
        [context.installationId],
      );
      if (currentAssociation.rowCount) {
        throw new ProductTransactionError(
          "DEVICE_ALREADY_ASSOCIATED",
          "Installation already has a current association",
        );
      }

      const invalidated: QueryResult = await client.query(
        `UPDATE ${schema}.association_sessions
            SET invalidated_at = $2
          WHERE installation_id = $1 AND consumed_at IS NULL
            AND invalidated_at IS NULL`,
        [context.installationId, now],
      );
      const associationSessionId = randomUUID();
      const associationCode = `sgassoc_v1_${randomBytes(32).toString("base64url")}`;
      const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
      await client.query(
        `INSERT INTO ${schema}.association_sessions (
           association_session_id, installation_id,
           expected_installation_generation, device_label, code_digest,
           expires_at, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          associationSessionId,
          context.installationId,
          context.installationGeneration,
          request.deviceLabel,
          digest(associationCode),
          expiresAt,
          now,
        ],
      );
      const response = createAssociationSessionResponseSchema.parse({
        associationCode,
        associationSessionId,
        expiresAt: expiresAt.toISOString(),
        replacedPreviousSession: (invalidated.rowCount ?? 0) > 0,
      });
      await completeIdempotentRequest(
        client,
        identity,
        request.metadata.idempotencyKey,
        response,
        "association_session",
        associationSessionId,
      );
      await writeAudit(
        client,
        "installation",
        context.installationId,
        "association_session.created",
        "association_session",
        associationSessionId,
        request.metadata.requestId,
        { replacedPreviousSession: response.replacedPreviousSession },
      );
      return response;
    });
  }

  async inspectAssociationCode(
    input: unknown,
    context: ProviderContext,
  ): Promise<ReturnType<typeof associationSessionViewSchema.parse>> {
    const request = inspectAssociationCodeRequestSchema.parse(input);
    try {
      const provider = await this.pool.query<{ status: string }>(
        `SELECT status FROM ${schema}.providers WHERE provider_id = $1`,
        [context.providerId],
      );
      if (provider.rows[0]?.status !== "active") {
        throw new ProductTransactionError(
          "AUTHORIZATION_DENIED",
          "Provider identity is no longer active",
        );
      }
      const result = await this.pool.query<AssociationSessionRow>(
        `SELECT association_session_id, installation_id,
                expected_installation_generation, device_label, expires_at,
                consumed_at, invalidated_at,
                transaction_timestamp() AS database_now
           FROM ${schema}.association_sessions
          WHERE code_digest = $1`,
        [digest(request.associationCode)],
      );
      const session = result.rows[0];
      if (
        !session ||
        session.consumed_at ||
        session.invalidated_at ||
        session.expires_at.getTime() <
          (session as AssociationSessionRow & DatabaseTimeRow).database_now.getTime()
      ) {
        throw new ProductTransactionError(
          "ASSOCIATION_SESSION_EXPIRED",
          "Association code is unavailable or expired",
        );
      }
      return associationSessionViewSchema.parse({
        associationSessionId: session.association_session_id,
        expiresAt: session.expires_at.toISOString(),
        installation: {
          deviceLabel: session.device_label,
          installationId: session.installation_id,
        },
      });
    } catch (error) {
      if (error instanceof ProductTransactionError) throw error;
      throw new Error("Failed to inspect association code", { cause: error });
    }
  }

  async confirmAssociation(
    input: ConfirmAssociationRequest,
    context: ProviderContext,
  ): Promise<ReturnType<typeof confirmAssociationResponseSchema.parse>> {
    const request = confirmAssociationRequestSchema.parse(input);
    return inTransaction(this.pool, async (client) => {
      const now = await databaseNow(client);
      const provider = await client.query<{ status: string }>(
        `SELECT status FROM ${schema}.providers WHERE provider_id = $1 FOR UPDATE`,
        [context.providerId],
      );
      if (provider.rows[0]?.status !== "active") {
        throw new ProductTransactionError(
          "AUTHORIZATION_DENIED",
          "Provider identity is no longer active",
        );
      }

      const identity: IdempotencyIdentity = {
        operation: "confirm_association",
        principalId: context.providerId,
        principalType: "provider",
      };
      const existing = await beginIdempotentRequest(
        client,
        identity,
        request.metadata.idempotencyKey,
        requestDigest(request),
        now,
      );
      if (existing) return confirmAssociationResponseSchema.parse(existing.response_body);

      const sessionIdentity = await client.query<{ installation_id: string }>(
        `SELECT installation_id
           FROM ${schema}.association_sessions
          WHERE association_session_id = $1`,
        [request.associationSessionId],
      );
      const installationId = sessionIdentity.rows[0]?.installation_id;
      if (!installationId) {
        throw new ProductTransactionError(
          "ASSOCIATION_SESSION_EXPIRED",
          "Association session is unavailable",
        );
      }

      const installation = await client.query<{ generation: string; status: string }>(
        `SELECT generation, status FROM ${schema}.installations
          WHERE installation_id = $1 FOR UPDATE`,
        [installationId],
      );
      const sessionResult = await client.query<AssociationSessionRow>(
        `SELECT installation_id, expected_installation_generation, device_label,
                association_session_id, expires_at, consumed_at, invalidated_at
           FROM ${schema}.association_sessions
          WHERE association_session_id = $1
          FOR UPDATE`,
        [request.associationSessionId],
      );
      const session = sessionResult.rows[0];
      if (!session || session.invalidated_at) {
        throw new ProductTransactionError(
          "ASSOCIATION_SESSION_EXPIRED",
          "Association session is unavailable",
        );
      }
      if (session.consumed_at) {
        throw new ProductTransactionError(
          "ASSOCIATION_SESSION_CONSUMED",
          "Association session was already consumed",
        );
      }
      if (session.expires_at.getTime() < now.getTime()) {
        throw new ProductTransactionError(
          "ASSOCIATION_SESSION_EXPIRED",
          "Association session expired",
        );
      }
      if (session.installation_id !== request.expectedInstallationId) {
        throw new ProductTransactionError(
          "ASSOCIATION_TARGET_CHANGED",
          "Scanned association target does not match the confirmed installation",
        );
      }

      const installationRow = installation.rows[0];
      if (
        !installationRow ||
        installationRow.status !== "active" ||
        installationRow.generation !== session.expected_installation_generation
      ) {
        throw new ProductTransactionError(
          "ASSOCIATION_TARGET_CHANGED",
          "Installation generation changed after the code was created",
        );
      }

      const current = await client.query<CurrentAssociationRow>(
        `SELECT association_id, device_id, provider_id
           FROM ${schema}.device_associations
          WHERE installation_id = $1 AND ended_at IS NULL
          FOR UPDATE`,
        [session.installation_id],
      );
      if (current.rows[0]) {
        throw new ProductTransactionError(
          "DEVICE_ALREADY_ASSOCIATED",
          "Installation already has a current association",
        );
      }

      const deviceId = randomUUID();
      const associationId = randomUUID();
      await client.query(
        `INSERT INTO ${schema}.devices (
           device_id, display_name, fact_version, state, created_at, updated_at
         ) VALUES ($1, $2, 1, 'associated_pending_access', $3, $3)`,
        [deviceId, `Device ${deviceId.slice(0, 8)}`, now],
      );
      await client.query(
        `INSERT INTO ${schema}.device_associations (
           association_id, device_id, installation_id, provider_id,
           association_session_id, confirmed_at
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          associationId,
          deviceId,
          session.installation_id,
          context.providerId,
          request.associationSessionId,
          now,
        ],
      );
      await client.query(
        `UPDATE ${schema}.association_sessions
            SET consumed_at = $2, consumed_by_provider_id = $3
          WHERE association_session_id = $1`,
        [request.associationSessionId, now, context.providerId],
      );
      const response = confirmAssociationResponseSchema.parse({
        associationId,
        confirmedAt: now.toISOString(),
        deviceId,
        installationId: session.installation_id,
        providerId: context.providerId,
        state: "associated_pending_access",
      });
      await completeIdempotentRequest(
        client,
        identity,
        request.metadata.idempotencyKey,
        response,
        "device_association",
        associationId,
      );
      await writeAudit(
        client,
        "provider",
        context.providerId,
        "device.associated",
        "device_association",
        associationId,
        request.metadata.requestId,
        { deviceId, installationId: session.installation_id },
      );
      return response;
    });
  }
}
