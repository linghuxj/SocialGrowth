import { performance } from "node:perf_hooks";
import { Queue, createIORedisClient } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";
import { taskDispatchNoticeSchema, type TaskDispatchNotice } from "@socialgrowth/product-contracts";
export class TaskQueueError extends Error {
  constructor(readonly code: "CONFIGURATION_REQUIRED" | "INPUT_INVALID" | "MESSAGE_ID_REUSED" | "CORRUPT_NOTICE" | "QUEUE_UNAVAILABLE") { super(code); }
}
const configuration = z.strictObject({ endpoint: z.url(), username: z.string().min(1).max(100), password: z.string().min(1),
  queueName: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), prefix: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), requestTimeoutMs: z.int().min(100).max(30000) }).refine(v => {
  const u = new URL(v.endpoint);
  return ["redis:", "rediss:"].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash && /^[0-9]+$/.test(u.port)
    && Number(u.port) >= 1 && Number(u.port) <= 65535 && /^\/(?:[0-9]|1[0-5])$/.test(u.pathname)
    && (u.protocol === "rediss:" || ["127.0.0.1", "[::1]", "localhost"].includes(u.hostname));
}, "Invalid trusted queue endpoint");
export type TaskQueueConfig = z.infer<typeof configuration>;
export function parseTaskQueueConfig(input: unknown): TaskQueueConfig {
  const parsed = configuration.safeParse(input); if (!parsed.success) throw new TaskQueueError("CONFIGURATION_REQUIRED"); return parsed.data;
}
const fields = ["ENDPOINT", "USERNAME", "PASSWORD", "NAME", "PREFIX", "REQUEST_TIMEOUT_MS"] as const;
export function readTaskQueueConfig(environment: NodeJS.ProcessEnv = process.env): TaskQueueConfig | null {
  const mode = environment.SG_PRODUCT_QUEUE_MODE ?? "unavailable";
  if (mode === "unavailable" && fields.every(f => environment[`SG_PRODUCT_QUEUE_${f}`] === undefined)) return null;
  if (mode !== "configured" || !/^[1-9][0-9]*$/.test(environment.SG_PRODUCT_QUEUE_REQUEST_TIMEOUT_MS ?? "")) throw new TaskQueueError("CONFIGURATION_REQUIRED");
  return parseTaskQueueConfig({ endpoint: environment.SG_PRODUCT_QUEUE_ENDPOINT, username: environment.SG_PRODUCT_QUEUE_USERNAME, password: environment.SG_PRODUCT_QUEUE_PASSWORD,
    queueName: environment.SG_PRODUCT_QUEUE_NAME, prefix: environment.SG_PRODUCT_QUEUE_PREFIX, requestTimeoutMs: Number(environment.SG_PRODUCT_QUEUE_REQUEST_TIMEOUT_MS) });
}
function parseNotice(input: unknown): TaskDispatchNotice {
  const p = taskDispatchNoticeSchema.safeParse(input); if (!p.success) throw new TaskQueueError("INPUT_INVALID");
  const notice = p.data;
  for (const key of ["messageId", "taskId", "projectId", "taskAttemptId", "deviceId", "identityId"] as const) notice[key] = notice[key].toLowerCase(); return notice;
}
// Server-owned transport ONLY. Not registered by AppModule, no HTTP/Worker,
// scheduler or action consumer. PG outbox/current Task and event authority must
// later precede it; a queue acceptance is not central consumption or publication.
export class TaskRecheckQueue {
  #redis: Redis; #queue: Queue<TaskDispatchNotice>; #timeout: number; #closed = false;
  constructor(input: unknown) {
    const config = parseTaskQueueConfig(input), u = new URL(config.endpoint); this.#timeout = config.requestTimeoutMs;
    this.#redis = new Redis({ host: u.hostname.replace(/^\[|\]$/g, ""), port: Number(u.port), db: Number(u.pathname.slice(1)), username: config.username, password: config.password,
      ...(u.protocol === "rediss:" ? { tls: {} } : {}), enableOfflineQueue: false, maxRetriesPerRequest: 1, retryStrategy: () => null,
      connectTimeout: config.requestTimeoutMs, commandTimeout: config.requestTimeoutMs });
    // Never log Redis errors (which may include endpoint or connection details).
    this.#redis.on("error", () => {});
    this.#queue = new Queue<TaskDispatchNotice>(config.queueName, { connection: createIORedisClient(this.#redis), prefix: config.prefix,
      defaultJobOptions: { attempts: 1, removeOnComplete: false, removeOnFail: false } }); this.#queue.on("error", () => {});
  }
  async send(input: unknown) {
    const notice = parseNotice(input); if (this.#closed) throw new TaskQueueError("QUEUE_UNAVAILABLE");
    const deadline = performance.now() + this.#timeout;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const verify = (name: string, stored: unknown) => {
      const p = taskDispatchNoticeSchema.safeParse(stored); if (!p.success || name !== "recheck-central-task") throw new TaskQueueError("CORRUPT_NOTICE");
      if (JSON.stringify(parseNotice(p.data)) !== JSON.stringify(notice)) throw new TaskQueueError("MESSAGE_ID_REUSED");
    };
    const operation = async () => {
      await this.#queue.waitUntilReady();
      const policy = await this.#redis.config("GET", "maxmemory-policy"), persistence = await this.#redis.config("GET", "appendonly");
      if (policy[1] !== "noeviction" || persistence[1] !== "yes") throw new TaskQueueError("QUEUE_UNAVAILABLE");
      const old = await this.#queue.getJob(notice.messageId); if (old) verify(old.name, old.data);
      await this.#queue.add("recheck-central-task", notice, { jobId: notice.messageId });
      const saved = await this.#queue.getJob(notice.messageId); if (!saved) throw new TaskQueueError("QUEUE_UNAVAILABLE"); verify(saved.name, saved.data);
      if (performance.now() >= deadline) throw new TaskQueueError("QUEUE_UNAVAILABLE");
      return { messageId: notice.messageId, queueAcceptance: "observed" as const, executionAllowed: false as const, publicationAllowed: false as const };
    };
    try {
      return await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new TaskQueueError("QUEUE_UNAVAILABLE")), this.#timeout); })]);
    } catch (error) { if (error instanceof TaskQueueError) throw error; throw new TaskQueueError("QUEUE_UNAVAILABLE"); }
    finally { if (timer) clearTimeout(timer); }
    // Timeout does not prove no late job was added. Keep original ID/payload in
    // the durable sender and reconcile/retry; this method never creates new IDs.
  }
  async close() { if (this.#closed) return; this.#closed = true; try { await this.#queue.close(); } finally { this.#redis.disconnect(); } }
}
