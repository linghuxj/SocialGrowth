import assert from "node:assert/strict";
import test from "node:test";
import { healthResponseSchema } from "./index.js";

test("health response rejects a Demo environment", () => {
  const result = healthResponseSchema.safeParse({
    environment: "demo",
    service: "backend",
    status: "ok",
  });

  assert.equal(result.success, false);
});
