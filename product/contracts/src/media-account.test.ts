import assert from "node:assert/strict";
import test from "node:test";
import { contractVersion } from "./common.js";
import {
  accountAssignmentRequestSchema,
  createMediaAccountRequestSchema,
  mediaAccountCommandLookupResponseSchema,
  mediaAccountListResponseSchema,
  resourceCommandLookupResponseSchema,
  resourceHandoverResponseSchema,
  updateMediaAccountRequestSchema,
} from "./media-account.js";

const id = "a0000000-0000-4000-8000-000000000001";
const metadata = { contractVersion, requestId: "request-media-account", idempotencyKey: "media_account_intent_1" };
const account = {
  accountId: id, platform: "facebook", displayName: "Company Facebook", loginIdentifier: "ops@example.invalid",
  canonicalAccountRef: null, legacyDeclaredCanonicalAccountRef: null, persona: null,
  credential: { credentialId: id, revision: 1, state: "stored_unverified" },
  parentLoginVerification: "registered_unverified", publishingIdentities: [], reservation: null,
};

test("R159 company account request requires login and password while allowing canonical identity to remain unknown", () => {
  const request = { metadata, expectedResourceVersion: 0, platform: "facebook", displayName: "Company Facebook",
    loginIdentifier: "ops@example.invalid", password: "synthetic only", persona: undefined };
  assert.ok(createMediaAccountRequestSchema.safeParse(request).success);
  assert.equal(createMediaAccountRequestSchema.safeParse({ ...request, password: "" }).success, false);
  assert.equal(createMediaAccountRequestSchema.safeParse({ ...request, loginIdentifier: "" }).success, false);
  assert.equal(createMediaAccountRequestSchema.safeParse({ ...request, loginIdentifier: ` ${"a".repeat(310)} ` }).success, false);
  assert.ok(createMediaAccountRequestSchema.safeParse({ ...request, loginIdentifier: "a".repeat(320) }).success);
  assert.equal(createMediaAccountRequestSchema.safeParse({ ...request, loginIdentifier: "a\u0000b" }).success, false);
  assert.equal(createMediaAccountRequestSchema.safeParse({ ...request, canonicalAccountRef: "fake-parent-ref" }).success, false);
});

test("account list and profile response never admit secrets or client verification claims", () => {
  const response = { contractVersion, resourceVersion: 1, accounts: [account] };
  assert.ok(mediaAccountListResponseSchema.safeParse(response).success);
  assert.ok(mediaAccountListResponseSchema.safeParse({ ...response, accounts: [{ ...account, loginIdentifier: null,
    legacyDeclaredCanonicalAccountRef: "old_declared_ref", canonicalAccountRef: null, credential: null }] }).success);
  for (const extra of [{ password: "forbidden" }, { payloadBase64: "forbidden" }, { envelope: {} }, { verificationEvidence: "caller" }]) {
    assert.equal(mediaAccountListResponseSchema.safeParse({ ...response, accounts: [{ ...account, ...extra }] }).success, false);
  }
  assert.equal(mediaAccountListResponseSchema.safeParse({ ...response, accounts: [{ ...account, parentLoginVerification: "verified" }] }).success, false);
  assert.ok(mediaAccountListResponseSchema.safeParse({ ...response, accounts: [{ ...account, canonicalAccountRef: "historically_verified_parent" }] }).success);
  assert.ok(updateMediaAccountRequestSchema.safeParse({ metadata, expectedResourceVersion: 1, displayName: "Renamed", persona: null }).success);
  assert.equal(updateMediaAccountRequestSchema.safeParse({ metadata, expectedResourceVersion: 1, displayName: "Renamed", persona: null, loginIdentifier: "other" }).success, false);
});

test("account assignment rejects duplicate IDs and command lookup is finite and secret-free", () => {
  const assignment = { metadata, expectedResourceVersion: 1, expectedProjectVersion: 1, expectedDeviceVersion: 1,
    projectId: id, deviceId: id, accountIds: [id] };
  assert.ok(accountAssignmentRequestSchema.safeParse(assignment).success);
  assert.equal(accountAssignmentRequestSchema.safeParse({ ...assignment, accountIds: [id, id] }).success, false);
  assert.ok(mediaAccountCommandLookupResponseSchema.safeParse({ contractVersion, state: "not_found" }).success);
  assert.ok(resourceCommandLookupResponseSchema.safeParse({ contractVersion, state: "applied", commandKind: "handover_request", accountId: id, resourceVersion: 1 }).success);
  assert.equal(mediaAccountCommandLookupResponseSchema.safeParse({ contractVersion, state: "applied", commandKind: "account_create", accountId: id, resourceVersion: 1, password: "forbidden" }).success, false);
  assert.ok(resourceHandoverResponseSchema.safeParse({ contractVersion, resourceVersion: 1, handoverId: id, state: "blocked",
    reason: "trusted_old_stop_unavailable", currentAssignments: [], actionPermissionGranted: false, publicationAllowed: false }).success);
});
