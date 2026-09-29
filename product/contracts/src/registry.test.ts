import assert from "node:assert/strict";
import test from "node:test";

import { contractVersion } from "./common.js";
import { confirmAssociationRequestSchema } from "./association.js";
import { registerProviderRequestSchema } from "./invitation.js";
import { installationSelfViewSchema } from "./status.js";

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
    providerDisplayName: null,
    providerId: "018f47ac-7a69-7db4-a572-8c62f3650192",
    factVersion: 0,
    updatedAt: "2026-09-29T10:00:00+08:00",
  });

  assert.equal(rejected.success, false);
});
