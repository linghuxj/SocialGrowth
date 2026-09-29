import {
  createHash,
  createHmac,
  randomUUID,
} from "node:crypto";

import {
  bootstrapInstallationRequestSchema,
  installationAuthResponseSchema,
  type BootstrapInstallationRequest,
  type InstallationAuthResponse,
} from "@socialgrowth/product-contracts";
import type { Pool, PoolClient } from "pg";

import { ProductTransactionError } from "./product-transaction-error.js";

const schema = "socialgrowth_product";
const sessionLifetimeMilliseconds = 30 * 24 * 60 * 60 * 1000;
const installationSessionTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export interface InstallationBootstrapPolicy {
  globalLimit: number;
  perSourceLimit: number;
  windowMilliseconds: number;
}

const defaultBootstrapPolicy: InstallationBootstrapPolicy = {
  globalLimit: 1_000,
  perSourceLimit: 10,
  windowMilliseconds: 15 * 60 * 1000,
};

interface InstallationRow {
  installation_id: string;
  generation: string;
  status: "active" | "replaced" | "revoked";
  created_at: Date;
  updated_at: Date;
}

interface InstallationSessionRow {
  session_id: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

export interface AuthenticatedInstallation {
  installationGeneration: bigint;
  installationId: string;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function credentialDigest(pepper: string, credential: string): Buffer {
  return createHmac("sha256", pepper)
    .update(`installation-credential:${credential}`, "utf8")
    .digest();
}

function sessionToken(pepper: string, credential: string): string {
  return createHmac("sha256", pepper)
    .update(`installation-session:${credential}`, "utf8")
    .digest("base64url");
}

function bootstrapSourceDigest(pepper: string, sourceAddress: string): Buffer {
  return createHmac("sha256", pepper)
    .update(`installation-bootstrap-source:${sourceAddress}`, "utf8")
    .digest();
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

export class InstallationAuthService {
  constructor(
    private readonly pool: Pool,
    private readonly securityPepper: string,
    private readonly bootstrapPolicy: InstallationBootstrapPolicy =
      defaultBootstrapPolicy,
  ) {
    if (
      bootstrapPolicy.globalLimit < 1 ||
      bootstrapPolicy.perSourceLimit < 1 ||
      bootstrapPolicy.perSourceLimit > bootstrapPolicy.globalLimit ||
      bootstrapPolicy.windowMilliseconds < 1
    ) {
      throw new Error("Installation bootstrap policy is invalid");
    }
  }

  async bootstrap(
    input: BootstrapInstallationRequest,
    sourceAddress: string,
  ): Promise<InstallationAuthResponse> {
    const request = bootstrapInstallationRequestSchema.parse(input);
    if (sourceAddress.trim().length === 0 || sourceAddress.length > 128) {
      throw new ProductTransactionError(
        "AUTHORIZATION_DENIED",
        "Installation bootstrap source is unavailable",
      );
    }
    const rootDigest = credentialDigest(
      this.securityPepper,
      request.installationCredential,
    );
    const token = sessionToken(this.securityPepper, request.installationCredential);
    const tokenDigest = digest(token);
    const sourceDigest = bootstrapSourceDigest(this.securityPepper, sourceAddress);

    return inTransaction(this.pool, async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [rootDigest.toString("hex")],
      );
      let now = await databaseNow(client);
      const existingInstallation = await client.query<InstallationRow>(
        `SELECT installation_id, generation, status, created_at, updated_at
           FROM ${schema}.installations
          WHERE credential_digest = $1
          FOR UPDATE`,
        [rootDigest],
      );
      let installation = existingInstallation.rows[0];
      const createdNewInstallation = !installation;
      if (!installation) {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          ["installation-bootstrap-global"],
        );
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`installation-bootstrap-source:${sourceDigest.toString("hex")}`],
        );
        now = await databaseNow(client);
        const windowStart = new Date(
          now.getTime() - this.bootstrapPolicy.windowMilliseconds,
        );
        const counts = await client.query<{
          global_count: string;
          source_count: string;
        }>(
          `SELECT
             count(*)::text AS global_count,
             count(*) FILTER (WHERE source_digest = $1)::text AS source_count
             FROM ${schema}.installation_bootstrap_admissions
            WHERE admitted_at >= $2`,
          [sourceDigest, windowStart],
        );
        const count = counts.rows[0];
        if (
          !count ||
          Number(count.global_count) >= this.bootstrapPolicy.globalLimit ||
          Number(count.source_count) >= this.bootstrapPolicy.perSourceLimit
        ) {
          throw new ProductTransactionError(
            "INSTALLATION_BOOTSTRAP_RATE_LIMITED",
            "Installation bootstrap admission is temporarily limited",
            true,
          );
        }
        const installationId = randomUUID();
        const inserted = await client.query<InstallationRow>(
          `INSERT INTO ${schema}.installations (
             installation_id, credential_digest, generation, status,
             created_at, updated_at
           ) VALUES ($1, $2, 1, 'active', $3, $3)
           RETURNING installation_id, generation, status, created_at, updated_at`,
          [installationId, rootDigest, now],
        );
        installation = inserted.rows[0];
        await client.query(
          `INSERT INTO ${schema}.installation_bootstrap_admissions (
             admission_id, source_digest, installation_id, admitted_at
           ) VALUES ($1, $2, $3, $4)`,
          [randomUUID(), sourceDigest, installationId, now],
        );
      }
      if (!installation || installation.status !== "active") {
        throw new ProductTransactionError(
          "AUTHORIZATION_DENIED",
          "Installation identity is no longer active",
        );
      }

