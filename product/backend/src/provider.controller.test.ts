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
    async completeRegistrationSession(input: unknown) {
      observed.push({ completeRegistrationSession: input });
      return {
        provider: {
          providerId: "00000000-0000-4000-8000-000000000010",
          displayName: "设备提供者",
          phoneHint: "+86*******201",
          status: "active",
          createdAt: "2026-09-29T00:00:00Z",
          updatedAt: "2026-09-29T00:00:00Z",
        },
        session: {
          sessionId: "00000000-0000-4000-8000-000000000011",
          createdAt: "2026-09-29T00:00:00Z",
          expiresAt: "2026-10-29T00:00:00Z",
        },
        sessionToken: "R".repeat(43),
      };
    },
  } as unknown as ProviderAuthService;
  const identity = {
    async registerProvider(input: unknown, context: unknown) {
      observed.push({ context, input });
      return {
        providerId: "00000000-0000-4000-8000-000000000010",
        invitationId: "00000000-0000-4000-8000-000000000012",
        registeredAt: "2026-09-29T00:00:00Z",
      };
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
  const registration = await controller.register({ metadata, invitationCode, phoneVerificationId: proofId });
  const login = await controller.login({ metadata, phoneVerificationId: proofId });

  assert.deepEqual(challenge, { challengeId: "challenge" });
  assert.deepEqual(login, { sessionToken: "S".repeat(43) });
  assert.deepEqual(registration, {
    registration: {
      providerId: "00000000-0000-4000-8000-000000000010",
      invitationId: "00000000-0000-4000-8000-000000000012",
      registeredAt: "2026-09-29T00:00:00Z",
    },
    provider: {
      providerId: "00000000-0000-4000-8000-000000000010",
      displayName: "设备提供者",
      phoneHint: "+86*******201",
      status: "active",
      createdAt: "2026-09-29T00:00:00Z",
      updatedAt: "2026-09-29T00:00:00Z",
    },
    session: {
      sessionId: "00000000-0000-4000-8000-000000000011",
      createdAt: "2026-09-29T00:00:00Z",
      expiresAt: "2026-10-29T00:00:00Z",
    },
    sessionToken: "R".repeat(43),
  });
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

test("provider logout requires an explicit bearer token and forwards the request identity", async () => {
  const observed: unknown[] = [];
  const auth = {
    async logout(token: string, requestId: string) {
      observed.push({ requestId, token });
      return { loggedOutAt: "2026-09-29T00:00:00Z" };
    },
  } as unknown as ProviderAuthService;
  const controller = new ProviderController(auth, {} as IdentityTransactionService);
  await assert.rejects(
    controller.logout({ metadata }),
    (error: unknown) => error instanceof HttpException && error.getStatus() === 401,
  );
  const token = "L".repeat(43);
  assert.deepEqual(
    await controller.logout({ metadata }, `Bearer ${token}`),
    { loggedOutAt: "2026-09-29T00:00:00Z" },
  );
  assert.deepEqual(observed, [{ requestId: metadata.requestId, token }]);
});

test("provider association routes use the authenticated provider context", async () => {
  const observed: unknown[] = [];
  const providerId = "00000000-0000-4000-8000-000000000020";
  const sessionId = "00000000-0000-4000-8000-000000000021";
  const installationId = "00000000-0000-4000-8000-000000000022";
  const auth = {
    async authenticate(token: string) {
      observed.push({ token });
      return { providerId };
    },
  } as unknown as ProviderAuthService;
  const identity = {
    async inspectAssociationCode(input: unknown, context: unknown) {
      observed.push({ context, inspect: input });
      return { associationSessionId: sessionId };
    },
    async confirmAssociation(input: unknown, context: unknown) {
      observed.push({ confirm: input, context });
      return { associationId: "association" };
    },
    async queryAssociationResult(input: unknown, context: unknown) {
      observed.push({ context, query: input });
      return { status: "pending" };
    },
    async listProviderDevices(context: unknown) {
      observed.push({ context, list: true });
      return { devices: [] };
    },
  } as unknown as IdentityTransactionService;
  const controller = new ProviderController(auth, identity);
  const token = "P".repeat(43);
  const authorization = `Bearer ${token}`;

  await controller.inspectAssociation(
    { metadata, associationCode: `sgassoc_v1_${"A".repeat(43)}` },
    authorization,
  );
  await controller.confirmAssociation(
    { metadata, associationSessionId: sessionId, expectedInstallationId: installationId },
    authorization,
  );
  await controller.queryAssociationResult(
    { metadata, associationSessionId: sessionId, expectedInstallationId: installationId },
    authorization,
  );
  assert.deepEqual(
    await controller.listDevices({ metadata }, authorization),
    { devices: [] },
  );

  assert.deepEqual(observed[1], {
    inspect: { metadata, associationCode: `sgassoc_v1_${"A".repeat(43)}` },
    context: { providerId },
  });
  assert.equal(observed.filter((item) => "token" in (item as object)).length, 4);
});

test("temporary code is attached only after the original request is accepted", async () => {
  let accepted = false, reads = 0;
  const auth = { async requestVerification() { if (!accepted) throw new ProductTransactionError("INVITATION_REVOKED", "revoked"); return { challengeId: "challenge" }; } } as unknown as ProviderAuthService;
  const runtime = { deliveryPort: { async sendVerificationCode() {} }, codeReader: { readCode(): never { throw new Error("disabled"); } }, readTemporaryCode(id: string) { assert.equal(id, "challenge"); reads++; return "012345"; } };
  const controller = new ProviderController(auth, {} as IdentityTransactionService, runtime);
  const input = { metadata, purpose: "provider_registration", phoneE164: "+12025550123", invitationCode: "A".repeat(43) };
  await assert.rejects(controller.requestVerification(input));
  assert.equal(reads, 0);
  accepted = true;
  assert.deepEqual(await controller.requestVerification(input), { challengeId: "challenge", temporaryCode: "012345" });
  assert.equal(reads, 1);
});
