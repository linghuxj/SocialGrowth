import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { ArtemisMcp } from "./artemis.ts";
import { AdbDevice, executeDeviceTask } from "./device-executor.ts";
import type { RuntimeTask } from "./runtime.ts";
import { requireFact } from "./contracts.ts";
import { inspectPreparation, preparationPorts, type PreparationLease } from "./preparation.ts";

export async function runAgentOnce(options: {
  runtimeUrl: string;
  token: string;
  deviceId: string;
  artemisRoot: string;
  ledgerPath: string;
}) {
  const base = new URL(options.runtimeUrl);
  requireFact(
    base.protocol === "https:" ||
      (base.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)),
    "TLS_REQUIRED",
  );
  mkdirSync(dirname(options.ledgerPath), { recursive: true, mode: 0o700 });
  const ledger = new DatabaseSync(options.ledgerPath);
  chmodSync(options.ledgerPath, 0o600);
  ledger.exec(
    "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, trace TEXT, receipt TEXT, task TEXT, acknowledged INTEGER NOT NULL DEFAULT 0)",
  );
  // A second process must not replay another process's in-flight outbox as unknown.
  ledger.exec(
    "CREATE TABLE IF NOT EXISTS agent_owner (id INTEGER PRIMARY KEY CHECK(id=1), pid INTEGER NOT NULL, token TEXT NOT NULL)",
  );
  const owner = randomUUID();
  ledger.exec("BEGIN IMMEDIATE");
  try {
    const existing = ledger.prepare("SELECT pid FROM agent_owner WHERE id=1").get();
    if (existing) {
      let alive = true;
      try {
        process.kill(Number(existing.pid), 0);
      } catch (error) {
        alive = (error as NodeJS.ErrnoException).code !== "ESRCH";
      }
      requireFact(!alive, "AGENT_ALREADY_RUNNING");
    }
    ledger.prepare("INSERT OR REPLACE INTO agent_owner VALUES (1,?,?)").run(process.pid, owner);
    ledger.exec("COMMIT");
  } catch (error) {
    ledger.exec("ROLLBACK");
    ledger.close();
    throw error;
  }
  const address = new URL("/agent", base);
  address.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(address, {
    headers: { Authorization: `Bearer ${options.token}` },
    maxPayload: 1024 * 1024,
    handshakeTimeout: 15000,
  });
  const artemis = new ArtemisMcp(options.artemisRoot);
  const headers = { Authorization: `Bearer ${options.token}` };
  const rpc = async (
    type: string,
    payload: unknown,
  ): Promise<{ type: string; payload: unknown }> => {
    const messageId = randomUUID();
    return new Promise((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        socket.off("message", onMessage);
        socket.off("close", onClose);
      };
      const onClose = () => {
        done();
        reject(new Error("CONNECTION_LOST"));
      };
      const onMessage = (bytes: WebSocket.RawData) => {
        try {
          const result = JSON.parse(bytes.toString());
          if (result.inReplyTo !== messageId) return;
          done();
          if (result.type === "Rejected") reject(new Error(result.error?.code ?? "REJECTED"));
          else resolve(result);
        } catch (error) {
          done();
          reject(error);
        }
      };
      const timer = setTimeout(() => {
        done();
        reject(new Error("CONNECTION_TIMEOUT"));
      }, 30000);
      socket.on("message", onMessage);
      socket.once("close", onClose);
      socket.send(
        JSON.stringify({
          messageId,
          contractVersion: "design-v1",
          sentAt: new Date().toISOString(),
          type,
          payload,
        }),
      );
    });
  };
  socket.on("error", () => {
    /* pending RPC/open wait receives the failure */
  });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    // Flush the durable outbox BEFORE pulling another task. A lost receipt acknowledgement
    // must not strand the result or cause the device workflow to execute again.
    for (const row of ledger.prepare("SELECT * FROM attempts WHERE acknowledged=0").all()) {
      const saved = JSON.parse(row.task as string) as RuntimeTask;
      requireFact(saved.binding.deviceId === options.deviceId, "LEDGER_DEVICE_MISMATCH");
      const pending = row.receipt
        ? JSON.parse(row.receipt as string)
        : {
            schemaVersion: "design-v1",
            eventId: randomUUID(),
            taskId: saved.directive.taskId,
            attemptId: saved.directive.attemptId,
            deviceId: options.deviceId,
            accountId: saved.binding.accountId,
            occurredAt: new Date().toISOString(),
            executionStatus: "failed",
            publishStatus: "unknown",
            evidenceRefs: [],
            failureCode: "TECHNICAL_FAILURE",
            resourceStatus: "error",
          };
      ledger
        .prepare("UPDATE attempts SET receipt=? WHERE id=?")
        .run(JSON.stringify(pending), row.id);
      await rpc("ExecutionReceipt", pending);
      ledger.prepare("UPDATE attempts SET acknowledged=1 WHERE id=?").run(row.id);
    }
    const preparation = await rpc("PullPreparation", {
      deviceId: options.deviceId,
      resourceStatus: "idle",
    });
    if (preparation.type === "NoTask") return { status: "no_task" };
    const lease = preparation.payload as PreparationLease;
    requireFact(lease.task.binding.deviceId === options.deviceId, "DEVICE_SESSION_MISMATCH");
    // A preparation never owns a publication attempt. Failed observers cannot invalidate approval.
    const report = await inspectPreparation(lease.task, {
      ...preparationPorts(lease.task, artemis),
      observe: async () => {
        await artemis.connect();
        return preparationPorts(lease.task, artemis).observe();
      },
    });
    await rpc("PreparationReport", {
      taskId: lease.task.directive.taskId,
      lease: lease.lease,
      report,
    });
    if (report.status !== "ready")
      return { status: "waiting", reason: report.reason, taskId: lease.task.directive.taskId };
    const message = await rpc("BeginExecution", {
      taskId: lease.task.directive.taskId,
      lease: lease.lease,
    });
    if (message.type === "NoTask") return { status: "no_task" };
    const task = message.payload as RuntimeTask;
    requireFact(task.binding.deviceId === options.deviceId, "DEVICE_SESSION_MISMATCH");
    const old = ledger.prepare("SELECT * FROM attempts WHERE id=?").get(task.directive.attemptId);
    if (old) {
      const receipt = old.receipt
        ? JSON.parse(old.receipt as string)
        : {
            schemaVersion: "design-v1",
            eventId: randomUUID(),
            taskId: task.directive.taskId,
            attemptId: task.directive.attemptId,
            deviceId: options.deviceId,
            accountId: task.binding.accountId,
            occurredAt: new Date().toISOString(),
            executionStatus: "failed",
            publishStatus: "unknown",
            evidenceRefs: [],
            failureCode: "TECHNICAL_FAILURE",
            resourceStatus: "error",
          };
      await rpc("ExecutionReceipt", receipt);
      return { status: "replayed_receipt", taskId: task.directive.taskId };
    }
    ledger
      .prepare("INSERT INTO attempts(id,task) VALUES (?,?)")
      .run(task.directive.attemptId, JSON.stringify(task));
    let receipt;
    try {
      receipt = await executeDeviceTask(task, {
        artemis,
        device: new AdbDevice(),
        trace: (id) => {
          ledger
            .prepare("UPDATE attempts SET trace=? WHERE id=?")
            .run(id, task.directive.attemptId);
        },
        download: async (url) => {
          requireFact(new URL(url).origin === base.origin, "MEDIA_ORIGIN_MISMATCH");
          const response = await fetch(url, {
            redirect: "error",
            signal: AbortSignal.timeout(60000),
          });
          requireFact(response.ok, "MEDIA_DOWNLOAD_FAILED");
          requireFact(response.headers.get("content-type") === "video/mp4", "MEDIA_TYPE_INVALID");
          const reader = response.body!.getReader();
          const chunks: Uint8Array[] = [];
          let size = 0;
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 512 * 1024 * 1024) {
              await reader.cancel();
              throw new Error("MEDIA_TOO_LARGE");
            }
            chunks.push(value);
          }
          return Buffer.concat(chunks);
        },
        archive: async (mime, bytes) => {
          const response = await fetch(new URL("/api/runtime/evidence", base), {
            method: "POST",
            headers: { ...headers, "Content-Type": mime, "X-Task-Id": task.directive.taskId },
            body: new Uint8Array(bytes),
            signal: AbortSignal.timeout(30000),
          });
          requireFact(response.ok, "EVIDENCE_UPLOAD_FAILED");
          return ((await response.json()) as { id: string }).id;
        },
      });
    } catch {
      receipt = {
        schemaVersion: "design-v1",
        eventId: randomUUID(),
        taskId: task.directive.taskId,
        attemptId: task.directive.attemptId,
        deviceId: options.deviceId,
        accountId: task.binding.accountId,
        occurredAt: new Date().toISOString(),
        executionStatus: "failed",
        publishStatus: "not_submitted",
        evidenceRefs: [],
        failureCode: "EXECUTOR_NOT_CONFIGURED",
        resourceStatus: "available",
      };
    }
    ledger
      .prepare("UPDATE attempts SET receipt=? WHERE id=?")
      .run(JSON.stringify(receipt), task.directive.attemptId);
    await rpc("ExecutionReceipt", receipt);
    ledger.prepare("UPDATE attempts SET acknowledged=1 WHERE id=?").run(task.directive.attemptId);
    return { status: receipt.publishStatus, taskId: task.directive.taskId };
  } finally {
    socket.terminate();
    await artemis.close().catch(() => {});
    ledger.prepare("DELETE FROM agent_owner WHERE token=?").run(owner);
    ledger.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runAgentOnce({
    runtimeUrl: process.env.SG_RUNTIME_URL ?? "http://127.0.0.1:4318",
    token: process.env.SG_AGENT_TOKEN ?? "",
    deviceId: process.env.SG_DEVICE_ID ?? "",
    artemisRoot: process.env.SG_ARTEMIS_ROOT ?? "",
    ledgerPath: resolve(process.env.SG_AGENT_LEDGER ?? "../../.runtime/agent.sqlite"),
  })
    .then((result) => console.info(JSON.stringify(result)))
    .catch(() => {
      console.error("Agent failed; inspect persisted task/receipt before retrying.");
      process.exitCode = 1;
    });
}
