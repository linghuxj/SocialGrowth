import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
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
  listOperatorDeviceFactsResponseSchema,
  listProviderDevicesResponseSchema,
  listProviderDeviceAssistanceTodosResponseSchema,
  providerDeviceLabelResponseSchema,
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
  new URL("../migrations/0004_installation_bootstrap_admission.sql", import.meta.url),
  new URL("../migrations/0011_unassigned_device_todos.sql", import.meta.url),
  new URL("../migrations/0012_device_assistance_feed_index.sql", import.meta.url),
  new URL("../migrations/0013_device_assistance_notes_index.sql", import.meta.url),
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
    deviceLabel: "Owner's execution phone A",
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

  await pool.query(
    `UPDATE socialgrowth_product.devices
        SET state = 'paused', fact_version = fact_version + 1,
            updated_at = clock_timestamp()
      WHERE device_id = $1`,
    [confirmed.deviceId],
  );
  const stableReceiptResult = await post(
    "/api/provider/association-sessions/result",
    {
      metadata: metadata("association-http-query-after-state-change-0001"),
      associationSessionId: inspected.associationSessionId,
      expectedInstallationId: inspected.installation.installationId,
    },
    owner.token,
  );
  const stableReceipt = associationResultResponseSchema.parse(
    stableReceiptResult.body,
  );
  assert.equal(stableReceipt.status, "associated");
  if (stableReceipt.status === "associated") {
    assert.deepEqual(stableReceipt.result, confirmed);
  }

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
    ["Owner's execution phone A", "Execution Phone B"],
  );
  assert.equal("installationId" in (devices.devices[0] ?? {}), false);

  const currentDevice = devices.devices[0];
  assert.ok(currentDevice);
  const renameRequest = {
    metadata: metadata("association-http-device-label-0001"),
    expectedFactVersion: currentDevice.factVersion,
    displayName: "Renamed execution phone A",
  };
  const renamedResult = await post(`/api/provider/devices/${currentDevice.deviceId}/label`, renameRequest, owner.token);
  assert.equal(renamedResult.response.status, 201);
  const renamed = providerDeviceLabelResponseSchema.parse(renamedResult.body);
  assert.equal(renamed.device.displayName, renameRequest.displayName);
  assert.equal(renamed.device.factVersion, currentDevice.factVersion + 1);

  const replayedRename = await post(`/api/provider/devices/${currentDevice.deviceId}/label`, {
    ...renameRequest,
    metadata: { ...renameRequest.metadata, requestId: `request-${randomUUID()}` },
  }, owner.token);
  assert.deepEqual(providerDeviceLabelResponseSchema.parse(replayedRename.body), renamed);
  const changedPayload = await post(`/api/provider/devices/${currentDevice.deviceId}/label`, {
    ...renameRequest,
    displayName: "Changed payload",
  }, owner.token);
  assert.equal(changedPayload.response.status, 409);
  assert.equal(productErrorResponseSchema.parse(changedPayload.body).error.code, "IDEMPOTENCY_KEY_REUSED");

  const foreignRename = await post(`/api/provider/devices/${currentDevice.deviceId}/label`, {
    ...renameRequest,
    metadata: metadata("association-http-device-label-foreign-0001"),
  }, other.token);
  assert.equal(foreignRename.response.status, 403);
  assert.equal(productErrorResponseSchema.parse(foreignRename.body).error.code, "AUTHORIZATION_DENIED");
  const staleRename = await post(`/api/provider/devices/${currentDevice.deviceId}/label`, {
    ...renameRequest,
    expectedFactVersion: currentDevice.factVersion,
    metadata: metadata("association-http-device-label-stale-0001"),
  }, owner.token);
  assert.equal(staleRename.response.status, 409);
  assert.equal(productErrorResponseSchema.parse(staleRename.body).error.code, "FACT_VERSION_STALE");

  // Synthetic persisted journal rows exercise the existing provider feed over
  // HTTP; this is backend route evidence, not an upstream event-producer claim.
  const responsibleOperatorId = randomUUID();
  const todoId = randomUUID();
  await pool.query(
    `INSERT INTO socialgrowth_product.operators(operator_id,login_name,display_name,password_hash,status)
     VALUES($1,$2,'Assistance HTTP fixture','not-a-real-password','active')`,
    [responsibleOperatorId, `assistance-${responsibleOperatorId}`],
  );
  await pool.query(
    `INSERT INTO socialgrowth_product.device_assistance_todos(todo_id,occurrence_id,provider_id,initial_responsible_operator_id)
     VALUES($1,$2,$3,$4)`,
    [todoId, randomUUID(), owner.providerId, responsibleOperatorId],
  );
  await pool.query("INSERT INTO socialgrowth_product.device_assistance_notification_intents(todo_id) VALUES($1)", [todoId]);
  await pool.query(
    `INSERT INTO socialgrowth_product.device_assistance_impacts(todo_id,provider_id,device_id,association_id,recorded_device_version)
     VALUES($1,$2,$3,$4,$5)`,
    [todoId, owner.providerId, currentDevice.deviceId, confirmed.associationId, currentDevice.factVersion],
  );
  const ownFeedResponse = await fetch(`${baseUrl}/api/provider/assistance-todos`, {
    headers: { authorization: `Bearer ${owner.token}` },
  });
  assert.equal(ownFeedResponse.status, 200);
  assert.equal(ownFeedResponse.headers.get("cache-control"), "no-store");
  const ownFeed = listProviderDeviceAssistanceTodosResponseSchema.parse(await ownFeedResponse.json());
  assert.equal(ownFeed.todos.length, 1);
  assert.deepEqual(ownFeed.todos[0]?.impacts, [{
    deviceId: currentDevice.deviceId,
    deviceLabel: renameRequest.displayName,
    recordedDeviceVersion: currentDevice.factVersion,
  }]);
  const foreignFeedResponse = await fetch(`${baseUrl}/api/provider/assistance-todos`, {
    headers: { authorization: `Bearer ${other.token}` },
  });
  assert.equal(foreignFeedResponse.status, 200);
  assert.deepEqual(listProviderDeviceAssistanceTodosResponseSchema.parse(await foreignFeedResponse.json()).todos, []);

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

  const unauthenticatedFacts = await fetch(`${baseUrl}/api/operator/device-facts`);
  assert.equal(unauthenticatedFacts.status, 401);
  const operatorId = randomUUID();
  const operatorToken = randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO socialgrowth_product.operators (
       operator_id, login_name, display_name, password_hash, status
     ) VALUES ($1, $2, 'Facts Operator', 'test-only-hash', 'active')`,
    [operatorId, `operator-${operatorId}`],
  );
  await pool.query(
    `INSERT INTO socialgrowth_product.operator_sessions (
       session_id, operator_id, token_digest, csrf_digest,
       credential_version, expires_at
     ) VALUES ($1, $2, $3, $4, 1, clock_timestamp() + interval '1 day')`,
    [randomUUID(), operatorId,
      createHash("sha256").update(operatorToken).digest(),
      createHash("sha256").update(randomBytes(32)).digest()],
  );
  const operatorFactsResponse = await fetch(`${baseUrl}/api/operator/device-facts`, {
    headers: { cookie: `__Host-sg_operator_session=${operatorToken}` },
  });
  assert.equal(operatorFactsResponse.status, 200);
  assert.equal(operatorFactsResponse.headers.get("cache-control"), "no-store");
  const operatorFacts = listOperatorDeviceFactsResponseSchema.parse(
    await operatorFactsResponse.json(),
  );
  assert.equal(operatorFacts.providers.length, 2);
  assert.equal(operatorFacts.devices.length, 2);
  assert.ok(operatorFacts.devices.every((device) => device.providerId === owner.providerId));
  assert.ok(operatorFacts.devices.every((device) => device.connectionState === "unknown"));
  assert.ok(operatorFacts.devices.every((device) => device.lastConfirmedAt === null));
  assert.equal(JSON.stringify(operatorFacts).includes(installation.installation.installationId), false);

  await pool.query("UPDATE socialgrowth_product.device_associations SET ended_at=clock_timestamp() WHERE association_id=$1", [confirmed.associationId]);
  const formerOwnerFeedResponse = await fetch(`${baseUrl}/api/provider/assistance-todos`, {
    headers: { authorization: `Bearer ${owner.token}` },
  });
  const formerOwnerFeed = listProviderDeviceAssistanceTodosResponseSchema.parse(await formerOwnerFeedResponse.json());
  assert.deepEqual(formerOwnerFeed.todos[0]?.impacts, []);
});

test("public bootstrap is bounded by a database-backed source admission limit", async () => {
  await pool.query("DELETE FROM socialgrowth_product.installation_bootstrap_admissions");
  const before = await pool.query<{ installations: string }>(
    "SELECT count(*)::text AS installations FROM socialgrowth_product.installations",
  );
  for (let index = 0; index < 10; index += 1) {
    const result = await post("/api/installation/bootstrap", {
      metadata: metadata(`association-http-rate-admitted-${String(index).padStart(4, "0")}`),
      installationCredential: installationCredential(),
    });
    assert.equal(result.response.status, 201);
  }
  const limited = await post("/api/installation/bootstrap", {
    metadata: metadata("association-http-rate-limited-0010"),
    installationCredential: installationCredential(),
  });
  assert.equal(limited.response.status, 429);
  const error = productErrorResponseSchema.parse(limited.body);
  assert.equal(error.error.code, "INSTALLATION_BOOTSTRAP_RATE_LIMITED");
  assert.equal(error.error.retryable, true);
  const afterLimit = await pool.query<{
    admissions: string;
    installations: string;
  }>(
    `SELECT
       (SELECT count(*)::text FROM socialgrowth_product.installations) AS installations,
       (SELECT count(*)::text FROM socialgrowth_product.installation_bootstrap_admissions) AS admissions`,
  );
  assert.equal(afterLimit.rows[0]?.admissions, "10");
  assert.equal(
    Number(afterLimit.rows[0]?.installations) - Number(before.rows[0]?.installations),
    10,
  );
});
