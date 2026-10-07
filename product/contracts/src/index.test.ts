import assert from "node:assert/strict";
import test from "node:test";
import { livenessResponseSchema } from "./index.js";

test("liveness response rejects a Demo environment", () => {
  const result = livenessResponseSchema.safeParse({
    environment: "demo",
    service: "backend",
    status: "alive",
  });

  assert.equal(result.success, false);
});
