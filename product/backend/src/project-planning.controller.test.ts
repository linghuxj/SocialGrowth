import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import { contractVersion, emptyProjectPlanningInputs, productErrorResponseSchema } from "@socialgrowth/product-contracts";
import { ProjectPlanningController } from "./project-planning.controller.js";
import type { ProjectPlanningService } from "./project-planning-service.js";
const projectId = "00000000-0000-4000-8000-000000000001";
const input = { projectId, expectedProjectVersion: 0, expectedDraftVersion: 0, inputs: emptyProjectPlanningInputs(),
  metadata: { contractVersion, requestId: "request-planning-controller", idempotencyKey: "idempotency-planning-controller" } };
const request = { headers: { cookie: `__Host-sg_operator_session=${"A".repeat(43)}` } };
test("planning HTTP requires matched project path, strict inputs, authenticated actor and CSRF", async () => {
  const controller = new ProjectPlanningController({ save: async (session: string, csrf: string, body: unknown) => {
    assert.equal(session, "A".repeat(43)); assert.equal(csrf, "C".repeat(43)); assert.deepEqual(body, input); return "non-UI-test-only";
  } } as unknown as ProjectPlanningService);
  await controller.save(projectId, input, request, "C".repeat(43));
  for (const body of [{ ...input, actorOperatorId: projectId }, { ...input, inputs: { ...input.inputs, approved: true } }, { ...input, projectId: "00000000-0000-4000-8000-000000000002" }]) {
    await assert.rejects(controller.save(projectId, body, request, "C".repeat(43)), (error: unknown) => error instanceof HttpException && error.getStatus() === 400);
  }
});
test("planning read validates the path and masks internal exception details", async () => {
  const controller = new ProjectPlanningController({ read: async () => { throw new Error("fixture-password-value"); } } as unknown as ProjectPlanningService);
  await assert.rejects(controller.read("invalid", request), (e: unknown) => e instanceof HttpException && e.getStatus() === 400);
  await assert.rejects(controller.read(projectId, request), (e: unknown) => e instanceof HttpException && productErrorResponseSchema.parse(e.getResponse()).error.code === "INTERNAL_ERROR" && !JSON.stringify(e.getResponse()).includes("fixture-password"));
});
