import assert from "node:assert/strict";
import test from "node:test";
import { livenessResponseSchema } from "@socialgrowth/product-contracts";
import { AppController } from "./app.controller.js";

test("liveness identifies only the product backend process", () => {
  const response = new AppController().liveness();

  assert.deepEqual(response, {
    environment: "product",
    service: "backend",
    status: "alive",
  });
  assert.equal(livenessResponseSchema.safeParse(response).success, true);
});