      const existingSession = await client.query<InstallationSessionRow>(
        `SELECT session_id, created_at, expires_at, revoked_at
           FROM ${schema}.installation_sessions
          WHERE token_digest = $1
          FOR UPDATE`,
        [tokenDigest],
      );
      let session = existingSession.rows[0];
      const expiresAt = new Date(now.getTime() + sessionLifetimeMilliseconds);
      if (!session) {
        const inserted = await client.query<InstallationSessionRow>(
          `INSERT INTO ${schema}.installation_sessions (
             session_id, installation_id, token_digest, expires_at, created_at
           ) VALUES ($1, $2, $3, $4, $5)
           RETURNING session_id, created_at, expires_at, revoked_at`,
          [randomUUID(), installation.installation_id, tokenDigest, expiresAt, now],
        );
        session = inserted.rows[0];
      } else if (session.revoked_at || session.expires_at <= now) {
        const refreshed = await client.query<InstallationSessionRow>(
          `UPDATE ${schema}.installation_sessions
              SET created_at = $2, expires_at = $3, revoked_at = NULL
            WHERE session_id = $1
          RETURNING session_id, created_at, expires_at, revoked_at`,
          [session.session_id, now, expiresAt],
        );
        session = refreshed.rows[0];
      }
      if (!session) throw new Error("Installation session was not persisted");

      if (createdNewInstallation) {
        await client.query(
          `INSERT INTO ${schema}.audit_records (
             audit_record_id, actor_type, actor_id, action, object_type,
             object_id, request_id, facts
           ) VALUES ($1, 'installation', $2, 'installation.created',
             'installation', $2, $3, $4)`,
          [
            randomUUID(),
            installation.installation_id,
            request.metadata.requestId,
            { generation: Number(installation.generation) },
          ],
        );
      }

      return installationAuthResponseSchema.parse({
        installation: {
          installationId: installation.installation_id,
          generation: Number(installation.generation),
          status: installation.status,
          createdAt: installation.created_at.toISOString(),
          updatedAt: installation.updated_at.toISOString(),
        },
        session: {
          sessionId: session.session_id,
          createdAt: session.created_at.toISOString(),
          expiresAt: session.expires_at.toISOString(),
        },
        sessionToken: token,
        createdNewInstallation,
      });
    });
  }

  async authenticate(sessionTokenValue: string): Promise<AuthenticatedInstallation> {
    if (!installationSessionTokenPattern.test(sessionTokenValue)) {
      throw new ProductTransactionError(
        "AUTHENTICATION_REQUIRED",
        "Installation bearer token is required",
      );
    }
    const result = await this.pool.query<{
      expires_at: Date;
      generation: string;
      installation_id: string;
      installation_status: string;
      revoked_at: Date | null;
      database_now: Date;
    }>(
      `SELECT i.installation_id, i.generation,
              i.status AS installation_status,
              s.expires_at, s.revoked_at,
              clock_timestamp() AS database_now
         FROM ${schema}.installation_sessions s
         JOIN ${schema}.installations i
           ON i.installation_id = s.installation_id
        WHERE s.token_digest = $1`,
      [digest(sessionTokenValue)],
    );
    const row = result.rows[0];
    if (
      !row ||
      row.revoked_at ||
      row.expires_at <= row.database_now ||
      row.installation_status !== "active"
    ) {
      throw new ProductTransactionError(
        "AUTHENTICATION_REQUIRED",
        "Installation session is invalid or expired",
      );
    }
    return {
      installationGeneration: BigInt(row.generation),
      installationId: row.installation_id,
    };
  }
}
