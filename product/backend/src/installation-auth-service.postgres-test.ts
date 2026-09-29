import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";

import { contractVersion } from "@socialgrowth/product-contracts";
import { Pool } from "pg";

import { InstallationAuthService } from "./installation-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";

const databaseUrl = process.env.SG_PRODUCT_TEST_DATABASE_URL;
if (!databaseUrl || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1") {
  throw new Error(
    "PostgreSQL integration test requires SG_PRODUCT_TEST_DATABASE_URL and SG_PRODUCT_TEST_ALLOW_RESET=1",
  );
}

const pool = new Pool({ connectionString: databaseUrl, max: 4 });
const pepper = "test-installation-auth-pepper-0000000000000001";
const service = new InstallationAuthService(pool, pepper);
const migrationUrls = [
  new URL("../migrations/0001_identity_and_device.sql", import.meta.url),
  new URL("../migrations/0002_provider_phone_auth.sql", import.meta.url),
  new URL("../migrations/0003_provider_auth_recovery.sql", import.meta.url),
];

function credential(): string {
  return `sginst_v1_${randomBytes(32).toString("base64url")}`;
}

function metadata(key: string) {
  return {
    contractVersion,
    idempotencyKey: key,
    requestId: `request-${randomUUID()}`,
  };
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

test("bootstrap replay returns one installation and one recoverable session", async () => {
  const installationCredential = credential();
  const first = await service.bootstrap({
    metadata: metadata("installation-bootstrap-replay-0001"),
    installationCredential,
  });
  const replay = await service.bootstrap({
    metadata: metadata("installation-bootstrap-replay-0002"),
    installationCredential,
  });

  assert.equal(first.createdNewInstallation, true);
  assert.equal(replay.createdNewInstallation, false);
  assert.equal(replay.installation.installationId, first.installation.installationId);
  assert.equal(replay.session.sessionId, first.session.sessionId);
  assert.equal(replay.sessionToken, first.sessionToken);
  assert.deepEqual(await service.authenticate(first.sessionToken), {
    installationGeneration: 1n,
    installationId: first.installation.installationId,
  });

  const facts = await pool.query<{
    audits: string;
    installations: string;
    sessions: string;
    plaintext_credentials: string;
    plaintext_tokens: string;
  }>(
    `SELECT
       (SELECT count(*)::text FROM socialgrowth_product.installations) AS installations,
       (SELECT count(*)::text FROM socialgrowth_product.installation_sessions) AS sessions,
       (SELECT count(*)::text FROM socialgrowth_product.audit_records
         WHERE action = 'installation.created') AS audits,
       (SELECT count(*)::text FROM socialgrowth_product.installations
         WHERE encode(credential_digest, 'hex') LIKE '%' || encode(convert_to($1, 'UTF8'), 'hex') || '%') AS plaintext_credentials,
       (SELECT count(*)::text FROM socialgrowth_product.installation_sessions
         WHERE encode(token_digest, 'hex') LIKE '%' || encode(convert_to($2, 'UTF8'), 'hex') || '%') AS plaintext_tokens`,
    [installationCredential, first.sessionToken],
  );
  assert.deepEqual(facts.rows[0], {
    audits: "1",
    installations: "1",
    sessions: "1",
    plaintext_credentials: "0",
    plaintext_tokens: "0",
  });
});

test("concurrent bootstrap requests serialize to one installation", async () => {
  const installationCredential = credential();
  const [left, right] = await Promise.all([
    service.bootstrap({
      metadata: metadata("installation-bootstrap-race-left-0001"),
      installationCredential,
    }),
    service.bootstrap({
      metadata: metadata("installation-bootstrap-race-right-0001"),
      installationCredential,
    }),
  ]);

  assert.equal(left.installation.installationId, right.installation.installationId);
  assert.equal(left.session.sessionId, right.session.sessionId);
  assert.equal(Number(left.createdNewInstallation) + Number(right.createdNewInstallation), 1);
});

test("a lost root credential creates a new identity and never reclaims the old one", async () => {
  const oldIdentity = await service.bootstrap({
    metadata: metadata("installation-old-identity-0001"),
    installationCredential: credential(),
  });
  const reinstalled = await service.bootstrap({
    metadata: metadata("installation-reinstalled-identity-0001"),
    installationCredential: credential(),
  });

  assert.notEqual(
    reinstalled.installation.installationId,
    oldIdentity.installation.installationId,
  );
  const associations = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM socialgrowth_product.device_associations
      WHERE installation_id = $1`,
    [reinstalled.installation.installationId],
  );
  assert.equal(associations.rows[0]?.count, "0");
});

test("revoked or replaced installation cannot use an old session", async () => {
  const auth = await service.bootstrap({
    metadata: metadata("installation-revoked-identity-0001"),
    installationCredential: credential(),
  });
  await pool.query(
    `UPDATE socialgrowth_product.installations
        SET status = 'replaced', generation = generation + 1,
            updated_at = clock_timestamp()
      WHERE installation_id = $1`,
    [auth.installation.installationId],
  );

  await assert.rejects(
    service.authenticate(auth.sessionToken),
    (error: unknown) =>
      error instanceof ProductTransactionError &&
      error.code === "AUTHENTICATION_REQUIRED",
  );
});
