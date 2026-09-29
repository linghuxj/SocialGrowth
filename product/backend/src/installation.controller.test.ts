import assert from "node:assert/strict";
import test from "node:test";

import { HttpException } from "@nestjs/common";
import {
  contractVersion,
  productErrorResponseSchema,
} from "@socialgrowth/product-contracts";

import type { IdentityTransactionService } from "./identity-transactions.js";
import type { InstallationAuthService } from "./installation-auth-service.js";
import { InstallationController } from "./installation.controller.js";

const metadata = {
  contractVersion,
  idempotencyKey: "installation-controller-0001",
  requestId: "request-installation-controller-0001",
};

test("installation routes authenticate the server-owned identity context", async () => {
  const observed: unknown[] = [];
  const auth = {
    async bootstrap(input: unknown) {
      observed.push({ bootstrap: input });
      return { installation: { installationId: "installation" } };
    },
    async authenticate(token: string) {
      observed.push({ authenticate: token });
      return {
        installationGeneration: 1n,
        installationId: "00000000-0000-4000-8000-000000000001",
      };
    },
  } as unknown as InstallationAuthService;
  const identity = {
    async createAssociationSession(input: unknown, context: unknown) {
      observed.push({ context, input });
      return { associationSessionId: "session" };
    },
    async getInstallationState(context: unknown) {
      observed.push({ stateContext: context });
      return { state: "unassociated" };
    },
  } as unknown as IdentityTransactionService;
  const controller = new InstallationController(auth, identity);
  const token = "I".repeat(43);
  const credential = `sginst_v1_${"C".repeat(43)}`;

  assert.deepEqual(
    await controller.bootstrap({ metadata, installationCredential: credential }),
    { installation: { installationId: "installation" } },
  );
  assert.deepEqual(
    await controller.createAssociationSession(
      { metadata, deviceLabel: "Execution Phone" },
      `Bearer ${token}`,
    ),
    { associationSessionId: "session" },
  );
  assert.deepEqual(
    await controller.state({ metadata }, `Bearer ${token}`),
    { state: "unassociated" },
  );
  assert.deepEqual(observed[1], { authenticate: token });
  assert.deepEqual(observed[2], {
    input: { metadata, deviceLabel: "Execution Phone" },
    context: {
      installationGeneration: 1n,
      installationId: "00000000-0000-4000-8000-000000000001",
    },
  });
});

test("installation association routes reject missing bearer tokens", async () => {
  const controller = new InstallationController(
    {} as InstallationAuthService,
    {} as IdentityTransactionService,
  );

  await assert.rejects(
    controller.createAssociationSession({
      metadata,
      deviceLabel: "Execution Phone",
    }),
    (error: unknown) => {
      if (!(error instanceof HttpException) || error.getStatus() !== 401) return false;
      return productErrorResponseSchema.parse(error.getResponse()).error.code ===
        "AUTHENTICATION_REQUIRED";
    },
  );
});
