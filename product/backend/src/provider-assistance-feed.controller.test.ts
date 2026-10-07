import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import { productErrorResponseSchema } from "@socialgrowth/product-contracts";
import { ProviderAssistanceFeedController } from "./provider-assistance-feed.controller.js";
import type { ProviderAssistanceFeedService } from "./provider-assistance-feed-service.js";
const token = "B".repeat(43);
test("provider feed HTTP requires bearer and strict bounded pagination, never caller provider identity", async () => {
  let calls = 0;
  const controller = new ProviderAssistanceFeedController({ list: async (value: string, query: unknown) => { calls++; assert.equal(value, token); assert.deepEqual(query, { afterTodoId: null, pageSize: 20 }); return "non-UI-test-only"; } } as unknown as ProviderAssistanceFeedService);
  assert.equal(await controller.list({}, `Bearer ${token}`), "non-UI-test-only");
  for (const query of [{ providerId: "fake" }, { pageSize: "51" }, { pageSize: ["1", "2"] }]) await assert.rejects(controller.list(query, `Bearer ${token}`), (e: unknown) => e instanceof HttpException && e.getStatus() === 400);
  await assert.rejects(controller.list({}, undefined), (e: unknown) => e instanceof HttpException && e.getStatus() === 401); assert.equal(calls, 1);
});
test("provider feed HTTP masks unknown errors in a valid safe envelope", async () => {
  const controller = new ProviderAssistanceFeedController({ list: async () => { throw new Error("fixture-private-provider-token"); } } as unknown as ProviderAssistanceFeedService);
  await assert.rejects(controller.list({}, `Bearer ${token}`), (e: unknown) => e instanceof HttpException && productErrorResponseSchema.parse(e.getResponse()).error.code === "INTERNAL_ERROR" && !JSON.stringify(e.getResponse()).includes("fixture-private"));
});
