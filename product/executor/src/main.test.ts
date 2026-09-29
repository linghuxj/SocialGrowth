import assert from "node:assert/strict";
import test from "node:test";
import { describeExecutorStartup, readExecutorConfig } from "./config.js";

test("WP-00 executor stays disabled and states that it consumes no queue", () => {
  const config = readExecutorConfig({});

  assert.deepEqual(config, { SG_PRODUCT_EXECUTOR_MODE: "disabled" });
  assert.match(describeExecutorStartup(config), /no device queue is consumed/);
});

test("WP-00 executor rejects an enabled mode", () => {
  assert.throws(() => readExecutorConfig({ SG_PRODUCT_EXECUTOR_MODE: "enabled" }));
});
