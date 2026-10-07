import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import { productErrorResponseSchema } from "@socialgrowth/product-contracts";
import { ProviderCommissionFeedController } from "./provider-commission-feed.controller.js";
import type { ProviderCommissionFeedService } from "./provider-commission-feed-service.js";
const token = "B".repeat(43);
test("commission GET requires Provider bearer and strict paired bounded cursor, no caller ownership or payment", async () => {
  let calls = 0;
  const controller = new ProviderCommissionFeedController({ list: async (value: string, query: unknown) => { calls++; assert.equal(value, token); assert.deepEqual(query, { after: null, pageSize: 20 }); return "supplemental-only"; } } as unknown as ProviderCommissionFeedService);
  assert.equal(await controller.list({}, `Bearer ${token}`), "supplemental-only");
  for (const query of [{ providerId: "fake" }, { paymentAllowed: "true" }, { pageSize: "51" }, { pageSize: ["1", "2"] }, { afterRevision: "1" }, { afterIncomeId: "a0000000-0000-4000-8000-000000000001" }, { afterIncomeId: "a0000000-0000-4000-8000-000000000001", afterRevision: "9007199254740992" }]) {
    await assert.rejects(controller.list(query, `Bearer ${token}`), (e: unknown) => e instanceof HttpException && e.getStatus() === 400);
  }
  await assert.rejects(controller.list({}, undefined), (e: unknown) => e instanceof HttpException && e.getStatus() === 401); assert.equal(calls, 1);
});
test("commission GET safe envelope omits raw database and token failures", async () => {
  const controller = new ProviderCommissionFeedController({ list: async () => { throw new Error("synthetic-private-source"); } } as unknown as ProviderCommissionFeedService);
  await assert.rejects(controller.list({}, `Bearer ${token}`), (e: unknown) => e instanceof HttpException && e.getStatus() === 500
    && productErrorResponseSchema.parse(e.getResponse()).error.code === "INTERNAL_ERROR" && !JSON.stringify(e.getResponse()).includes("private-source"));
});
