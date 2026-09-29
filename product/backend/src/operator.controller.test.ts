import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import { contractVersion, productErrorResponseSchema } from "@socialgrowth/product-contracts";

import type { OperatorAuthService } from "./operator-auth-service.js";
import type { InvitationManagementService } from "./invitation-management-service.js";
import { OperatorController } from "./operator.controller.js";

const operator = {
  operatorId: "00000000-0000-4000-8000-000000000001",
  loginName: "operator.one",
  displayName: "Operator One",
  factVersion: 0,
  createdAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-09-29T00:00:00.000Z",
  status: "active" as const,
  disabledAt: null,
};

test("login writes only the internal token to a hardened host cookie", async () => {
  const service = {
    async login() {
      return {
        sessionToken: "S".repeat(43),
        response: {
          operator,
          session: {
            sessionId: "00000000-0000-4000-8000-000000000002",
            createdAt: "2026-09-29T00:00:00.000Z",
            expiresAt: "2099-09-29T08:00:00.000Z",
          },
          csrfToken: "C".repeat(43),
        },
      };
    },
  } as unknown as OperatorAuthService;
  const controller = new OperatorController(
    service,
    {} as InvitationManagementService,
  );
  let cookie = "";
  const response = await controller.login(
    {
      metadata: { contractVersion, requestId: "request-controller-login-0001" },
      loginName: "operator.one",
      password: "controller-password-0001",
    },
    { headers: {}, ip: "127.0.0.1" },
    { setHeader: (_name, value) => { cookie = value; } },
  );

  assert.equal("sessionToken" in response, false);
  assert.match(cookie, /^__Host-sg_operator_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
});

test("HTTP boundary reports an unsupported contract with the product envelope", async () => {
  const controller = new OperatorController(
    {} as OperatorAuthService,
    {} as InvitationManagementService,
  );
  await assert.rejects(
    controller.login(
      {
        metadata: {
          contractVersion: "2026-09-28.identity-v0",
          requestId: "request-old-contract-0001",
        },
        loginName: "operator.one",
        password: "controller-password-0001",
      },
      { headers: {}, ip: "127.0.0.1" },
      { setHeader: () => undefined },
    ),
    (error: unknown) => {
      if (!(error instanceof HttpException)) return false;
      const response = productErrorResponseSchema.parse(error.getResponse());
      return response.error.code === "CONTRACT_VERSION_UNSUPPORTED";
    },
  );
});

test("HTTP boundary masks unexpected failures with a retryable product envelope", async () => {
  const service = {
    async listOperators() { throw new Error("database-password-must-not-leak"); },
  } as unknown as OperatorAuthService;
  const controller = new OperatorController(
    service,
    {} as InvitationManagementService,
  );

  await assert.rejects(
    controller.list({ headers: {} }),
    (error: unknown) => {
      if (!(error instanceof HttpException) || error.getStatus() !== 500) return false;
      const response = productErrorResponseSchema.parse(error.getResponse());
      return response.error.code === "INTERNAL_ERROR"
        && response.error.retryable
        && !response.error.message.includes("database-password");
    },
  );
});

test("invitation HTTP writes use the host session, csrf token, and path identity", async () => {
  let observed: unknown;
  const invitationService = {
    async revokeInvitation(sessionToken: string, csrfToken: string, request: unknown) {
      observed = { sessionToken, csrfToken, request };
      return { success: true };
    },
  } as unknown as InvitationManagementService;
  const controller = new OperatorController(
    {} as OperatorAuthService,
    invitationService,
  );
  const invitationId = "00000000-0000-4000-8000-000000000099";
  const response = await controller.revokeInvitation(
    invitationId,
    {
      metadata: {
        contractVersion,
        idempotencyKey: "revoke-controller-0001",
        requestId: "request-controller-revoke-0001",
      },
      invitationId: "00000000-0000-4000-8000-000000000098",
      expectedFactVersion: 4,
    },
    { headers: { cookie: "other=x; __Host-sg_operator_session=session-token" } },
    "csrf-token",
  );

  assert.deepEqual(response, { success: true });
  assert.deepEqual(observed, {
    sessionToken: "session-token",
    csrfToken: "csrf-token",
    request: {
      metadata: {
        contractVersion,
        idempotencyKey: "revoke-controller-0001",
        requestId: "request-controller-revoke-0001",
      },
      invitationId,
      expectedFactVersion: 4,
    },
  });
});
