import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import {
  createInvitationRequestSchema,
  createInvitationResponseSchema,
  invitationViewSchema,
  listInvitationsResponseSchema,
  revokeInvitationRequestSchema,
  revokeInvitationResponseSchema,
  type CreateInvitationRequest,
  type CreateInvitationResponse,
  type InvitationView,
  type ListInvitationsResponse,
  type RevokeInvitationRequest,
  type RevokeInvitationResponse,
} from "@socialgrowth/product-contracts";
import type { Pool, PoolClient } from "pg";

import { OperatorAuthService } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";

const schema = "socialgrowth_product";
const responseRetentionMilliseconds = 24 * 60 * 60 * 1000;

interface InvitationRow {
  invitation_id: string;
  max_uses: number;
  consumed_uses: number;
  fact_version: string;
  expires_at: Date;
  revoked_at: Date | null;
  revoked_by_operator_id: string | null;
  created_at: Date;
  created_by_operator_id: string;
}

interface RegistrationRow {
  invitation_id: string;
  provider_id: string;
  display_name: string;
  consumed_at: Date;
  associated_device_count: string;
}

interface IdempotencyRow {
  request_digest: Buffer;
  response_available_until: Date;
  response_body: unknown;
  result_object_id: string | null;
  status: "failed" | "processing" | "succeeded";
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function requestDigest(value: unknown): Buffer {
  if (typeof value !== "object" || value === null || !("metadata" in value)) {
    return digest(JSON.stringify(value));
  }
  const metadata = { ...(value.metadata as Record<string, unknown>) };
  delete metadata.requestId;
  return digest(JSON.stringify({ ...(value as Record<string, unknown>), metadata }));
}

async function databaseNow(client: PoolClient): Promise<Date> {
  const result = await client.query<{ database_now: Date }>(
    "SELECT transaction_timestamp() AS database_now",
  );
  const now = result.rows[0]?.database_now;
  if (!now) throw new Error("PostgreSQL did not return its transaction timestamp");
  return now;
}

async function databaseWallClock(client: PoolClient): Promise<Date> {
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
  isolationLevel: "READ COMMITTED" | "REPEATABLE READ" = "READ COMMITTED",
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${isolationLevel}`);
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
  operation: string,
  operatorId: string,
  idempotencyKey: string,
  requestHash: Buffer,
  now: Date,
): Promise<IdempotencyRow | null> {
  const inserted = await client.query(
    `INSERT INTO ${schema}.idempotency_requests (
       idempotency_request_id, operation, principal_type, principal_id,
       idempotency_key, request_digest, status, created_at,
       response_available_until
     ) VALUES ($1, $2, 'operator', $3, $4, $5, 'processing', $6, $7)
     ON CONFLICT (operation, principal_type, principal_id, idempotency_key)
     DO NOTHING`,
    [
      randomUUID(),
      operation,
      operatorId,
      idempotencyKey,
      requestHash,
      now,
      new Date(now.getTime() + responseRetentionMilliseconds),
    ],
  );
  if (inserted.rowCount === 1) return null;

  const existing = await client.query<IdempotencyRow>(
    `SELECT request_digest, response_available_until, response_body,
            result_object_id, status
       FROM ${schema}.idempotency_requests
      WHERE operation = $1 AND principal_type = 'operator'
        AND principal_id = $2 AND idempotency_key = $3
      FOR UPDATE`,
    [operation, operatorId, idempotencyKey],
  );
  const row = existing.rows[0];
  if (!row || row.request_digest.length !== requestHash.length ||
      !timingSafeEqual(row.request_digest, requestHash)) {
    throw new ProductTransactionError(
      "IDEMPOTENCY_KEY_REUSED",
      "Idempotency key was already used for another request",
    );
  }
  if (row.status !== "succeeded") {
    throw new ProductTransactionError(
      "IDEMPOTENCY_KEY_REUSED",
      "The original request has not completed successfully",
      true,
    );
  }
  if (row.response_available_until <= now || row.response_body === null) {
    throw new ProductTransactionError(
      "IDEMPOTENCY_RESULT_EXPIRED",
      "The original response is no longer available",
    );
  }
  return row;
}

async function completeIdempotentRequest(
  client: PoolClient,
  operation: string,
  operatorId: string,
  idempotencyKey: string,
  response: unknown,
  resultId: string,
): Promise<void> {
  await client.query(
    `UPDATE ${schema}.idempotency_requests
        SET status = 'succeeded', response_status = 200,
            response_body = $4, result_object_type = 'provider_invitation',
            result_object_id = $5
      WHERE operation = $1 AND principal_type = 'operator'
        AND principal_id = $2 AND idempotency_key = $3`,
    [operation, operatorId, idempotencyKey, response, resultId],
  );
}

async function writeAudit(
  client: PoolClient,
  actorId: string,
  action: string,
  invitationId: string,
  requestId: string,
  facts: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO ${schema}.audit_records (
       audit_record_id, actor_type, actor_id, action, object_type,
       object_id, request_id, facts
     ) VALUES ($1, 'operator', $2, $3, 'provider_invitation', $4, $5, $6)`,
    [randomUUID(), actorId, action, invitationId, requestId, facts],
  );
}

