import assert from "node:assert/strict";
import test from "node:test";

import { contractVersion } from "./common.js";
import {
  associationQrPayloadSchema,
  confirmAssociationRequestSchema,
} from "./association.js";
import { registerProviderRequestSchema } from "./invitation.js";
import {
  createOperatorRequestSchema,
  disableOperatorResponseSchema,
  operatorLoginResponseSchema,
  operatorLoginRequestSchema,
  operatorViewSchema,
} from "./operator.js";
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

test("operator login requires canonical identifiers and rejects client-owned identity", () => {
  const accepted = operatorLoginRequestSchema.parse({
    metadata: { contractVersion, requestId: "request-operator-login-0001" },
    loginName: "operator.one",
    password: "long-enough-password",
  });
  const rejected = operatorLoginRequestSchema.safeParse({
    metadata: { contractVersion, requestId: "request-operator-login-0001" },
    loginName: "operator.one",
    password: "long-enough-password",
    operatorId: "018f47ac-7a69-7db4-a572-8c62f3650191",
  });
  const nonCanonical = operatorLoginRequestSchema.safeParse({
    metadata: { contractVersion, requestId: "request-operator-login-0002" },
    loginName: "Operator.One",
    password: "long-enough-password",
  });

  assert.equal(accepted.loginName, "operator.one");
  assert.equal(rejected.success, false);
  assert.equal(nonCanonical.success, false);
});

test("operator account responses keep passwords write-only and status consistent", () => {
  const create = createOperatorRequestSchema.parse({
    metadata,
    loginName: "operator.two",
    displayName: "Operator Two",
    initialPassword: "another-long-password",
  });
  const leakedPassword = operatorViewSchema.safeParse({
    operatorId: "018f47ac-7a69-7db4-a572-8c62f3650191",
    loginName: create.loginName,
    displayName: create.displayName,
    status: "active",
    factVersion: 0,
    createdAt: "2026-09-29T10:00:00+08:00",
    updatedAt: "2026-09-29T10:00:00+08:00",
    disabledAt: null,
    password: create.initialPassword,
  });
  const contradictory = operatorViewSchema.safeParse({
    operatorId: "018f47ac-7a69-7db4-a572-8c62f3650191",
    loginName: create.loginName,
    displayName: create.displayName,
    status: "disabled",
    factVersion: 1,
    createdAt: "2026-09-29T10:00:00+08:00",
    updatedAt: "2026-09-29T10:01:00+08:00",
    disabledAt: null,
  });
  const paddedDisplayName = createOperatorRequestSchema.safeParse({
    metadata,
    loginName: "operator.three",
    displayName: " Operator Three ",
    initialPassword: "another-long-password",
  });
  const unicodePaddedDisplayName = createOperatorRequestSchema.safeParse({
    metadata,
    loginName: "operator.four",
    displayName: "\u00a0Operator Four",
    initialPassword: "another-long-password",
  });

  assert.equal(leakedPassword.success, false);
  assert.equal(contradictory.success, false);
  assert.equal(paddedDisplayName.success, false);
  assert.equal(unicodePaddedDisplayName.success, false);
});

test("operator action responses fix the resulting account status", () => {
  const baseOperator = {
    operatorId: "018f47ac-7a69-7db4-a572-8c62f3650191",
    loginName: "operator.one",
    displayName: "Operator One",
    factVersion: 1,
    createdAt: "2026-09-29T10:00:00+08:00",
    updatedAt: "2026-09-29T10:01:00+08:00",
  };
  const disabledLogin = operatorLoginResponseSchema.safeParse({
    operator: {
      ...baseOperator,
      status: "disabled",
      disabledAt: "2026-09-29T10:01:00+08:00",
    },
    session: {
      sessionId: "018f47ac-7a69-7db4-a572-8c62f3650192",
      createdAt: "2026-09-29T10:01:00+08:00",
      expiresAt: "2026-09-29T18:01:00+08:00",
    },
    csrfToken: "A".repeat(43),
  });
  const activeDisable = disableOperatorResponseSchema.safeParse({
    operator: { ...baseOperator, status: "active", disabledAt: null },
    revokedSessionCount: 1,
  });

  assert.equal(disabledLogin.success, false);
  assert.equal(activeDisable.success, false);
});
