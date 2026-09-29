import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";

import { NestFactory, type NestApplication } from "@nestjs/core";
import {
  associationResultResponseSchema,
  associationSessionViewSchema,
  confirmAssociationResponseSchema,
  contractVersion,
  createAssociationSessionResponseSchema,
  installationAuthResponseSchema,
  installationSelfViewSchema,
  listProviderDevicesResponseSchema,
  productErrorResponseSchema,
} from "@socialgrowth/product-contracts";
import { Pool } from "pg";

import { AppModule } from "./app.module.js";
import { ProductExceptionFilter } from "./product-exception.filter.js";

const databaseUrl = process.env.SG_PRODUCT_TEST_DATABASE_URL;
if (!databaseUrl || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1") {
  throw new Error(
    "Association HTTP integration test requires SG_PRODUCT_TEST_DATABASE_URL and SG_PRODUCT_TEST_ALLOW_RESET=1",
  );
}

const pool = new Pool({ connectionString: databaseUrl, max: 8 });
const pepper = "test-association-http-pepper-000000000000000001";
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
] as const;
const previousEnvironment = Object.fromEntries(
  configuredEnvironment.map((name) => [name, process.env[name]]),
) as Record<(typeof configuredEnvironment)[number], string | undefined>;

function metadata(idempotencyKey: string) {
  return {
    contractVersion,
    idempotencyKey,
    requestId: `request-${randomUUID()}`,
  };
}

function installationCredential(): string {
  return `sginst_v1_${randomBytes(32).toString("base64url")}`;
}

function providerTokenDigest(token: string): Buffer {
  return createHmac("sha256", pepper).update(token, "utf8").digest();
}

let nextProviderPhone = 1;