function invitationStatus(row: InvitationRow, now: Date): InvitationView["status"] {
  if (row.revoked_at) return "revoked";
  if (row.expires_at <= now) return "expired";
  if (row.consumed_uses >= row.max_uses) return "exhausted";
  return "active";
}

function invitationView(
  row: InvitationRow,
  registrations: RegistrationRow[],
  now: Date,
): InvitationView {
  return invitationViewSchema.parse({
    invitationId: row.invitation_id,
    maxUses: row.max_uses,
    consumedUses: row.consumed_uses,
    expiresAt: row.expires_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    evaluatedAt: now.toISOString(),
    createdByOperatorId: row.created_by_operator_id,
    factVersion: Number(row.fact_version),
    status: invitationStatus(row, now),
    revokedAt: row.revoked_at?.toISOString() ?? null,
    revokedByOperatorId: row.revoked_by_operator_id,
    registrations: registrations.map((registration) => ({
      providerId: registration.provider_id,
      displayName: registration.display_name,
      registeredAt: registration.consumed_at.toISOString(),
      associatedDeviceCount: Number(registration.associated_device_count),
    })),
  });
}

async function registrationsFor(
  client: PoolClient,
  invitationIds: string[],
): Promise<Map<string, RegistrationRow[]>> {
  const grouped = new Map<string, RegistrationRow[]>();
  for (const invitationId of invitationIds) grouped.set(invitationId, []);
  if (invitationIds.length === 0) return grouped;
  const result = await client.query<RegistrationRow>(
    `SELECT c.invitation_id, p.provider_id, p.display_name, c.consumed_at,
            count(da.association_id)::text AS associated_device_count
       FROM ${schema}.provider_invitation_consumptions c
       JOIN ${schema}.providers p ON p.provider_id = c.provider_id
       LEFT JOIN ${schema}.device_associations da
         ON da.provider_id = p.provider_id AND da.ended_at IS NULL
      WHERE c.invitation_id = ANY($1::uuid[])
      GROUP BY c.invitation_id, p.provider_id, p.display_name, c.consumed_at
      ORDER BY c.consumed_at, p.provider_id`,
    [invitationIds],
  );
  for (const row of result.rows) grouped.get(row.invitation_id)?.push(row);
  return grouped;
}

export class InvitationManagementService {
  constructor(
    private readonly pool: Pool,
    private readonly operatorAuth: OperatorAuthService,
    private readonly securityPepper: string,
  ) {
    if (Buffer.byteLength(securityPepper, "utf8") < 32) {
      throw new Error("Invitation security pepper must contain at least 32 bytes");
    }
  }

  private accessCode(invitationId: string): string {
    return createHmac("sha256", this.securityPepper)
      .update(`provider-invitation:v1:${invitationId}`, "utf8")
      .digest("base64url");
  }

