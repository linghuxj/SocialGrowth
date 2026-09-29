import assert from "node:assert/strict";
import test from "node:test";

import { contractVersion } from "./common.js";
import { registerProviderRequestSchema } from "./invitation.js";
import {
  phoneVerificationChallengeResponseSchema,
  phoneVerificationResponseSchema,
  providerAuthResponseSchema,
  providerLoginRequestSchema,
  requestPhoneVerificationSchema,
  verifyPhoneCodeRequestSchema,
} from "./provider-auth.js";

const mutationMetadata = {
  contractVersion,
  requestId: "request-provider-auth-0001",
  idempotencyKey: "idempotency-provider-auth-0001",
};
const challengeId = "018f47ac-7a69-7db4-a572-8c62f3650191";
const verificationId = "018f47ac-7a69-7db4-a572-8c62f3650192";

test("registration and login challenges have distinct strict inputs", () => {
  const registration = requestPhoneVerificationSchema.parse({
    metadata: mutationMetadata,
    purpose: "provider_registration",
    phoneE164: "+8613800000001",
    invitationCode: "A".repeat(43),
  });
  const login = requestPhoneVerificationSchema.parse({
    metadata: mutationMetadata,
    purpose: "provider_login",
    phoneE164: "+8613800000001",
  });

  assert.equal(registration.purpose, "provider_registration");
  assert.equal(login.purpose, "provider_login");
  assert.equal(requestPhoneVerificationSchema.safeParse({ ...login, invitationCode: "A".repeat(43) }).success, false);
  assert.equal(requestPhoneVerificationSchema.safeParse({
    metadata: mutationMetadata,
    purpose: "provider_registration",
    phoneE164: "+8613800000001",
  }).success, false);
});

test("challenge responses promise acceptance rather than SMS delivery or verification", () => {
  const accepted = phoneVerificationChallengeResponseSchema.safeParse({
    challengeId,
    purpose: "provider_registration",
    phoneHint: "+86*******001",
    deliveryState: "accepted",
    resendAvailableAt: "2026-09-29T08:01:00.123456789Z",
    expiresAt: "2026-09-29T08:05:00.123456789Z",
  });
  const leakedPhone = phoneVerificationChallengeResponseSchema.safeParse({
    challengeId,
    purpose: "provider_registration",
    phoneHint: "+8613800000001",
    deliveryState: "accepted",
    resendAvailableAt: "2026-09-29T08:01:00Z",
    expiresAt: "2026-09-29T08:05:00Z",
  });
  const contradictory = phoneVerificationChallengeResponseSchema.safeParse({
    challengeId,
    purpose: "provider_registration",
    phoneHint: "+86*******001",
    deliveryState: "accepted",
    resendAvailableAt: "2026-09-29T08:05:00.000000001Z",
    expiresAt: "2026-09-29T08:05:00Z",
  });

  assert.equal(accepted.success, true);
  assert.equal(leakedPhone.success, false);
  assert.equal(contradictory.success, false);
});

test("verification codes allow provider-specific numeric lengths without fixing the UI to six digits", () => {
  for (const code of ["1234", "123456", "12345678"]) {
    assert.equal(verifyPhoneCodeRequestSchema.safeParse({ metadata: mutationMetadata, challengeId, code }).success, true);
  }
  for (const code of ["123", "123456789", "12A456"]) {
    assert.equal(verifyPhoneCodeRequestSchema.safeParse({ metadata: mutationMetadata, challengeId, code }).success, false);
  }
});

test("verified proofs bind a purpose and have a strictly later expiry", () => {
  const proof = {
    phoneVerificationId: verificationId,
    purpose: "provider_login",
    phoneHint: "+86*******001",
    verifiedAt: "2026-09-29T08:02:00.999999999Z",
    expiresAt: "2026-09-29T08:03:00Z",
  };
  assert.equal(phoneVerificationResponseSchema.safeParse(proof).success, true);
  assert.equal(phoneVerificationResponseSchema.safeParse({ ...proof, expiresAt: proof.verifiedAt }).success, false);
});

test("provider login accepts only a verified proof and auth responses keep the full phone absent", () => {
  assert.equal(providerLoginRequestSchema.safeParse({ metadata: mutationMetadata, phoneVerificationId: verificationId }).success, true);
  assert.equal(providerLoginRequestSchema.safeParse({
    metadata: mutationMetadata,
    phoneVerificationId: verificationId,
    invitationCode: "A".repeat(43),
  }).success, false);

  const response = {
    provider: {
      providerId: "018f47ac-7a69-7db4-a572-8c62f3650193",
      displayName: "设备提供者",
      phoneHint: "+86*******001",
      status: "active",
      createdAt: "2026-09-29T08:00:00Z",
      updatedAt: "2026-09-29T08:00:00Z",
    },
    session: {
      sessionId: "018f47ac-7a69-7db4-a572-8c62f3650194",
      createdAt: "2026-09-29T08:02:00Z",
      expiresAt: "2026-10-29T08:02:00Z",
    },
    sessionToken: "S".repeat(43),
  };
  assert.equal(providerAuthResponseSchema.safeParse(response).success, true);
  assert.equal(providerAuthResponseSchema.safeParse({
    ...response,
    provider: { ...response.provider, phoneE164: "+8613800000001" },
  }).success, false);
  assert.equal(providerAuthResponseSchema.safeParse({
    ...response,
    session: { ...response.session, expiresAt: response.session.createdAt },
  }).success, false);
});

test("first registration no longer requires a name field absent from the selected design", () => {
  assert.equal(registerProviderRequestSchema.safeParse({
    metadata: mutationMetadata,
    invitationCode: "A".repeat(43),
    phoneVerificationId: verificationId,
  }).success, true);
});
