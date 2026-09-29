import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";

import {
  createOperatorRequestSchema,
  createOperatorResponseSchema,
  disableOperatorRequestSchema,
  disableOperatorResponseSchema,
  listOperatorsResponseSchema,
  listOperatorDeviceFactsResponseSchema,
  operatorDisplayNameSchema,
  operatorLoginNameSchema,
  operatorLoginRequestSchema,
  operatorLoginResponseSchema,
  operatorPasswordSchema,
  operatorViewSchema,
  requestIdSchema,
  uuidSchema,
  type CreateOperatorRequest,
  type CreateOperatorResponse,
  type DisableOperatorRequest,
  type DisableOperatorResponse,
  type ListOperatorsResponse,
  type ListOperatorDeviceFactsResponse,
  type OperatorLoginRequest,
  type OperatorLoginResponse,
  type OperatorView,
} from "@socialgrowth/product-contracts";
import type { Pool, PoolClient } from "pg";

import { ProductTransactionError } from "./product-transaction-error.js";

const schema = "socialgrowth_product";
const sessionLifetimeMilliseconds = 8 * 60 * 60 * 1000;
const throttleWindowMilliseconds = 15 * 60 * 1000;
const throttleFailureLimit = 5;
const responseRetentionMilliseconds = 24 * 60 * 60 * 1000;
const passwordHashParameters = { N: 32_768, p: 1, r: 8 } as const;
const passwordHashMaxMemory = 64 * 1024 * 1024;
const dummyPasswordHash =
  "scrypt$v=1$N=32768,r=8,p=1$WlpaWlpaWlpaWlpaWlpaWg$P6QcyQYU6mAXh2LdGMg1t06SNC3j3kH6btj6EeCdasGJAxuveO5tVY58MTj0C97_neI3p19IRzmkPsFIHP16MQ";

interface OperatorRow {
  created_at: Date;
  credential_version: string;
  disabled_at: Date | null;
  display_name: string;
  fact_version: string;
  login_name: string;
  operator_id: string;
  password_hash: string;
  status: "active" | "disabled";
  updated_at: Date;
}

interface OperatorSessionRow {
  credential_version: string;
  expires_at: Date;
  revoked_at: Date | null;
  session_id: string;
}

interface SessionLookupRow {
  operator_id: string;
  session_id: string;
}

interface ThrottleRow {
  blocked_until: Date | null;
  failure_count: number;
}

interface IdempotencyRow {
  request_digest: Buffer;
  response_available_until: Date;
  response_body: unknown;
  status: "failed" | "processing" | "succeeded";
}

interface DatabaseTimeRow {
  database_now: Date;
}

interface CountRow {
  count: string;
}

interface OperatorDeviceFactsRow {
  read_at: Date;
  provider_id: string | null;
  provider_display_name: string | null;
  phone_e164: string | null;
  provider_status: "active" | "disabled" | null;
  device_id: string | null;
  device_display_name: string | null;
  device_state: string | null;
  fact_version: string | null;
  device_updated_at: Date | null;
}

export interface OperatorSessionContext {
  operator: OperatorView;
  sessionId: string;
}

export interface OperatorLoginResult {
  response: OperatorLoginResponse;
  sessionToken: string;
}

export interface InitializeOperatorInput {
  displayName: string;
  loginName: string;
  password: string;
  requestId: string;
}

export interface RecoverOperatorInput {
  newPassword: string;
  operatorId: string;
  requestId: string;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function payloadDigest(value: unknown): Buffer {
  if (
    typeof value === "object" &&
    value !== null &&
    "metadata" in value &&
    typeof value.metadata === "object" &&
    value.metadata !== null
  ) {
    const metadata = { ...(value.metadata as Record<string, unknown>) };
    delete metadata.requestId;
    const scrubbed: Record<string, unknown> = {
      ...(value as Record<string, unknown>),
      metadata,
    };
    delete scrubbed.initialPassword;
    delete scrubbed.password;
    delete scrubbed.newPassword;
    return digest(JSON.stringify(scrubbed));
  }
  return digest(JSON.stringify(value));
}

function encodeToken(): string {
  return randomBytes(32).toString("base64url");
}

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(
      password,
      salt,
      64,
      { ...passwordHashParameters, maxmem: passwordHashMaxMemory },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey as Buffer);
      },
    );
  });
}

