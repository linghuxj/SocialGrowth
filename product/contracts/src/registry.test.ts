import assert from "node:assert/strict";
import test from "node:test";

import { contractVersion } from "./common.js";
import {
  associationQrPayloadSchema,
  confirmAssociationRequestSchema,
} from "./association.js";
import { registerProviderRequestSchema } from "./invitation.js";
import {
  installationSelfViewSchema,
  operatorDeviceViewSchema,
} from "./status.js";

const metadata = {
  contractVersion,
  requestId: "request-00000001",
  idempotencyKey: "idempotency-key-00000001",
};

test("registration accepts verification proof but rejects client-owned identity", () => {
  const accepted = registerProviderRequestSchema.safeParse({
    metadata,
    invitationCode: "invite-code-01",
    phoneVerificationId: "018f47ac-7a69-7db4-a572-8c62f3650191",
    displayName: "Provider A",
  });
  const rejected = registerProviderRequestSchema.safeParse({
    metadata,
    invitationCode: "invite-code-01",
    phoneVerificationId: "018f47ac-7a69-7db4-a572-8c62f3650191",
    displayName: "Provider A",
    providerId: "018f47ac-7a69-7db4-a572-8c62f3650192",
  });

  assert.equal(accepted.success, true);
  assert.equal(rejected.success, false);
});

test("association confirmation binds the scanned session to its expected installation", () => {
  const result = confirmAssociationRequestSchema.parse({
    metadata,
    associationSessionId: "018f47ac-7a69-7db4-a572-8c62f3650193",
    expectedInstallationId: "018f47ac-7a69-7db4-a572-8c62f3650194",
  });

  assert.equal(
    result.expectedInstallationId,
    "018f47ac-7a69-7db4-a572-8c62f3650194",
  );
});

test("installation status excludes provider and operator identifiers", () => {
  const rejected = installationSelfViewSchema.safeParse({
    installationId: "018f47ac-7a69-7db4-a572-8c62f3650194",
    deviceId: null,
    state: "unassociated",
    providerId: "018f47ac-7a69-7db4-a572-8c62f3650192",
    factVersion: 0,
    updatedAt: "2026-09-29T10:00:00+08:00",
  });

  assert.equal(rejected.success, false);
});

test("status views reject contradictory ownership facts", () => {
  const rejectedInstallation = installationSelfViewSchema.safeParse({
    installationId: "018f47ac-7a69-7db4-a572-8c62f3650194",
    deviceId: "018f47ac-7a69-7db4-a572-8c62f3650195",
    state: "unassociated",
    factVersion: 0,
    updatedAt: "2026-09-29T10:00:00+08:00",
  });
  const rejectedOperator = operatorDeviceViewSchema.safeParse({
    deviceId: "018f47ac-7a69-7db4-a572-8c62f3650195",
    installationId: "018f47ac-7a69-7db4-a572-8c62f3650194",
    providerId: "018f47ac-7a69-7db4-a572-8c62f3650192",
    state: "unassociated",
    lastObservedAt: null,
    factVersion: 0,
    updatedAt: "2026-09-29T10:00:00+08:00",
  });

  assert.equal(rejectedInstallation.success, false);
  assert.equal(rejectedOperator.success, false);
});

test("association QR payload is versioned and uses the fixed code format", () => {
  const accepted = associationQrPayloadSchema.safeParse({
    contractVersion,
    associationCode: `sgassoc_v1_${"A".repeat(43)}`,
  });
  const rejected = associationQrPayloadSchema.safeParse({
    contractVersion,
    associationCode: "unversioned-code",
  });

  assert.equal(accepted.success, true);
  assert.equal(rejected.success, false);
});