async function seedProvider(label: string): Promise<{
  providerId: string;
  token: string;
}> {
  const providerId = randomUUID();
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO socialgrowth_product.providers (
       provider_id, phone_e164, display_name, status
     ) VALUES ($1, $2, $3, 'active')`,
    [providerId, `+861390000${String(nextProviderPhone).padStart(4, "0")}`, label],
  );
  nextProviderPhone += 1;
  await pool.query(
    `INSERT INTO socialgrowth_product.provider_sessions (
       session_id, provider_id, token_digest, expires_at
     ) VALUES ($1, $2, $3, clock_timestamp() + interval '1 day')`,
    [randomUUID(), providerId, providerTokenDigest(token)],
  );
  return { providerId, token };
}

async function post(
  path: string,
  body: unknown,
  token?: string,
): Promise<{ body: unknown; response: Response }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
  return { body: await response.json(), response };
}

before(async () => {
  await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE");
  for (const migrationUrl of migrationUrls) {
    await pool.query(await readFile(migrationUrl, "utf8"));
  }
  process.env.SG_PRODUCT_AUTH_PEPPER = pepper;
  process.env.SG_PRODUCT_BACKEND_HOST = "127.0.0.1";
  process.env.SG_PRODUCT_DATABASE_URL = databaseUrl;
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

test("real HTTP keeps scan read-only and supports confirmation recovery and multi-device views", async () => {
  const owner = await seedProvider("Owner Provider");
  const other = await seedProvider("Other Provider");
  const credential = installationCredential();
  const bootstrapResult = await post("/api/installation/bootstrap", {
    metadata: metadata("association-http-bootstrap-0001"),
    installationCredential: credential,
  });
  assert.equal(bootstrapResult.response.status, 201);
  const installation = installationAuthResponseSchema.parse(bootstrapResult.body);
  assert.equal(installation.createdNewInstallation, true);

  const deniedCreate = await post("/api/installation/association-sessions", {
    metadata: metadata("association-http-denied-create-0001"),
    deviceLabel: "Execution Phone A",
  });
  assert.equal(deniedCreate.response.status, 401);
  assert.equal(
    productErrorResponseSchema.parse(deniedCreate.body).error.code,
    "AUTHENTICATION_REQUIRED",
  );

  const initialState = await post(
    "/api/installation/state",
    { metadata: metadata("association-http-initial-state-0001") },
    installation.sessionToken,
  );
  assert.deepEqual(installationSelfViewSchema.parse(initialState.body), {
    installationId: installation.installation.installationId,
    deviceId: null,
    state: "unassociated",
    factVersion: 0,
    updatedAt: installation.installation.updatedAt,
  });

  const createResult = await post(
    "/api/installation/association-sessions",
    {
      metadata: metadata("association-http-create-session-0001"),
      deviceLabel: "Execution Phone A",
    },
    installation.sessionToken,
  );
  assert.equal(createResult.response.status, 201);
  const associationSession = createAssociationSessionResponseSchema.parse(
    createResult.body,
  );

  const inspectResult = await post(
    "/api/provider/association-sessions/inspect",
    {
      metadata: metadata("association-http-inspect-0001"),
      associationCode: associationSession.associationCode,
    },
    owner.token,
  );
  assert.equal(inspectResult.response.status, 201);
  const inspected = associationSessionViewSchema.parse(inspectResult.body);
  assert.equal(inspected.installation.deviceLabel, "Execution Phone A");
  assert.equal(inspected.installation.installationId, installation.installation.installationId);

  const beforeConfirm = await pool.query<{ associations: string; devices: string }>(
    `SELECT
       (SELECT count(*)::text FROM socialgrowth_product.device_associations) AS associations,
       (SELECT count(*)::text FROM socialgrowth_product.devices) AS devices`,
  );
  assert.deepEqual(beforeConfirm.rows[0], { associations: "0", devices: "0" });

  const rescannedResult = await post(
    "/api/provider/association-sessions/inspect",
    {
      metadata: metadata("association-http-rescan-0001"),
      associationCode: associationSession.associationCode,
    },
    owner.token,
  );
  assert.deepEqual(
    associationSessionViewSchema.parse(rescannedResult.body),
    inspected,
  );

  const pendingResult = await post(
    "/api/provider/association-sessions/result",
    {
      metadata: metadata("association-http-query-pending-0001"),
      associationSessionId: inspected.associationSessionId,
      expectedInstallationId: inspected.installation.installationId,
    },
    owner.token,
  );
  assert.equal(
    associationResultResponseSchema.parse(pendingResult.body).status,
    "pending",
  );

  const confirmRequest = {
    metadata: metadata("association-http-confirm-0001"),
    associationSessionId: inspected.associationSessionId,
    expectedInstallationId: inspected.installation.installationId,
  };
  const confirmResult = await post(
    "/api/provider/association-sessions/confirm",
    confirmRequest,
    owner.token,
  );
  assert.equal(confirmResult.response.status, 201);
  const confirmed = confirmAssociationResponseSchema.parse(confirmResult.body);
  assert.equal(confirmed.providerId, owner.providerId);

  const recoveredConfirm = await post(
    "/api/provider/association-sessions/confirm",
    {
      ...confirmRequest,
      metadata: { ...confirmRequest.metadata, requestId: `request-${randomUUID()}` },
    },
    owner.token,
  );
  assert.deepEqual(
    confirmAssociationResponseSchema.parse(recoveredConfirm.body),
    confirmed,
  );

  const queryConfirmed = await post(
    "/api/provider/association-sessions/result",
    {
      metadata: metadata("association-http-query-confirmed-0001"),
      associationSessionId: inspected.associationSessionId,
      expectedInstallationId: inspected.installation.installationId,
    },
    owner.token,
  );
  const associatedResult = associationResultResponseSchema.parse(queryConfirmed.body);
  assert.equal(associatedResult.status, "associated");
  if (associatedResult.status === "associated") {
    assert.deepEqual(associatedResult.result, confirmed);
  }

  const deniedOtherResult = await post(
    "/api/provider/association-sessions/result",
    {
      metadata: metadata("association-http-query-other-0001"),
      associationSessionId: inspected.associationSessionId,
      expectedInstallationId: inspected.installation.installationId,
    },
    other.token,
  );
  assert.equal(deniedOtherResult.response.status, 403);
  assert.equal(
    productErrorResponseSchema.parse(deniedOtherResult.body).error.code,
    "AUTHORIZATION_DENIED",
  );

  const consumedScan = await post(
    "/api/provider/association-sessions/inspect",
    {
      metadata: metadata("association-http-consumed-scan-0001"),
      associationCode: associationSession.associationCode,
    },
    other.token,
  );
  assert.equal(consumedScan.response.status, 400);
  assert.equal(
    productErrorResponseSchema.parse(consumedScan.body).error.code,
    "ASSOCIATION_SESSION_EXPIRED",
  );

  const otherConfirm = await post(
    "/api/provider/association-sessions/confirm",
    {
      metadata: metadata("association-http-other-confirm-0001"),
      associationSessionId: inspected.associationSessionId,
      expectedInstallationId: inspected.installation.installationId,
    },
    other.token,
  );
  assert.equal(otherConfirm.response.status, 409);
  assert.equal(
    productErrorResponseSchema.parse(otherConfirm.body).error.code,
    "ASSOCIATION_SESSION_CONSUMED",
  );

  const duplicateSession = await post(
    "/api/installation/association-sessions",
    {
      metadata: metadata("association-http-duplicate-session-0001"),
      deviceLabel: "Execution Phone A",
    },
    installation.sessionToken,
  );
  assert.equal(duplicateSession.response.status, 409);
  assert.equal(
    productErrorResponseSchema.parse(duplicateSession.body).error.code,
    "DEVICE_ALREADY_ASSOCIATED",
  );

  const finalStateResult = await post(
    "/api/installation/state",
    { metadata: metadata("association-http-final-state-0001") },
    installation.sessionToken,
  );
  const finalState = installationSelfViewSchema.parse(finalStateResult.body);
  assert.equal(finalState.deviceId, confirmed.deviceId);
  assert.equal(finalState.state, "associated_pending_access");

  const secondBootstrapResult = await post("/api/installation/bootstrap", {
    metadata: metadata("association-http-bootstrap-second-0001"),
    installationCredential: installationCredential(),
  });
  const secondInstallation = installationAuthResponseSchema.parse(
    secondBootstrapResult.body,
  );
  const secondCreateResult = await post(
    "/api/installation/association-sessions",
    {
      metadata: metadata("association-http-create-session-second-0001"),
      deviceLabel: "Execution Phone B",
    },
    secondInstallation.sessionToken,
  );
  const secondSession = createAssociationSessionResponseSchema.parse(
    secondCreateResult.body,
  );
  const secondInspectResult = await post(
    "/api/provider/association-sessions/inspect",
    {
      metadata: metadata("association-http-inspect-second-0001"),
      associationCode: secondSession.associationCode,
    },
    owner.token,
  );
  const secondInspected = associationSessionViewSchema.parse(secondInspectResult.body);
  const secondConfirmResult = await post(
    "/api/provider/association-sessions/confirm",
    {
      metadata: metadata("association-http-confirm-second-0001"),
      associationSessionId: secondInspected.associationSessionId,
      expectedInstallationId: secondInspected.installation.installationId,
    },
    owner.token,
  );
  const secondConfirmed = confirmAssociationResponseSchema.parse(
    secondConfirmResult.body,
  );
  assert.notEqual(secondConfirmed.deviceId, confirmed.deviceId);

  const devicesResult = await post(
    "/api/provider/devices/list",
    { metadata: metadata("association-http-list-devices-0001") },
    owner.token,
  );
  const devices = listProviderDevicesResponseSchema.parse(devicesResult.body);
  assert.deepEqual(
    devices.devices.map((device) => device.displayName),
    ["Execution Phone A", "Execution Phone B"],
  );
  assert.equal("installationId" in (devices.devices[0] ?? {}), false);

  const facts = await pool.query<{
    associations: string;
    devices: string;
    installations: string;
    sessions: string;
  }>(
    `SELECT
       (SELECT count(*)::text FROM socialgrowth_product.installations) AS installations,
       (SELECT count(*)::text FROM socialgrowth_product.installation_sessions) AS sessions,
       (SELECT count(*)::text FROM socialgrowth_product.devices) AS devices,
       (SELECT count(*)::text FROM socialgrowth_product.device_associations) AS associations`,
  );
  assert.deepEqual(facts.rows[0], {
    associations: "2",
    devices: "2",
    installations: "2",
    sessions: "2",
  });
});