  async createInvitation(
    sessionToken: string,
    csrfToken: string,
    request: CreateInvitationRequest,
  ): Promise<CreateInvitationResponse> {
    const parsed = createInvitationRequestSchema.parse(request);
    return inTransaction(this.pool, async (client) => {
      const context = await this.operatorAuth.authenticateSessionInTransaction(
        client, sessionToken, csrfToken, true,
      );
      const now = await databaseNow(client);
      const replay = await beginIdempotentRequest(
        client,
        "provider_invitation.create",
        context.operator.operatorId,
        parsed.metadata.idempotencyKey,
        requestDigest(parsed),
        now,
      );
      if (replay) {
        const invitationId = replay.result_object_id;
        if (!invitationId) throw new Error("Invitation replay is missing its result id");
        const code = this.accessCode(invitationId);
        const invitation = await client.query<{ code_digest: Buffer }>(
          `SELECT code_digest FROM ${schema}.provider_invitations
            WHERE invitation_id = $1`,
          [invitationId],
        );
        const storedDigest = invitation.rows[0]?.code_digest;
        const derivedDigest = digest(code);
        if (!storedDigest || storedDigest.length !== derivedDigest.length ||
            !timingSafeEqual(storedDigest, derivedDigest)) {
          throw new ProductTransactionError(
            "IDEMPOTENCY_RESULT_EXPIRED",
            "The original invitation access code cannot be recovered with the active key",
          );
        }
        return createInvitationResponseSchema.parse({
          ...(replay.response_body as Record<string, unknown>),
          access: { code },
        });
      }

      const expiresAt = new Date(parsed.expiresAt);
      if (expiresAt <= now) {
        throw new ProductTransactionError("INPUT_INVALID", "Invitation expiry must be in the future");
      }
      const invitationId = randomUUID();
      const code = this.accessCode(invitationId);
      const inserted = await client.query<InvitationRow>(
        `INSERT INTO ${schema}.provider_invitations (
           invitation_id, code_digest, created_by_operator_id, max_uses,
           expires_at, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [invitationId, digest(code), context.operator.operatorId, parsed.maxUses, expiresAt, now],
      );
      const invitation = invitationView(inserted.rows[0]!, [], now);
      const response = createInvitationResponseSchema.parse({ invitation, access: { code } });
      await writeAudit(
        client,
        context.operator.operatorId,
        "provider_invitation.created",
        invitationId,
        parsed.metadata.requestId,
        { maxUses: parsed.maxUses, expiresAt: parsed.expiresAt },
      );
      await completeIdempotentRequest(
        client,
        "provider_invitation.create",
        context.operator.operatorId,
        parsed.metadata.idempotencyKey,
        { invitation },
        invitationId,
      );
      return response;
    });
  }

  async listInvitations(sessionToken: string): Promise<ListInvitationsResponse> {
    return inTransaction(this.pool, async (client) => {
      await this.operatorAuth.authenticateSessionInTransaction(client, sessionToken);
      const invitations = await client.query<InvitationRow>(
        `SELECT * FROM ${schema}.provider_invitations
          ORDER BY created_at DESC, invitation_id DESC`,
      );
      const registrations = await registrationsFor(
        client,
        invitations.rows.map((row) => row.invitation_id),
      );
      const evaluatedAt = await databaseWallClock(client);
      return listInvitationsResponseSchema.parse({
        invitations: invitations.rows.map((row) =>
          invitationView(row, registrations.get(row.invitation_id) ?? [], evaluatedAt)),
      });
    }, "REPEATABLE READ");
  }

  async revokeInvitation(
    sessionToken: string,
    csrfToken: string,
    request: RevokeInvitationRequest,
  ): Promise<RevokeInvitationResponse> {
    const parsed = revokeInvitationRequestSchema.parse(request);
    return inTransaction(this.pool, async (client) => {
      const context = await this.operatorAuth.authenticateSessionInTransaction(
        client, sessionToken, csrfToken, true,
      );
      const now = await databaseNow(client);
      const replay = await beginIdempotentRequest(
        client,
        "provider_invitation.revoke",
        context.operator.operatorId,
        parsed.metadata.idempotencyKey,
        requestDigest(parsed),
        now,
      );
      if (replay) return revokeInvitationResponseSchema.parse(replay.response_body);

      const target = await client.query<InvitationRow>(
        `SELECT * FROM ${schema}.provider_invitations
          WHERE invitation_id = $1 FOR UPDATE`,
        [parsed.invitationId],
      );
      const current = target.rows[0];
      if (!current || Number(current.fact_version) !== parsed.expectedFactVersion) {
        throw new ProductTransactionError("FACT_VERSION_STALE", "Invitation fact version is stale");
      }
      if (current.revoked_at) {
        throw new ProductTransactionError("INVITATION_REVOKED", "Invitation is already revoked");
      }
      const mutationNow = await databaseWallClock(client);
      const updated = await client.query<InvitationRow>(
        `UPDATE ${schema}.provider_invitations
            SET revoked_at = $2, revoked_by_operator_id = $3,
                fact_version = fact_version + 1
          WHERE invitation_id = $1
          RETURNING *`,
        [parsed.invitationId, mutationNow, context.operator.operatorId],
      );
      const registrations = await registrationsFor(client, [parsed.invitationId]);
      const response = revokeInvitationResponseSchema.parse({
        invitation: invitationView(
          updated.rows[0]!, registrations.get(parsed.invitationId) ?? [], mutationNow,
        ),
      });
      await writeAudit(
        client,
        context.operator.operatorId,
        "provider_invitation.revoked",
        parsed.invitationId,
        parsed.metadata.requestId,
        { expectedFactVersion: parsed.expectedFactVersion },
      );
      await completeIdempotentRequest(
        client,
        "provider_invitation.revoke",
        context.operator.operatorId,
        parsed.metadata.idempotencyKey,
        response,
        parsed.invitationId,
      );
      return response;
    });
  }
}