export async function hashOperatorPassword(password: string): Promise<string> {
  const parsed = operatorPasswordSchema.parse(password);
  const salt = randomBytes(16);
  const derivedKey = await scrypt(parsed, salt);
  return [
    "scrypt",
    "v=1",
    `N=${passwordHashParameters.N},r=${passwordHashParameters.r},p=${passwordHashParameters.p}`,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function verifyOperatorPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  const parts = encodedHash.split("$");
  if (
    parts.length !== 5 ||
    parts[0] !== "scrypt" ||
    parts[1] !== "v=1" ||
    parts[2] !== "N=32768,r=8,p=1"
  ) {
    return false;
  }
  try {
    const salt = Buffer.from(parts[3]!, "base64url");
    const expected = Buffer.from(parts[4]!, "base64url");
    if (salt.length !== 16 || expected.length !== 64) return false;
    const actual = await scrypt(password, salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function operatorView(row: OperatorRow): OperatorView {
  return operatorViewSchema.parse({
    operatorId: row.operator_id,
    loginName: row.login_name,
    displayName: row.display_name,
    status: row.status,
    factVersion: Number(row.fact_version),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    disabledAt: row.disabled_at?.toISOString() ?? null,
  });
}

async function databaseNow(client: PoolClient): Promise<Date> {
  const result = await client.query<DatabaseTimeRow>(
    "SELECT transaction_timestamp() AS database_now",
  );
  const now = result.rows[0]?.database_now;
  if (!now) throw new Error("PostgreSQL did not return its transaction timestamp");
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

async function writeAudit(
  client: PoolClient,
  actorType: "operator" | "system",
  actorId: string | null,
  action: string,
  objectId: string,
  requestId: string,
  facts: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO ${schema}.audit_records (
       audit_record_id, actor_type, actor_id, action, object_type,
       object_id, request_id, facts
     ) VALUES ($1, $2, $3, $4, 'operator', $5, $6, $7)`,
    [randomUUID(), actorType, actorId, action, objectId, requestId, facts],
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
    `SELECT request_digest, response_available_until, response_body, status
       FROM ${schema}.idempotency_requests
      WHERE operation = $1 AND principal_type = 'operator'
        AND principal_id = $2 AND idempotency_key = $3
      FOR UPDATE`,
    [operation, operatorId, idempotencyKey],
  );
  const row = existing.rows[0];
  if (!row || !timingSafeEqual(row.request_digest, requestHash)) {
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
            response_body = $4, result_object_type = 'operator', result_object_id = $5
      WHERE operation = $1 AND principal_type = 'operator'
        AND principal_id = $2 AND idempotency_key = $3`,
    [operation, operatorId, idempotencyKey, response, resultId],
  );
}

export class OperatorAuthService {
  constructor(
    private readonly pool: Pool,
    private readonly securityPepper: string,
  ) {
    if (Buffer.byteLength(securityPepper, "utf8") < 32) {
      throw new Error("Operator auth security pepper must contain at least 32 bytes");
    }
  }

  private clientScopeDigest(clientScope: string): Buffer {
    return createHmac("sha256", this.securityPepper).update(clientScope, "utf8").digest();
  }

  async initializeFirstOperator(input: InitializeOperatorInput): Promise<OperatorView> {
    const loginName = operatorLoginNameSchema.parse(input.loginName);
    const displayName = operatorDisplayNameSchema.parse(input.displayName);
    const password = operatorPasswordSchema.parse(input.password);
    const requestId = requestIdSchema.parse(input.requestId);
    const passwordHash = await hashOperatorPassword(password);

    return inTransaction(this.pool, async (client) => {
      await client.query(`LOCK TABLE ${schema}.operators IN SHARE ROW EXCLUSIVE MODE`);
      const existing = await client.query<OperatorRow>(
        `SELECT * FROM ${schema}.operators ORDER BY created_at, operator_id`,
      );
      if (existing.rows.length > 0) {
        const same = existing.rows.length === 1 && existing.rows[0]?.login_name === loginName;
        if (!same) {
          throw new ProductTransactionError(
            "AUTHORIZATION_DENIED",
            "Initial operator setup is already closed",
          );
        }
        return operatorView(existing.rows[0]!);
      }
      const operatorId = randomUUID();
      const inserted = await client.query<OperatorRow>(
        `INSERT INTO ${schema}.operators (
           operator_id, login_name, display_name, password_hash, status
         ) VALUES ($1, $2, $3, $4, 'active')
         RETURNING *`,
        [operatorId, loginName, displayName, passwordHash],
      );
      await writeAudit(
        client,
        "system",
        null,
        "operator.initialized",
        operatorId,
        requestId,
        { loginName },
      );
      return operatorView(inserted.rows[0]!);
    });
  }

  async login(request: OperatorLoginRequest, clientScope: string): Promise<OperatorLoginResult> {
    const parsed = operatorLoginRequestSchema.parse(request);
    if (clientScope.trim().length === 0 || clientScope.length > 512) {
      throw new ProductTransactionError("INPUT_INVALID", "Client scope is required");
    }
    const scopeDigest = this.clientScopeDigest(clientScope);
    const blocked = await this.pool.query(
      `SELECT 1
         FROM ${schema}.operator_login_throttles
        WHERE login_name = $1 AND client_scope_digest = $2
          AND blocked_until > transaction_timestamp()`,
      [parsed.loginName, scopeDigest],
    );
    if ((blocked.rowCount ?? 0) > 0) {
      throw new ProductTransactionError(
        "LOGIN_RATE_LIMITED",
        "Too many login attempts; retry later",
        true,
      );
    }
    const candidate = await this.pool.query<OperatorRow>(
      `SELECT * FROM ${schema}.operators WHERE login_name = $1`,
      [parsed.loginName],
    );
    const snapshot = candidate.rows[0];
    const passwordMatches = await verifyOperatorPassword(
      parsed.password,
      snapshot?.password_hash ?? dummyPasswordHash,
    );

    const result = await inTransaction<
      | { error: ProductTransactionError }
      | { response: OperatorLoginResponse; sessionToken: string }
    >(this.pool, async (client) => {
      const now = await databaseNow(client);
      const current = await client.query<OperatorRow>(
        `SELECT * FROM ${schema}.operators WHERE login_name = $1 FOR UPDATE`,
        [parsed.loginName],
      );
      const throttle = await client.query<ThrottleRow>(
        `SELECT failure_count, blocked_until
           FROM ${schema}.operator_login_throttles
          WHERE login_name = $1 AND client_scope_digest = $2
          FOR UPDATE`,
        [parsed.loginName, scopeDigest],
      );
      const throttleRow = throttle.rows[0];
      if (throttleRow?.blocked_until && throttleRow.blocked_until > now) {
        throw new ProductTransactionError(
          "LOGIN_RATE_LIMITED",
          "Too many login attempts; retry later",
          true,
        );
      }

      const operator = current.rows[0];
      const valid =
        passwordMatches &&
        operator !== undefined &&
        operator.status === "active" &&
        snapshot?.password_hash === operator.password_hash &&
        snapshot.credential_version === operator.credential_version;
      if (!valid) {
        const previousFailures =
          throttleRow?.blocked_until && throttleRow.blocked_until <= now
            ? 0
            : (throttleRow?.failure_count ?? 0);
        const failureCount = previousFailures + 1;
        const blockedUntil =
          failureCount >= throttleFailureLimit
            ? new Date(now.getTime() + throttleWindowMilliseconds)
            : null;
        if (throttleRow) {
          await client.query(
            `UPDATE ${schema}.operator_login_throttles
                SET failure_count = $3, blocked_until = $4, updated_at = $5
              WHERE login_name = $1 AND client_scope_digest = $2`,
            [parsed.loginName, scopeDigest, failureCount, blockedUntil, now],
          );
        } else {
          await client.query(
            `INSERT INTO ${schema}.operator_login_throttles (
               login_name, client_scope_digest, failure_count, blocked_until, updated_at
             ) VALUES ($1, $2, 1, NULL, $3)
             ON CONFLICT (login_name, client_scope_digest) DO UPDATE
               SET failure_count = ${schema}.operator_login_throttles.failure_count + 1,
                   blocked_until = CASE
                     WHEN ${schema}.operator_login_throttles.failure_count + 1 >= $4
                       THEN $3 + ($5 * interval '1 millisecond')
                     ELSE ${schema}.operator_login_throttles.blocked_until
                   END,
                   updated_at = $3`,
            [
              parsed.loginName,
              scopeDigest,
              now,
              throttleFailureLimit,
              throttleWindowMilliseconds,
            ],
          );
        }
        return {
          error: new ProductTransactionError(
            "INVALID_CREDENTIALS",
            "Invalid login name or password",
          ),
        };
      }

      await client.query(
        `DELETE FROM ${schema}.operator_login_throttles
          WHERE login_name = $1 AND client_scope_digest = $2`,
        [parsed.loginName, scopeDigest],
      );
      const sessionId = randomUUID();
      const sessionToken = encodeToken();
      const csrfToken = encodeToken();
      const expiresAt = new Date(now.getTime() + sessionLifetimeMilliseconds);
      await client.query(
        `INSERT INTO ${schema}.operator_sessions (
           session_id, operator_id, token_digest, csrf_digest,
           credential_version, expires_at, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          sessionId,
          operator.operator_id,
          digest(sessionToken),
          digest(csrfToken),
          operator.credential_version,
          expiresAt,
          now,
        ],
      );
      const response = operatorLoginResponseSchema.parse({
        operator: operatorView(operator),
        session: {
          sessionId,
          createdAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
        },
        csrfToken,
      });
      return { response, sessionToken };
    });
    if ("error" in result) throw result.error;
    return result;
  }

  async authenticateSession(
    sessionToken: string,
    csrfToken?: string,
  ): Promise<OperatorSessionContext> {
    return inTransaction(this.pool, (client) =>
      this.authenticateSessionInTransaction(client, sessionToken, csrfToken),
    );
  }

  async listOperators(sessionToken: string): Promise<ListOperatorsResponse> {
    return inTransaction(this.pool, async (client) => {
      await this.authenticateSessionInTransaction(client, sessionToken);
      const rows = await client.query<OperatorRow>(
        `SELECT * FROM ${schema}.operators ORDER BY created_at, operator_id`,
      );
      return listOperatorsResponseSchema.parse({ operators: rows.rows.map(operatorView) });
    });
  }

  async listDeviceFacts(sessionToken: string): Promise<ListOperatorDeviceFactsResponse> {
    return inTransaction(this.pool, async (client) => {
      await this.authenticateSessionInTransaction(client, sessionToken);
      const result = await client.query<OperatorDeviceFactsRow>(
        `SELECT statement_timestamp() AS read_at,
                p.provider_id, p.display_name AS provider_display_name,
                p.phone_e164, p.status AS provider_status,
                d.device_id, d.display_name AS device_display_name,
                d.state AS device_state, d.fact_version::text AS fact_version,
                d.updated_at AS device_updated_at
           FROM (SELECT 1) AS anchor
           LEFT JOIN ${schema}.providers p ON TRUE
           LEFT JOIN ${schema}.device_associations a
             ON a.provider_id = p.provider_id AND a.ended_at IS NULL
           LEFT JOIN ${schema}.devices d ON d.device_id = a.device_id
          ORDER BY p.created_at NULLS LAST, p.provider_id,
                   a.confirmed_at NULLS LAST, a.association_id`,
      );
      const readAt = result.rows[0]?.read_at;
      if (!readAt) throw new Error("PostgreSQL did not return a device facts read time");
      const providers = new Map<string, {
        providerId: string;
        displayName: string;
        phoneLastFour: string;
        status: "active" | "disabled";
      }>();
      const devices: Array<{
        deviceId: string;
        providerId: string;
        displayName: string;
        state: string;
        connectionState: "unknown";
        lastConfirmedAt: null;
        factVersion: number;
        updatedAt: string;
      }> = [];
      for (const row of result.rows) {
        if (!row.provider_id) continue;
        if (!row.provider_display_name || !row.phone_e164 || !row.provider_status) {
          throw new Error("Provider facts row is incomplete");
        }
        if (!providers.has(row.provider_id)) {
          providers.set(row.provider_id, {
            providerId: row.provider_id,
            displayName: row.provider_display_name,
            phoneLastFour: row.phone_e164.slice(-4),
            status: row.provider_status,
          });
        }
        if (!row.device_id) continue;
        if (!row.device_display_name || !row.device_state || !row.fact_version || !row.device_updated_at) {
          throw new Error("Device facts row is incomplete");
        }
        devices.push({
          deviceId: row.device_id,
          providerId: row.provider_id,
          displayName: row.device_display_name,
          state: row.device_state,
          connectionState: "unknown",
          lastConfirmedAt: null,
          factVersion: Number(row.fact_version),
          updatedAt: row.device_updated_at.toISOString(),
        });
      }
      return listOperatorDeviceFactsResponseSchema.parse({
        readAt: readAt.toISOString(),
        providers: [...providers.values()],
        devices,
      });
    });
  }

  async createOperator(
    sessionToken: string,
    csrfToken: string,
    request: CreateOperatorRequest,
  ): Promise<CreateOperatorResponse> {
    const parsed = createOperatorRequestSchema.parse(request);
    await inTransaction(this.pool, (client) =>
      this.authenticateSessionInTransaction(client, sessionToken, csrfToken, true),
    );
    const passwordHash = await hashOperatorPassword(parsed.initialPassword);
    return inTransaction(this.pool, async (client) => {
      await client.query(`LOCK TABLE ${schema}.operators IN SHARE ROW EXCLUSIVE MODE`);
      const context = await this.authenticateSessionInTransaction(
        client,
        sessionToken,
        csrfToken,
        true,
      );
      const now = await databaseNow(client);
      const replay = await beginIdempotentRequest(
        client,
        "operator.create",
        context.operator.operatorId,
        parsed.metadata.idempotencyKey,
        payloadDigest(parsed),
        now,
      );
      if (replay) return createOperatorResponseSchema.parse(replay.response_body);

      const operatorId = randomUUID();
      try {
        const inserted = await client.query<OperatorRow>(
          `INSERT INTO ${schema}.operators (
             operator_id, login_name, display_name, password_hash, status,
             created_at, updated_at, password_changed_at
           ) VALUES ($1, $2, $3, $4, 'active', $5, $5, $5)
           RETURNING *`,
          [operatorId, parsed.loginName, parsed.displayName, passwordHash, now],
        );
        const response = createOperatorResponseSchema.parse({
          operator: operatorView(inserted.rows[0]!),
        });
        await writeAudit(
          client,
          "operator",
          context.operator.operatorId,
          "operator.created",
          operatorId,
          parsed.metadata.requestId,
          { loginName: parsed.loginName },
        );
        await completeIdempotentRequest(
          client,
          "operator.create",
          context.operator.operatorId,
          parsed.metadata.idempotencyKey,
          response,
          operatorId,
        );
        return response;
      } catch (error) {
        if (isUniqueViolation(error, "operators_login_name_key")) {
          throw new ProductTransactionError(
            "OPERATOR_ALREADY_EXISTS",
            "An operator with this login name already exists",
          );
        }
        throw error;
      }
    });
  }

  async disableOperator(
    sessionToken: string,
    csrfToken: string,
    request: DisableOperatorRequest,
  ): Promise<DisableOperatorResponse> {
    const parsed = disableOperatorRequestSchema.parse(request);
    return inTransaction(this.pool, async (client) => {
      await client.query(`LOCK TABLE ${schema}.operators IN SHARE ROW EXCLUSIVE MODE`);
      const context = await this.authenticateSessionInTransaction(
        client,
        sessionToken,
        csrfToken,
        true,
      );
      const now = await databaseNow(client);
      const replay = await beginIdempotentRequest(
        client,
        "operator.disable",
        context.operator.operatorId,
        parsed.metadata.idempotencyKey,
        payloadDigest(parsed),
        now,
      );
      if (replay) return disableOperatorResponseSchema.parse(replay.response_body);

      const target = await client.query<OperatorRow>(
        `SELECT * FROM ${schema}.operators WHERE operator_id = $1 FOR UPDATE`,
        [parsed.operatorId],
      );
      const operator = target.rows[0];
      if (!operator || Number(operator.fact_version) !== parsed.expectedFactVersion) {
        throw new ProductTransactionError(
          "FACT_VERSION_STALE",
          "Operator fact version is stale",
        );
      }
      if (operator.status === "disabled") {
        throw new ProductTransactionError("OPERATOR_DISABLED", "Operator is already disabled");
      }
      const active = await client.query<CountRow>(
        `SELECT count(*)::text AS count FROM ${schema}.operators WHERE status = 'active'`,
      );
      if (Number(active.rows[0]?.count ?? "0") <= 1) {
        throw new ProductTransactionError(
          "LAST_ACTIVE_OPERATOR",
          "The last active operator cannot be disabled",
        );
      }
      const updated = await client.query<OperatorRow>(
        `UPDATE ${schema}.operators
            SET status = 'disabled', disabled_at = $2, updated_at = $2,
                fact_version = fact_version + 1
          WHERE operator_id = $1
          RETURNING *`,
        [parsed.operatorId, now],
      );
      const revoked = await client.query(
        `UPDATE ${schema}.operator_sessions
            SET revoked_at = $2, revoked_reason = 'operator_disabled'
          WHERE operator_id = $1 AND revoked_at IS NULL`,
        [parsed.operatorId, now],
      );
      const response = disableOperatorResponseSchema.parse({
        operator: operatorView(updated.rows[0]!),
        revokedSessionCount: revoked.rowCount ?? 0,
      });
      await writeAudit(
        client,
        "operator",
        context.operator.operatorId,
        "operator.disabled",
        parsed.operatorId,
        parsed.metadata.requestId,
        { revokedSessionCount: response.revokedSessionCount },
      );
      await completeIdempotentRequest(
        client,
        "operator.disable",
        context.operator.operatorId,
        parsed.metadata.idempotencyKey,
        response,
        parsed.operatorId,
      );
      return response;
    });
  }

  async logout(sessionToken: string, csrfToken: string, requestId: string): Promise<void> {
    const parsedRequestId = requestIdSchema.parse(requestId);
    await inTransaction(this.pool, async (client) => {
      const context = await this.authenticateSessionInTransaction(
        client,
        sessionToken,
        csrfToken,
        true,
      );
      const now = await databaseNow(client);
      await client.query(
        `UPDATE ${schema}.operator_sessions
            SET revoked_at = $2, revoked_reason = 'logout'
          WHERE session_id = $1 AND revoked_at IS NULL`,
        [context.sessionId, now],
      );
      await writeAudit(
        client,
        "operator",
        context.operator.operatorId,
        "operator.logged_out",
        context.operator.operatorId,
        parsedRequestId,
        {},
      );
    });
  }

  async recoverOperator(input: RecoverOperatorInput): Promise<OperatorView> {
    const operatorId = uuidSchema.parse(input.operatorId);
    const requestId = requestIdSchema.parse(input.requestId);
    const newPassword = operatorPasswordSchema.parse(input.newPassword);
    const passwordHash = await hashOperatorPassword(newPassword);
    return inTransaction(this.pool, async (client) => {
      const now = await databaseNow(client);
      const updated = await client.query<OperatorRow>(
        `UPDATE ${schema}.operators
            SET password_hash = $2, credential_version = credential_version + 1,
                password_changed_at = $3, updated_at = $3,
                fact_version = fact_version + 1
          WHERE operator_id = $1
          RETURNING *`,
        [operatorId, passwordHash, now],
      );
      const operator = updated.rows[0];
      if (!operator) {
        throw new ProductTransactionError("INPUT_INVALID", "Operator does not exist");
      }
      const revoked = await client.query(
        `UPDATE ${schema}.operator_sessions
            SET revoked_at = $2, revoked_reason = 'credential_reset'
          WHERE operator_id = $1 AND revoked_at IS NULL`,
        [operatorId, now],
      );
      await writeAudit(
        client,
        "system",
        null,
        "operator.credential_reset",
        operatorId,
        requestId,
        { revokedSessionCount: revoked.rowCount ?? 0 },
      );
      return operatorView(operator);
    });
  }

  async authenticateSessionInTransaction(
    client: PoolClient,
    sessionToken: string,
    csrfToken?: string,
    requireCsrf = false,
  ): Promise<OperatorSessionContext> {
    const now = await databaseNow(client);
    const sessionDigest = /^[A-Za-z0-9_-]{43}$/.test(sessionToken)
      ? digest(sessionToken)
      : Buffer.alloc(32);
    const csrfDigest =
      csrfToken !== undefined && /^[A-Za-z0-9_-]{43}$/.test(csrfToken)
        ? digest(csrfToken)
        : requireCsrf || csrfToken !== undefined
          ? Buffer.alloc(32)
          : null;
    const lookup = await client.query<SessionLookupRow>(
      `SELECT session_id, operator_id
         FROM ${schema}.operator_sessions
        WHERE token_digest = $1
          AND ($2::bytea IS NULL OR csrf_digest = $2)`,
      [sessionDigest, csrfDigest],
    );
    const identity = lookup.rows[0];
    if (!identity) {
      throw new ProductTransactionError(
        "AUTHENTICATION_REQUIRED",
        "Operator session is invalid or expired",
      );
    }
    const operatorResult = await client.query<OperatorRow>(
      `SELECT * FROM ${schema}.operators WHERE operator_id = $1 FOR UPDATE`,
      [identity.operator_id],
    );
    const sessionResult = await client.query<OperatorSessionRow>(
      `SELECT session_id, credential_version::text AS credential_version,
              expires_at, revoked_at
         FROM ${schema}.operator_sessions
        WHERE session_id = $1 AND token_digest = $2
          AND ($3::bytea IS NULL OR csrf_digest = $3)
        FOR UPDATE`,
      [identity.session_id, sessionDigest, csrfDigest],
    );
    const operator = operatorResult.rows[0];
    const session = sessionResult.rows[0];
    if (
      !operator ||
      !session ||
      session.revoked_at !== null ||
      session.expires_at <= now ||
      operator.status !== "active" ||
      session.credential_version !== operator.credential_version
    ) {
      throw new ProductTransactionError(
        "AUTHENTICATION_REQUIRED",
        "Operator session is invalid or expired",
      );
    }
    return { operator: operatorView(operator), sessionId: session.session_id };
  }
}
