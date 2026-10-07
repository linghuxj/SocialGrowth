import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import { performance } from "node:perf_hooks";
import { createConnection } from "node:net";
import { Queue, createIORedisClient } from "bullmq";
import { Redis } from "ioredis";
import { taskProtocolVersion, type TaskDispatchNotice } from "@socialgrowth/product-contracts";
import { TaskRecheckQueue, TaskQueueError } from "./task-recheck-queue.js";
const endpoint = process.env.SG_PRODUCT_TEST_REDIS_ENDPOINT, password = process.env.SG_PRODUCT_TEST_REDIS_PASSWORD;
if (endpoint !== "redis://127.0.0.1:32908/0" || !password || process.env.SG_PRODUCT_TEST_REDIS_ISOLATED !== "1") throw new Error("Queue supplementary tests require explicit owned isolated Redis");
const admin = new Redis({ host: "127.0.0.1", port: 32908, username: "default", password, lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1, retryStrategy: () => null });
const queueName = `sg-recheck-${randomUUID()}`, prefix = "sg-wp16-fixture";
const config = { endpoint, username: "default", password, queueName, prefix, requestTimeoutMs: 2000 };
let sender: TaskRecheckQueue, observer: Queue<TaskDispatchNotice>;
before(async () => {
  await admin.connect(); assert.equal(await admin.dbsize(), 0); assert.equal((await admin.config("GET", "appendonly"))[1], "yes"); assert.equal((await admin.config("GET", "maxmemory-policy"))[1], "noeviction");
  observer = new Queue<TaskDispatchNotice>(queueName, { connection: createIORedisClient(admin), prefix }); await observer.waitUntilReady(); sender = new TaskRecheckQueue(config);
});
after(async () => { try { await sender?.close(); await observer?.obliterate({ force: true }); await observer?.close(); } finally { admin.disconnect(); } });
function notice(): TaskDispatchNotice { return { protocolVersion: taskProtocolVersion, messageId: randomUUID(), taskId: randomUUID(), taskRevision: 1, projectId: randomUUID(), taskAttemptId: randomUUID(), deviceId: randomUUID(), identityId: randomUUID(), purpose: "recheck_central_task", executionAllowed: false }; }
const unavailable = (error: unknown) => error instanceof TaskQueueError && error.code === "QUEUE_UNAVAILABLE" && !error.message.includes(password!);
test("actual Redis transport records only original recheck scope and false permissions, without Worker/publication", async () => {
  const input = notice(), response = await sender.send(input); assert.deepEqual(response, { messageId: input.messageId, queueAcceptance: "observed", executionAllowed: false, publicationAllowed: false });
  const job = (await observer.getJob(input.messageId))!; assert.deepEqual(job.data, input); assert.equal(job.name, "recheck-central-task"); assert.equal(await job.getState(), "waiting");
  assert.equal(job.opts.attempts, 1); assert.equal(job.opts.removeOnComplete, false); assert.equal(await observer.getActiveCount(), 0); assert.equal(JSON.stringify(sender), "{}");
});
test("actual same original ID concurrent retries and uppercase UUID normalization retain one waiting notification", async () => {
  const input = notice(); const results = await Promise.all(Array.from({ length: 8 }, () => sender.send(input))); assert.ok(results.every(r => r.messageId === input.messageId));
  const upper = { ...input, messageId: input.messageId.toUpperCase(), deviceId: input.deviceId.toUpperCase() }; assert.equal((await sender.send(upper)).messageId, input.messageId);
  const waiting = await observer.getWaiting(); assert.equal(waiting.filter(j => j.id === input.messageId).length, 1); assert.deepEqual((await observer.getJob(input.messageId))!.data, input);
});
test("actual message ID with different payload fails instead of silently claiming ignored BullMQ payload was saved", async () => {
  const input = notice(); await sender.send(input);
  await assert.rejects(sender.send({ ...input, taskRevision: 2 }), e => e instanceof TaskQueueError && e.code === "MESSAGE_ID_REUSED");
  assert.deepEqual((await observer.getJob(input.messageId))!.data, input);
  await assert.rejects(sender.send({ ...input, caption: "must-not-cross-queue" }), e => e instanceof TaskQueueError && e.code === "INPUT_INVALID");
});
test("actual retained malformed or other-kind job closes intake safely without replacing stored data", async () => {
  const input = notice(); await observer.add("foreign-kind", input, { jobId: input.messageId });
  await assert.rejects(sender.send(input), e => e instanceof TaskQueueError && e.code === "CORRUPT_NOTICE"); assert.equal((await observer.getJob(input.messageId))!.name, "foreign-kind");
});
test("actual policy or persistence drift is rejected without configuring Redis or adding notification", async () => {
  const input = notice();
  try { await admin.config("SET", "maxmemory-policy", "allkeys-lru"); await assert.rejects(sender.send(input), unavailable); assert.equal(await observer.getJob(input.messageId), undefined); }
  finally { await admin.config("SET", "maxmemory-policy", "noeviction"); }
  try { await admin.config("SET", "appendonly", "no"); await assert.rejects(sender.send(input), unavailable); assert.equal(await observer.getJob(input.messageId), undefined); }
  finally { await admin.config("SET", "appendonly", "yes"); }
  assert.equal((await sender.send(input)).executionAllowed, false);
});
test("actual disconnected endpoint has bounded safe failure, not fallback to default Redis or successful queue receipt", async () => {
  // Read-only socket preflight: never send synthetic AUTH to another service.
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: 32909 });
    socket.setTimeout(1000, () => { socket.destroy(); reject(new Error("Offline fixture port could not be confirmed absent")); });
    socket.once("connect", () => { socket.destroy(); reject(new Error("Offline fixture port is occupied")); });
    socket.once("error", (error: NodeJS.ErrnoException) => { socket.destroy(); if (error.code === "ECONNREFUSED") resolve(); else reject(new Error("Offline fixture port unavailable for safe probe")); });
  });
  const offline = new TaskRecheckQueue({ ...config, endpoint: "redis://127.0.0.1:32909/0", requestTimeoutMs: 500 }), started = performance.now();
  try { await assert.rejects(offline.send(notice()), unavailable); assert.ok(performance.now() - started < 1500); }
  finally { await offline.close(); }
});
test("actual transport reconstruction keeps original job and closing prevents additional sends", async () => {
  const input = notice(); await sender.send(input); await sender.close(); await assert.rejects(sender.send(input), unavailable); sender = new TaskRecheckQueue(config);
  await sender.send(input); assert.deepEqual((await observer.getJob(input.messageId))!.data, input);
});
test("actual removing queue job permits same ID to be added again, explicitly not durable business dedup or publication", async () => {
  const input = notice(); await sender.send(input); await (await observer.getJob(input.messageId))!.remove(); assert.equal(await observer.getJob(input.messageId), undefined);
  await sender.send(input); assert.deepEqual((await observer.getJob(input.messageId))!.data, input); assert.equal(await observer.getActiveCount(), 0);
});
