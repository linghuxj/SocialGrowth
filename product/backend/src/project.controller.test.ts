import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import { contractVersion, productErrorResponseSchema } from "@socialgrowth/product-contracts";
import { ProjectController } from "./project.controller.js";
import type { ProjectService } from "./project-service.js";
const input = { metadata: { contractVersion, requestId: "request-project-controller", idempotencyKey: "idempotency-project-controller" }, basics: {
  name: "真实元数据边界", kind: "company_owned", customerName: null, ownerOperatorId: null, notificationEmail: null } };
const request = { headers: { cookie: `unrelated=skip; __Host-sg_operator_session=${"A".repeat(43)}` } };
test("project HTTP forwards hardened host session and CSRF, never claimed actor", async () => {
  const controller = new ProjectController({ save: async (session: string, csrf: string, value: unknown, kind: string) => {
    assert.equal(session, "A".repeat(43)); assert.equal(csrf, "C".repeat(43)); assert.deepEqual(value, input); assert.equal(kind, "create"); return { project: "test-only" };
  } } as unknown as ProjectService);
  await controller.create(input, request, "C".repeat(43));
  await assert.rejects(controller.create({ ...input, actorOperatorId: "spoof" }, request, "C".repeat(43)), (error: unknown) => error instanceof HttpException && error.getStatus() === 400);
});
test("project path, version and generic database errors use safe product envelopes", async () => {
  const controller = new ProjectController({ list: async () => { throw new Error("secret-database-password"); } } as unknown as ProjectService);
  await assert.rejects(controller.update("00000000-0000-4000-8000-000000000001", { ...input, projectId: "00000000-0000-4000-8000-000000000002", expectedFactVersion: 0 }, request, "C".repeat(43)), (error: unknown) => error instanceof HttpException && productErrorResponseSchema.parse(error.getResponse()).error.code === "INPUT_INVALID");
  await assert.rejects(controller.list(request), (error: unknown) => error instanceof HttpException && error.getStatus() === 500 && !JSON.stringify(error.getResponse()).includes("secret-database"));
});
