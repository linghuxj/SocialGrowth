import assert from "node:assert/strict";
import test from "node:test";

import { ProductTransactionError } from "./product-transaction-error.js";
import { DevelopmentSmsCapturePort } from "./sms-delivery.js";

test("development SMS capture requires its token and expires with the challenge", async () => {
  const token = "development-sms-token-with-at-least-32-bytes";
  let now = new Date("2026-09-29T10:00:00.000Z");
  const capture = new DevelopmentSmsCapturePort(token, () => now);
  const challengeId = "00000000-0000-4000-8000-000000000001";
  await capture.sendVerificationCode({
    challengeId,
    code: "123456",
    expiresAt: new Date("2026-09-29T10:05:00.000Z"),
    phoneE164: "+8613800000401",
    purpose: "provider_registration",
  });

  assert.throws(
    () => capture.readCode({ accessToken: "wrong-token", challengeId }),
    (error: unknown) =>
      error instanceof ProductTransactionError &&
      error.code === "AUTHORIZATION_DENIED",
  );
  assert.deepEqual(capture.readCode({ accessToken: token, challengeId }), {
    challengeId,
    code: "123456",
  });

  now = new Date("2026-09-29T10:05:00.000Z");
  assert.throws(
    () => capture.readCode({ accessToken: token, challengeId }),
    (error: unknown) =>
      error instanceof ProductTransactionError &&
      error.code === "PHONE_VERIFICATION_INVALID",
  );
});
