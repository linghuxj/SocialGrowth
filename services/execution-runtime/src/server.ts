import { createServer, type IncomingMessage } from "node:http";
import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";
import { z } from "zod";
import { RuntimeStore } from "./store.ts";
import { ExecutionRuntime } from "./runtime.ts";
import { RuntimeError, requireFact, id, sha256 } from "./contracts.ts";

export interface ServerOptions {
  dataDir: string;
  token: string;
  signingKey: string;
  deviceTokens: Record<string, string>;
  port?: number;
  mediaBaseUrl?: string;
  allowedOrigins?: string[];
}
const safeEqual = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function body(req: IncomingMessage, max = 1024 * 1024): Promise<Buffer> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > max) throw new RuntimeError("BODY_TOO_LARGE", 413);
    parts.push(bytes);
  }
  return Buffer.concat(parts);
}
const errorBody = (error: unknown) => ({
  ok: false,
  error: {
    code: error instanceof RuntimeError ? error.code : "INVALID_REQUEST",
    message: error instanceof RuntimeError ? error.code : "请求参数无效或当前状态不允许此操作",
  },
});

export function createRuntimeServer(options: ServerOptions) {
  requireFact(
    options.token.length >= 32 && options.signingKey.length >= 32,
    "RUNTIME_KEYS_REQUIRED",
  );
  requireFact(
    Object.values(options.deviceTokens).every((t) => t.length >= 32 && t !== options.token),
    "DEVICE_KEYS_INVALID",
  );
  const assetsDir = join(options.dataDir, "assets");
  mkdirSync(assetsDir, { recursive: true, mode: 0o700 });
  const store = new RuntimeStore(join(options.dataDir, "runtime.sqlite"));
  const runtime = new ExecutionRuntime(store, {
    signingKey: options.signingKey,
    mediaBaseUrl: options.mediaBaseUrl ?? `http://127.0.0.1:${options.port ?? 4318}`,
    hasAsset: (sha) => existsSync(join(assetsDir, sha)),
    canExecuteAsset: (sha) =>
      store.db.prepare("SELECT mime FROM assets WHERE sha256=?").get(sha)?.mime === "video/mp4",
  });
  const http = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const path = url.pathname.replace(/^\/api\/runtime/, "");
      requireFact(url.pathname.startsWith("/api/runtime/"), "NOT_FOUND");
      if (req.headers.origin)
        requireFact(
          (options.allowedOrigins ?? ["http://localhost:3000", "http://127.0.0.1:3000"]).includes(
            req.headers.origin,
          ),
          "ORIGIN_REJECTED",
        );
      const media = path.match(/^\/media\/([a-f0-9]{64})$/);
      if (media && req.method === "GET") {
        runtime.verifyMedia(media[1], url.searchParams);
        requireFact(existsSync(join(assetsDir, media[1])), "ASSET_NOT_FOUND");
        res.setHeader("Content-Type", "video/mp4");
        res.end(readFileSync(join(assetsDir, media[1])));
        return;
      }
      const bearer = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
      const operator = safeEqual(bearer, options.token);
      const device = Object.entries(options.deviceTokens).find(([, token]) =>
        safeEqual(bearer, token),
      )?.[0];
      requireFact(operator || device, "AUTHENTICATION_REQUIRED");
      let result: unknown;
      if (path === "/evidence" && req.method === "POST" && (device || operator)) {
        const taskId = id.parse(req.headers["x-task-id"]);
        const taskDevice =
          device ?? runtime.tasks().find((t) => t.taskId === taskId)?.task.binding.deviceId;
        requireFact(taskDevice, "TASK_NOT_FOUND");
        result = {
          id: runtime.archiveEvidence(
            taskId,
            taskDevice,
            String(req.headers["content-type"]),
            await body(req, 8 * 1024 * 1024),
          ),
        };
      } else {
        requireFact(operator, "OPERATOR_REQUIRED");
        if (path === "/state" && req.method === "GET") {
          runtime.reconcile();
          result = store.snapshot();
        } else if (path === "/status" && req.method === "GET") {
          runtime.reconcile();
          result = {
            bindings: runtime.bindings(),
            tasks: runtime.tasks(),
            preparations: runtime.preparations(),
            deviceHolds: store.db.prepare("SELECT * FROM device_holds").all(),
            pauses: store.db.prepare("SELECT * FROM pauses").all(),
            observations: store.db
              .prepare("SELECT body FROM observations ORDER BY rowid DESC")
              .all()
              .map((r) => JSON.parse(r.body as string)),
          };
        } else if (path === "/device-control" && req.method === "POST") {
          const input = z
            .object({ deviceId: id, held: z.boolean() })
            .strict()
            .parse(JSON.parse((await body(req)).toString()));
          result = runtime.holdDevice(input.deviceId, input.held, "local-operator");
        } else if (path === "/commands" && req.method === "POST")
          result = runtime.command(JSON.parse((await body(req)).toString()), "local-operator");
        else if (path === "/import" && req.method === "POST")
          result = {
            ok: true,
            value: runtime.importLegacy(
              JSON.parse((await body(req, 8 * 1024 * 1024)).toString()),
              "local-operator",
            ),
          };
        else if (path === "/bindings" && req.method === "POST")
          result = {
            ok: true,
            value: runtime.bind(JSON.parse((await body(req)).toString()), "local-operator"),
          };
        else if (path === "/tasks" && req.method === "POST")
          result = {
            ok: true,
            value: runtime.enqueue(JSON.parse((await body(req)).toString()), "local-operator"),
          };
        else if (path === "/reviews" && req.method === "POST")
          result = {
            ok: true,
            value: runtime.review(JSON.parse((await body(req)).toString()), "local-operator"),
          };
        else if (path === "/observations" && req.method === "POST")
          result = {
            ok: true,
            value: runtime.observe(JSON.parse((await body(req)).toString()), "local-operator"),
          };
        else if (path === "/assets" && req.method === "POST") {
          const bytes = await body(req, 512 * 1024 * 1024);
          const mime =
            bytes.length > 12 && bytes.subarray(4, 8).toString() === "ftyp"
              ? "video/mp4"
              : bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
                ? "image/png"
                : bytes.subarray(0, 3).toString("hex") === "ffd8ff"
                  ? "image/jpeg"
                  : bytes.subarray(0, 4).toString() === "RIFF" &&
                      bytes.subarray(8, 12).toString() === "WEBP"
                    ? "image/webp"
                    : undefined;
          requireFact(mime, "UNSUPPORTED_ASSET_FORMAT");
          const digest = createHash("sha256").update(bytes).digest("hex");
          requireFact(
            sha256.parse(req.headers["x-content-sha256"]) === digest,
            "MEDIA_HASH_MISMATCH",
          );
          const temp = join(assetsDir, `${digest}.${randomUUID()}.tmp`);
          writeFileSync(temp, bytes, { mode: 0o600, flag: "wx" });
          renameSync(temp, join(assetsDir, digest));
          store.db
            .prepare("INSERT OR REPLACE INTO assets VALUES (?,?,?)")
            .run(digest, mime, bytes.length);
          result = { sha256: digest, fileRef: `runtime-asset:${digest}` };
        } else if (/^\/assets\/[a-f0-9]{64}$/.test(path) && req.method === "GET") {
          const digest = path.split("/").at(-1)!;
          res.setHeader(
            "Content-Type",
            (store.db.prepare("SELECT mime FROM assets WHERE sha256=?").get(digest)
              ?.mime as string) ?? "application/octet-stream",
          );
          res.end(readFileSync(join(assetsDir, digest)));
          return;
        } else if (path === "/evidence" && req.method === "GET") {
          const row = store.db
            .prepare("SELECT mime,body FROM evidence WHERE id=?")
            .get(url.searchParams.get("id") ?? "");
          requireFact(row, "EVIDENCE_NOT_FOUND");
          res.setHeader("Content-Type", row.mime as string);
          res.end(Buffer.from(row.body as Uint8Array));
          return;
        } else throw new RuntimeError("NOT_FOUND", 404);
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(result));
    } catch (error) {
      res.statusCode = error instanceof RuntimeError ? error.status : 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(errorBody(error)));
    }
  });
  const ws = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  http.on("upgrade", (req, socket, head) => {
    const bearer = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
    const device = Object.entries(options.deviceTokens).find(([, token]) =>
      safeEqual(bearer, token),
    )?.[0];
    if (!device || req.url !== "/agent" || req.headers.origin) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    ws.handleUpgrade(req, socket, head, (client) => {
      client.on("error", () => {
        /* disconnected agent is reconciled by its durable claim deadline */
      });
      client.on("message", (bytes) => {
        let messageId: string | undefined;
        try {
          const message = z
            .object({
              messageId: id,
              contractVersion: z.literal("design-v1"),
              sentAt: z.string().datetime({ offset: true }),
              type: z.enum([
                "PullTask",
                "PullPreparation",
                "PreparationReport",
                "BeginExecution",
                "ExecutionReceipt",
              ]),
              payload: z.unknown(),
            })
            .strict()
            .parse(JSON.parse(bytes.toString()));
          messageId = message.messageId;
          const response = store.transaction(() => {
            const key = JSON.stringify([device, message.messageId]);
            const serialized = JSON.stringify(message);
            const previous = store.db.prepare("SELECT * FROM messages WHERE id=?").get(key);
            if (previous) {
              requireFact(previous.payload === serialized, "ID_CONFLICT");
              return previous.response as string;
            }
            let payload: unknown;
            let responseType = "Accepted";
            if (message.type === "PullTask" || message.type === "PullPreparation") {
              const input = z
                .object({ deviceId: id, resourceStatus: z.literal("idle") })
                .strict()
                .parse(message.payload);
              requireFact(input.deviceId === device, "DEVICE_SESSION_MISMATCH");
              // Legacy clients may flush receipts, but may never bypass preparation.
              requireFact(message.type !== "PullTask", "AGENT_UPGRADE_REQUIRED");
              payload = runtime.pullPreparation(device);
              responseType = payload ? "PreparationLease" : "NoTask";
            } else if (message.type === "PreparationReport") {
              const input = z
                .object({ taskId: id, lease: id, report: z.unknown() })
                .strict()
                .parse(message.payload);
              payload = runtime.reportPreparation(device, input.taskId, input.lease, input.report);
            } else if (message.type === "BeginExecution") {
              const input = z.object({ taskId: id, lease: id }).strict().parse(message.payload);
              payload = runtime.pull(device, input);
              responseType = payload ? "PublishTaskDirective" : "NoTask";
            } else payload = runtime.receive(message.payload, device);
            const encoded = JSON.stringify({
              messageId: randomUUID(),
              contractVersion: "design-v1",
              sentAt: new Date().toISOString(),
              inReplyTo: messageId,
              type: responseType,
              payload,
            });
            store.db.prepare("INSERT INTO messages VALUES (?,?,?)").run(key, serialized, encoded);
            return encoded;
          });
          client.send(response);
        } catch (error) {
          client.send(
            JSON.stringify({
              messageId: randomUUID(),
              contractVersion: "design-v1",
              sentAt: new Date().toISOString(),
              inReplyTo: messageId,
              type: "Rejected",
              ...errorBody(error),
            }),
          );
        }
      });
    });
  });
  return {
    http,
    runtime,
    store,
    async close() {
      for (const client of ws.clients) client.terminate();
      await new Promise<void>((resolve) => ws.close(() => resolve()));
      if (http.listening)
        await new Promise<void>((resolve, reject) =>
          http.close((e) => (e ? reject(e) : resolve())),
        );
      store.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.SG_RUNTIME_PORT ?? 4318);
  const server = createRuntimeServer({
    dataDir: resolve(process.env.SG_RUNTIME_DATA ?? "../../.runtime"),
    port,
    token: process.env.SG_RUNTIME_TOKEN ?? "",
    signingKey: process.env.SG_MEDIA_SIGNING_KEY ?? "",
    deviceTokens: JSON.parse(process.env.SG_DEVICE_TOKENS ?? "{}"),
    mediaBaseUrl: process.env.SG_MEDIA_BASE_URL,
    allowedOrigins: process.env.SG_ALLOWED_ORIGINS?.split(","),
  });
  server.http.listen(port, "127.0.0.1", () =>
    console.info(`SocialGrowth runtime listening on 127.0.0.1:${port}`),
  );
  const shutdown = () =>
    void server.close().catch(() => {
      process.exitCode = 1;
    });
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
