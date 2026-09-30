import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import { DeviceAssistanceFeedController } from "./device-assistance-feed.controller.js";
import type { DeviceAssistanceFeedService } from "./device-assistance-feed-service.js";
import { productErrorResponseSchema } from "@socialgrowth/product-contracts";
const token = "A".repeat(43), request = { headers: { cookie: `__Host-sg_operator_session=${token}` } };
test("feed HTTP uses host operator identity with a bounded strict cursor query, never caller owner or provider", async () => {
  let calls = 0;
  const controller = new DeviceAssistanceFeedController({ list: async (value: string, query: unknown) => { calls++; assert.equal(value, token); assert.deepEqual(query, { afterTodoId: null, pageSize: 20 }); return "non-UI-test-only"; } } as unknown as DeviceAssistanceFeedService);
  assert.equal(await controller.list({}, request), "non-UI-test-only");
  for (const query of [{ ownerOperatorId: "fake" }, { pageSize: "0" }, { pageSize: "51" }, { pageSize: "1e1" }, { pageSize: ["1", "2"] }, { afterTodoId: "invalid" }]) await assert.rejects(controller.list(query, request), (e: unknown) => e instanceof HttpException && e.getStatus() === 400);
  assert.equal(calls, 1);
});
test("feed HTTP masks unknown driver details in the product error envelope", async () => {
  const controller = new DeviceAssistanceFeedController({ list: async () => { throw new Error("fixture-private-connection-string"); } } as unknown as DeviceAssistanceFeedService);
  await assert.rejects(controller.list({}, request), (e: unknown) => e instanceof HttpException && productErrorResponseSchema.parse(e.getResponse()).error.code === "INTERNAL_ERROR" && !JSON.stringify(e.getResponse()).includes("private-connection"));
});
