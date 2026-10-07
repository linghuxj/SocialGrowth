import assert from "node:assert/strict";
import test from "node:test";
import { describeExecutorStartup, readExecutorConfig } from "./config.js";

test("executor defaults to the one product runtime with separately started workers", () => {
  const config = readExecutorConfig({});

  assert.deepEqual(config, { SG_PRODUCT_EXECUTOR_MODE: "runtime" });
  assert.match(describeExecutorStartup(config), /workers require an explicit separate command/);
});

test("executor accepts explicit disabled mode and rejects unknown modes", () => {
  assert.equal(readExecutorConfig({ SG_PRODUCT_EXECUTOR_MODE: "disabled" }).SG_PRODUCT_EXECUTOR_MODE, "disabled");
  assert.throws(() => readExecutorConfig({ SG_PRODUCT_EXECUTOR_MODE: "enabled" }));
});
