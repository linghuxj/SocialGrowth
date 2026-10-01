import assert from "node:assert/strict";
import test from "node:test";
import { parseTaskQueueConfig, readTaskQueueConfig, TaskQueueError } from "./task-recheck-queue.js";
const valid = { endpoint: "redis://127.0.0.1:32908/0", username: "default", password: "synthetic-only", queueName: "sg-task-recheck", prefix: "sg-product", requestTimeoutMs: 1000 };
test("queue unavailable default has no ambient Redis endpoint, partial server config fails closed", () => {
  assert.equal(readTaskQueueConfig({}), null); assert.equal(readTaskQueueConfig({ SG_PRODUCT_QUEUE_MODE: "unavailable" }), null);
  for (const env of [{ SG_PRODUCT_QUEUE_MODE: "automatic" }, { SG_PRODUCT_QUEUE_ENDPOINT: valid.endpoint }, { SG_PRODUCT_QUEUE_MODE: "configured" },
    { SG_PRODUCT_QUEUE_MODE: "configured", SG_PRODUCT_QUEUE_REQUEST_TIMEOUT_MS: "01000" }]) assert.throws(() => readTaskQueueConfig(env), e => e instanceof TaskQueueError && e.code === "CONFIGURATION_REQUIRED");
});
test("trusted queue configuration requires explicit authenticated namespaced endpoint, TLS off loopback and bounded timeout", () => {
  parseTaskQueueConfig(valid); parseTaskQueueConfig({ ...valid, endpoint: "rediss://redis.example.invalid:6380/15" });
  for (const patch of [{ endpoint: "redis://redis.example.invalid:6380/0" }, { endpoint: "redis://127.0.0.1/0" }, { endpoint: "redis://127.0.0.1:32908" },
    { endpoint: "redis://embedded:secret@127.0.0.1:32908/0" }, { endpoint: "redis://127.0.0.1:32908/16" }, { endpoint: "redis://127.0.0.1:32908/0?extra=yes" },
    { password: "" }, { prefix: "bull:foreign" }, { queueName: "foreign:queue" }, { requestTimeoutMs: true }, { requestTimeoutMs: 30001 }, { worker: true }]) assert.throws(() => parseTaskQueueConfig({ ...valid, ...patch }), e => e instanceof TaskQueueError && e.code === "CONFIGURATION_REQUIRED");
});
