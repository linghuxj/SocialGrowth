import assert from "node:assert/strict";
import test from "node:test";
import { parseTaskQueueConfig, readTaskQueueConfig, TaskQueueError, TaskRecheckQueue } from "./task-recheck-queue.js";
const valid = { endpoint: "redis://127.0.0.1:32908/0", username: "default", password: "synthetic-only", queueName: "sg-task-recheck", prefix: "sg-product", requestTimeoutMs: 1000 };
test("queue unavailable default has no ambient Redis endpoint, partial server config fails closed", () => {
  assert.equal(readTaskQueueConfig({}), null); assert.equal(readTaskQueueConfig({ SG_PRODUCT_QUEUE_MODE: "unavailable" }), null);
  for (const env of [{ SG_PRODUCT_QUEUE_MODE: "automatic" }, { SG_PRODUCT_QUEUE_ENDPOINT: valid.endpoint }, { SG_PRODUCT_QUEUE_MODE: "configured" },
    { SG_PRODUCT_QUEUE_MODE: "configured", SG_PRODUCT_QUEUE_REQUEST_TIMEOUT_MS: "01000" }]) assert.throws(() => readTaskQueueConfig(env), e => e instanceof TaskQueueError && e.code === "CONFIGURATION_REQUIRED");
});
test("malformed endpoint at all three configuration entries yields only the fixed error, without raw input or cause", () => {
  const endpoints = ["not-a-url", "redis://127.0.0.1:65536/0", "redis://synthetic-user:synthetic-url-secret@127.0.0.1:65536/0"];
  for (const endpoint of endpoints) {
    const input = { ...valid, endpoint }, before = structuredClone(input);
    const env = { SG_PRODUCT_QUEUE_MODE: "configured", SG_PRODUCT_QUEUE_ENDPOINT: endpoint, SG_PRODUCT_QUEUE_USERNAME: valid.username, SG_PRODUCT_QUEUE_PASSWORD: valid.password,
      SG_PRODUCT_QUEUE_NAME: valid.queueName, SG_PRODUCT_QUEUE_PREFIX: valid.prefix, SG_PRODUCT_QUEUE_REQUEST_TIMEOUT_MS: "1000" };
    for (const entry of [() => parseTaskQueueConfig(input), () => readTaskQueueConfig(env), () => new TaskRecheckQueue(input)]) {
      assert.throws(entry, error => {
        assert(error instanceof TaskQueueError); assert.equal(error.code, "CONFIGURATION_REQUIRED"); assert.equal(error.message, error.code);
        assert.deepEqual(Object.getOwnPropertyNames(error).sort(), ["code", "message", "stack"]);
        assert.equal(JSON.stringify(error), '{"code":"CONFIGURATION_REQUIRED"}'); assert(!error.stack?.includes("synthetic-url-secret"));
        return true;
      });
    }
    assert.deepEqual(input, before);
  }
});
test("trusted queue configuration requires explicit authenticated namespaced endpoint, TLS off loopback and bounded timeout", () => {
  parseTaskQueueConfig(valid); parseTaskQueueConfig({ ...valid, endpoint: "rediss://redis.example.invalid:6380/15" });
  for (const patch of [{ endpoint: "redis://redis.example.invalid:6380/0" }, { endpoint: "redis://127.0.0.1/0" }, { endpoint: "redis://127.0.0.1:32908" },
    { endpoint: "redis://embedded:secret@127.0.0.1:32908/0" }, { endpoint: "redis://127.0.0.1:32908/16" }, { endpoint: "redis://127.0.0.1:32908/0?extra=yes" },
    { password: "" }, { prefix: "bull:foreign" }, { queueName: "foreign:queue" }, { requestTimeoutMs: true }, { requestTimeoutMs: 30001 }, { worker: true }]) assert.throws(() => parseTaskQueueConfig({ ...valid, ...patch }), e => e instanceof TaskQueueError && e.code === "CONFIGURATION_REQUIRED");
});
