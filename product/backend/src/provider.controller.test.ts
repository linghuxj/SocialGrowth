import assert from "node:assert/strict";
import test from "node:test";

import { HttpException } from "@nestjs/common";
import {
  contractVersion,
  productErrorResponseSchema,
} from "@socialgrowth/product-contracts";

import type { IdentityTransactionService } from "./identity-transactions.js";
import type { ProviderAuthService } from "./provider-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { ProviderController } from "./provider.controller.js";

const metadata = {
  contractVersion,
  idempotencyKey: "provider-controller-0001",
  requestId: "request-provider-controller-0001",
};

test("provider HTTP routes parse strict requests and keep the session token explicit", async () => {
  const observed: unknown[] = [];
  const auth = {
    async requestVerification(input: unknown) {
      observed.push(input);
      return { challengeId: "challenge" };
    },
    async verifyCode(input: unknown) {
      observed.push(input);
      return { phoneVerificationId: "proof" };
    },
    async login(input: unknown) {
      observed.push(input);
      return { sessionToken: "S".repeat(43) };
    },
  } as unknown as ProviderAuthService;
  const identity = {
    async registerProvider(input: unknown, context: unknown) {
      observed.push({ context, input });
      return { providerId: "provider" };
    },
  } as unknown as IdentityTransactionService;
  const controller = new ProviderController(auth, identity);
  const phone = "+8613800000201";
  const invitationCode = "A".repeat(43);
  const challenge = await controller.requestVerification({
    metadata,
    purpose: "provider_registration",
    phoneE164: phone,
    invitationCode,
  });
  const proofId = "00000000-0000-4000-8000-000000000001";
  await controller.verifyCode({
    metadata,
    challengeId: "00000000-0000-4000-8000-000000000002",
    code: "123456",
  });
  await controller.register({ metadata, invitationCode, phoneVerificationId: proofId });
  const login = await controller.login({ metadata, phoneVerificationId: proofId });

  assert.deepEqual(challenge, { challengeId: "challenge" });
  assert.deepEqual(login, { sessionToken: "S".repeat(43) });
  assert.deepEqual(observed[2], {
    input: { metadata, invitationCode, phoneVerificationId: proofId },
    context: { verifiedPhoneVerificationId: proofId },
  });
});

test("provider HTTP maps unavailable SMS to retryable 503 without leaking causes", async () => {
  const auth = {
    async requestVerification() {
      throw new ProductTransactionError(
        "SMS_DELIVERY_UNAVAILABLE",
        "SMS delivery is not configured",
        true,
      );
    },
  } as unknown as ProviderAuthService;
  const controller = new ProviderController(auth, {} as IdentityTransactionService);

  await assert.rejects(
    controller.requestVerification({
      metadata,
      purpose: "provider_registration",
      phoneE164: "+8613800000202",
      invitationCode: "A".repeat(43),
    }),
    (error: unknown) => {
      if (!(error instanceof HttpException) || error.getStatus() !== 503) return false;
      const response = productErrorResponseSchema.parse(error.getResponse());
      return response.error.code === "SMS_DELIVERY_UNAVAILABLE" &&
        response.error.retryable;
    },
  );
});

test("provider HTTP rejects unsupported contracts before calling services", async () => {
  let called = false;
  const auth = {
    async login() {
      called = true;
      return {};
    },
  } as unknown as ProviderAuthService;
  const controller = new ProviderController(auth, {} as IdentityTransactionService);
  await assert.rejects(
    controller.login({
      metadata: { ...metadata, contractVersion: "old-contract" },
      phoneVerificationId: "00000000-0000-4000-8000-000000000001",
    }),
    (error: unknown) => {
      if (!(error instanceof HttpException)) return false;
      return productErrorResponseSchema.parse(error.getResponse()).error.code ===
        "CONTRACT_VERSION_UNSUPPORTED";
    },
  );
  assert.equal(called, false);
});
