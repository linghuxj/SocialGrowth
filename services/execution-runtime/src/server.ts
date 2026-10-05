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
import { HumanAssistance, assistanceScopeSchema } from "./human-assistance.ts";
import { AppProvisioner } from "./app-readiness.ts";
import { IdentityOnboarding } from './identity-onboarding.ts';
import {
  WebVerification,
  verificationConfigSchema,
  type VerificationConfig,
} from "./web-verification.ts";
import { ScreenshotStore } from "./storage/screenshot-store.ts";
import { globalStepEventBus, stepEventSchema } from "./events/step-event-bus.ts";
import { listAdbDevices, captureDeviceScreen } from "./device-detector.ts";
import { BusinessPlanExecutionBridge } from "./business-plan-execution-bridge.ts";
import type { WebSocket } from "ws";

export interface ServerOptions {
  dataDir: string;
  token: string;
  signingKey: string;
  deviceTokens: Record<string, string>;
  port?: number;
  mediaBaseUrl?: string;
  allowedOrigins?: string[];
  verification?: VerificationConfig;
  businessPlanExecution?: {
    artemisRoot: string; runtimeUrl: string; token: string; deviceId: string;
    serial: string; bindingId: string; productDeviceId: string; productIdentityId: string;
    canonicalIdentityRef: string; accountId: string; runtimeAccountId: string; pageName: string; callbackUrl: string;
  };
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
  const assistance = new HumanAssistance(store);
  const executionBridge = options.businessPlanExecution
    ? new BusinessPlanExecutionBridge(store, assistance, { dataDir: options.dataDir, ...options.businessPlanExecution })
    : null;
  const apps = new AppProvisioner({
    catalogPath: process.env.SG_APP_CATALOG,
    buildTools: process.env.SG_ANDROID_BUILD_TOOLS,
  });
  const verification = new WebVerification(store, assistance, options.verification);
  const onboarding = new IdentityOnboarding(store, assistance, options.verification);
  const runtime = new ExecutionRuntime(store, {
    signingKey: options.signingKey,
    mediaBaseUrl: options.mediaBaseUrl ?? `http://127.0.0.1:${options.port ?? 4318}`,
    hasAsset: (sha) => existsSync(join(assetsDir, sha)),
    canExecuteAsset: (sha) =>
      store.db.prepare("SELECT mime FROM assets WHERE sha256=?").get(sha)?.mime === "video/mp4",
  });
  const screenshotStore = new ScreenshotStore();
  const webClients = new Set<WebSocket>();
  const broadcastToWebClients = (msg: unknown) => {
    const str = JSON.stringify(msg);
    for (const client of webClients) {
      if (client.readyState === 1) {
        client.send(str);
      }
    }
  };

  const http = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const normalizedPathname = url.pathname.replace(/(?<=.)\/$/, "");
      const path = normalizedPathname.replace(/^\/api\/runtime/, "") || "/";
      requireFact(url.pathname.startsWith("/api/runtime/"), "NOT_FOUND");
      if (req.headers.origin)
        requireFact(
          (options.allowedOrigins ?? ["http://localhost:3000", "http://127.0.0.1:3000"]).includes(
            req.headers.origin,
          ),
          "ORIGIN_REJECTED",
        );

      const screenshotMatch = path.match(/^\/screenshots\/(.+)$/);
      if (screenshotMatch && req.method === "GET") {
        const rawKey = screenshotMatch[1];
        const key = rawKey.startsWith("screenshots/") ? rawKey : `screenshots/${rawKey}`;
        const screenshot = await screenshotStore.getScreenshot(key);
        requireFact(screenshot, "SCREENSHOT_NOT_FOUND");
        res.setHeader("Content-Type", screenshot.contentType);
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.end(screenshot.buffer);
        return;
      }

      if (path === "/events/stream" && req.method === "GET") {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        if (typeof (res as any).flushHeaders === "function") (res as any).flushHeaders();

        const initial = globalStepEventBus.getAllLatest();
        res.write(`event: init\ndata: ${JSON.stringify(initial)}\n\n`);

        const unsubscribe = globalStepEventBus.onStep((event) => {
          res.write(`event: step\ndata: ${JSON.stringify(event)}\n\n`);
        });

        req.on("close", () => {
          unsubscribe();
        });
        return;
      }

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
      // Scoped capability routes: no device/operator token, no WS persistence of secrets.
      if (path.startsWith("/assistance/agent/")) {
        const session = assistance.session(bearer);
        let value: unknown;
        if (path === "/assistance/agent/session" && req.method === "GET")
          value = {
            sessionId: session.id,
            ...session.scope,
            control: assistance.supervision.get(session.id),
          };
        else if (path === "/assistance/agent/gate" && req.method === "POST") {
          const input = z.object({ action: z.string().max(80), category: z.enum(["read","navigate","login_submit","recovery","install","publish","create_identity","correct_account","unmanaged"]) }).strict().parse(JSON.parse((await body(req, 2048)).toString()));
          if (session.scope.mode === "execution" && executionBridge?.ownsOperation(session.scope.taskId))
            await executionBridge.authorizeAction(session.scope.taskId, input.action, input.category);
          value = assistance.supervision.gate(session.id, input);
        }
        else if (path === "/assistance/agent/finish-observation" && req.method === "POST")
          value = assistance.supervision.finishObservation(session.id);
        else if (path === "/assistance/agent/ensure-app" && req.method === "POST")
          value = await assistance.supervision.ensureApp(session.id, () =>
            apps.ensure(session.scope.serial, session.scope.packageName),
          );
        else if (path === "/assistance/agent/stop" && req.method === "POST") {
          const input = z
            .object({ reason: z.string().regex(/^[A-Z_]{1,80}$/) })
            .strict()
            .parse(JSON.parse((await body(req, 2048)).toString()));
          value = assistance.supervision.stop(session.id, input.reason);
        } else if (path === "/assistance/agent/credential-begin" && req.method === "POST") {
          const input = z
            .object({ kind: z.enum(["password", "otp"]) })
            .strict()
            .parse(JSON.parse((await body(req, 2048)).toString()));
          value = assistance.beginCredential(bearer, input.kind);
        } else if (path === "/assistance/agent/request" && req.method === "POST")
          value = assistance.supervision.create(
            session.id,
            JSON.parse((await body(req, 9 * 1024 * 1024)).toString()),
          );
        else if (path === "/assistance/agent/claim-response" && req.method === "POST")
          value = assistance.supervision.claim(
            session.id,
            id.parse(JSON.parse((await body(req, 2048)).toString()).id),
          );
        else if (path === "/assistance/agent/revalidate" && req.method === "POST")
          value = assistance.supervision.revalidate(
            session.id,
            JSON.parse((await body(req, 9 * 1024 * 1024)).toString()),
          );
        else if (path === "/assistance/agent/challenge" && req.method === "POST")
          value = assistance.create(
            bearer,
            JSON.parse((await body(req, 9 * 1024 * 1024)).toString()),
          );
        else if (path === "/assistance/agent/report" && req.method === "POST")
          value = assistance.report(
            bearer,
            JSON.parse((await body(req, 9 * 1024 * 1024)).toString()),
          );
        else if (path === "/assistance/agent/claim" && req.method === "POST")
          value = assistance.claim(
            bearer,
            id.parse(JSON.parse((await body(req, 2048)).toString()).id),
          );
        else if (path === "/assistance/agent/finish" && req.method === "POST") {
          const input = JSON.parse((await body(req, 2048)).toString());
          value = assistance.finish(bearer, id.parse(input.id), { resultCode: input.resultCode });
        } else if (path === "/assistance/agent/close" && req.method === "POST") {
          assistance.closeSession(bearer);
          value = { ok: true };
        } else throw new RuntimeError("NOT_FOUND", 404);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(value));
        return;
      }
      requireFact(operator || device, "AUTHENTICATION_REQUIRED");
      let result: unknown;
      if (path === "/assistance/sessions" && req.method === "POST") {
        const input = assistanceScopeSchema.parse(JSON.parse((await body(req, 4096)).toString()));
        requireFact(input.policy?.mode !== 'onboarding' && !input.policy?.allowIdentityCreation, 'USE_SCOPED_ONBOARDING_WORKFLOW');
        requireFact(input.mode !== "diagnostic" || operator, "OPERATOR_REQUIRED");
        requireFact(operator || device === input.deviceId, "DEVICE_SESSION_MISMATCH");
        requireFact(Object.hasOwn(options.deviceTokens, input.deviceId), "DEVICE_UNKNOWN");
        if (input.mode === "execution") {
          const t = runtime
            .tasks()
            .find((t) => t.taskId === input.taskId && t.status === "running")?.task;
          requireFact(
            t &&
              t.binding.deviceId === input.deviceId &&
              t.binding.serial === input.serial &&
              t.binding.platformIdentity === input.expectedIdentity &&
              t.directive.targetAppPackage === input.packageName &&
              Date.parse(input.expiresAt) <= Date.parse(t.directive.expiresAt),
            "ASSISTANCE_TASK_SCOPE_INVALID",
          );
        } else {
          requireFact(
            store.db.prepare("SELECT 1 FROM device_holds WHERE device=?").get(input.deviceId),
            "DIAGNOSTIC_DEVICE_HOLD_REQUIRED",
          );
          requireFact(
            !runtime
              .tasks()
              .some((t) => t.status === "running" && t.task.binding.deviceId === input.deviceId),
            "DEVICE_BUSY",
          );
        }
        result = assistance.open(input);
      } else if (path === "/evidence" && req.method === "POST" && (device || operator)) {
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
        if (path === "/business-plan-executions" && req.method === "POST") {
          requireFact(executionBridge, "BUSINESS_PLAN_EXECUTOR_UNAVAILABLE");
          result = await executionBridge.start(JSON.parse((await body(req, 1024 * 1024)).toString()));
        } else if ((path === "/business-plan-executions" || path.startsWith("/business-plan-executions/")) && req.method === "GET") {
          requireFact(executionBridge, "BUSINESS_PLAN_EXECUTOR_UNAVAILABLE");
          result = path === "/business-plan-executions" ? executionBridge.list() : executionBridge.read(path.split("/").at(-1)!);
        } else if (path === '/onboarding' && req.method === 'POST')
          result = onboarding.start(JSON.parse((await body(req, 4096)).toString()));
        else if (path === '/onboarding/stop' && req.method === 'POST')
          result = onboarding.stop(id.parse(JSON.parse((await body(req, 2048)).toString()).id));
        else if (path === '/onboarding/end-stopped' && req.method === 'POST')
          result = await onboarding.endStoppedVerification(id.parse(JSON.parse((await body(req, 2048)).toString()).id));
        else if (path === '/onboarding/screenshot' && req.method === 'GET') {
          res.setHeader('Content-Type', 'image/png');
          res.end(Buffer.from(onboarding.screenshot(id.parse(url.searchParams.get('id'))))); return;
        } else if (path === '/onboarding/bind' && req.method === 'POST') {
          const jobId = id.parse(JSON.parse((await body(req, 2048)).toString()).id);
          const job = onboarding.list().find((j) => j.id === jobId);
          requireFact(job?.status === 'verified' && job.identityUrl && job.finishedAt, 'IDENTITY_NOT_VERIFIED');
          requireFact(Date.now() - Date.parse(job.finishedAt) < 86400000, 'IDENTITY_VERIFICATION_EXPIRED');
          const state = store.snapshot().state;
          const relation = state.accountServiceRelations.find((r) => r.projectId === job.projectId && r.accountId === job.accountId && !r.revokedAt && r.allowedActions.includes('publish') && Date.parse(r.validFrom) <= Date.now() && (!r.validUntil || Date.parse(r.validUntil) > Date.now()));
          requireFact(relation && state.projects.some((p) => p.id === job.projectId && p.status === 'active'), 'ACCOUNT_AUTHORIZATION_REQUIRED');
          const existing = runtime.bindings().find((b) => b.accountId === job.accountId);
          requireFact(!existing || existing.platformIdentity === job.identityUrl, 'BINDING_CORRECTION_REQUIRES_REVIEW');
          result = runtime.bind({ id: existing?.id ?? `identity-${job.id}`, deviceId: job.deviceId, serial: job.serial, platform: job.platform, accountId: job.accountId, platformIdentity: job.identityUrl, authorizationRef: relation.authorizationRef, automationScopeRef: job.authorizationRef, verifiedAt: job.finishedAt, validUntil: relation.validUntil ?? new Date(Date.now() + 86400000 * 30).toISOString() }, 'operator');
        } else if (path === "/verifications" && req.method === "POST")
          result = verification.start(JSON.parse((await body(req, 4096)).toString()));
        else if (path === "/verifications/stop" && req.method === "POST")
          result = verification.stop(id.parse(JSON.parse((await body(req, 2048)).toString()).id));
        else if (path === "/supervision/respond" && req.method === "POST") {
          const { id: requestId, ...input } = JSON.parse((await body(req, 8192)).toString());
          result = assistance.supervision.respond(id.parse(requestId), input);
        } else if (path === "/supervision/screenshot" && req.method === "GET") {
          res.setHeader("Content-Type", "image/png");
          res.end(
            Buffer.from(assistance.supervision.screenshot(id.parse(url.searchParams.get("id")))),
          );
          return;
        } else if (path === "/verifications/screenshot" && req.method === "GET") {
          res.setHeader("Content-Type", "image/png");
          res.end(Buffer.from(verification.screenshot(id.parse(url.searchParams.get("id")))));
          return;
        } else if (path === "/assistance" && req.method === "GET") result = assistance.list();
        else if (path === "/assistance/screenshot" && req.method === "GET") {
          res.setHeader("Content-Type", "image/png");
          res.end(
            Buffer.from(
              assistance.screenshot(
                id.parse(url.searchParams.get("id")),
                url.searchParams.get("result") === "1",
              ),
            ),
          );
          return;
        } else if (path === "/assistance/submit" && req.method === "POST") {
          const { id: challengeId, ...input } = JSON.parse((await body(req, 4096)).toString());
          result = assistance.submit(id.parse(challengeId), input);
        } else if (path === "/assistance/cancel" && req.method === "POST")
          result = assistance.cancel(id.parse(JSON.parse((await body(req, 2048)).toString()).id));
        else if (path === "/state" && req.method === "GET") {
          runtime.reconcile();
          result = store.snapshot();
        } else if (path === "/status" && req.method === "GET") {
          runtime.reconcile();
          result = {
            bindings: runtime.bindings(),
            tasks: runtime.tasks(),
            preparations: runtime.preparations(),
            deviceHolds: store.db.prepare("SELECT * FROM device_holds").all(),
            assistance: assistance.list(),
            supervision: {
              controls: assistance.supervision.controls(),
              requests: assistance.supervision.requests(),
              events: assistance.supervision.events(),
            },
            verificationOptions: verification.options(),
            verifications: verification.list(),
            onboarding: onboarding.list(),
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
          requireFact(!assistance.deviceBusy(input.deviceId), "ASSISTANCE_DEVICE_BUSY");
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
        } else if (path === "/events/step" && req.method === "POST") {
          const payload = JSON.parse((await body(req, 1024 * 1024)).toString());
          const published = globalStepEventBus.publish(payload);
          broadcastToWebClients({ type: "step", event: published });
          result = { ok: true, event: published };
        } else if (path === "/devices/screenshot-step" && req.method === "POST") {
          const workerId = (req.headers["x-worker-id"] as string) || "worker01";
          const deviceId = (req.headers["x-device-id"] as string) || "phone01";
          const serial = (req.headers["x-serial"] as string) || deviceId;
          const sessionId = (req.headers["x-session-id"] as string) || `sess_${Date.now()}`;
          const step = parseInt((req.headers["x-step"] as string) || "1", 10);
          const type = ((req.headers["x-type"] as string) || "post") as any;
          const status = ((req.headers["x-status"] as string) || "running") as any;
          const action = (req.headers["x-action"] as string) || "step";
          const rawDesc = (req.headers["x-action-desc"] as string) || "";
          let actionDesc = rawDesc;
          try { actionDesc = decodeURIComponent(rawDesc); } catch {}

          const imageBytes = await body(req, 30 * 1024 * 1024);
          const uploadResult = await screenshotStore.uploadScreenshot(imageBytes, {
            workerId,
            deviceId: serial || deviceId,
            sessionId,
            step,
          });

          const published = globalStepEventBus.publish({
            workerId,
            deviceId,
            serial,
            sessionId,
            step,
            type,
            status,
            action,
            actionDesc,
            imageKey: uploadResult.imageKey,
          });
          broadcastToWebClients({ type: "step", event: published });
          result = { ok: true, imageKey: uploadResult.imageKey, event: published };
        } else if (path === "/devices/states" && req.method === "GET") {
          const adbDevices = await listAdbDevices();
          const bindings = runtime.bindings();
          const tasks = runtime.tasks();
          const challenges = assistance.list();
          const holds = store.db.prepare("SELECT * FROM device_holds").all() as Array<{ device: string }>;

          const deviceMap = new Map<string, any>();

          // 1. Process all ADB connected devices
          for (const adb of adbDevices) {
            const binding = bindings.find((b) => b.serial === adb.serial || b.deviceId === adb.serial);
            const runningTask = tasks.find((t) => t.task.binding.serial === adb.serial && t.status === "running");
            const activeChallenge = challenges.find((c) => c.deviceId === adb.serial && (c.status === "waiting" || c.status === "claimed"));
            const isHeld = holds.some((h) => h.device === adb.serial);
            const latestEvt = globalStepEventBus.getLatest(adb.serial);

            let status: "running" | "idle" | "blocked" | "completed" | "failed" | "offline" = "idle";
            let action = "standby";
            let actionDesc = "物理真机已在线就绪，等待排期派发";

            if (adb.state !== "device") {
              status = "offline";
              actionDesc = `设备连接异常: ${adb.state}`;
            } else if (activeChallenge) {
              status = "blocked";
              action = activeChallenge.kind === "password" ? "human_password_input" : "challenge";
              actionDesc = activeChallenge.kind === "password" ? "等待人工输入密码" : "账号安全验证挑战待处理";
            } else if (isHeld) {
              status = "blocked";
              action = "diagnostic_hold";
              actionDesc = "设备处于人工诊断接管状态";
            } else if (runningTask) {
              status = "running";
              action = latestEvt?.action || "execute_task";
              actionDesc = latestEvt?.actionDesc || `正在执行任务 ${runningTask.taskId}`;
            } else if (latestEvt) {
              status = latestEvt.status;
              action = latestEvt.action;
              actionDesc = latestEvt.actionDesc;
            }

            let imageKey = latestEvt?.imageKey;
            // If online and no screenshot captured yet, try a quick capture
            if (!imageKey && adb.state === "device" && url.searchParams.get("capture") === "1") {
              const pngBytes = await captureDeviceScreen(adb.serial);
              if (pngBytes) {
                try {
                  const uploadResult = await screenshotStore.uploadScreenshot(pngBytes, {
                    workerId: "worker01",
                    deviceId: adb.serial,
                    sessionId: `init_${Date.now()}`,
                    step: 0,
                  });
                  imageKey = uploadResult.imageKey;
                } catch {}
              }
            }

            deviceMap.set(adb.serial, {
              deviceId: binding?.deviceId || adb.serial,
              serial: adb.serial,
              model: adb.model ? `${adb.model} (Galaxy S23)` : "Samsung Galaxy S23",
              workerId: "worker01",
              step: latestEvt?.step || (runningTask ? 1 : 0),
              totalSteps: latestEvt?.totalSteps,
              type: runningTask ? "post" : "idle",
              status,
              action,
              actionDesc,
              imageKey,
              platform: binding?.platform || "facebook",
              platformIdentity: binding?.platformIdentity || "未绑定专属账号",
              isPhysical: true,
              adbStatus: adb.state,
              timestamp: latestEvt?.timestamp || Date.now(),
            });
          }

          // 2. Add bound devices that are not connected via ADB as offline
          for (const binding of bindings) {
            if (!deviceMap.has(binding.serial)) {
              const latestEvt = globalStepEventBus.getLatest(binding.serial);
              deviceMap.set(binding.serial, {
                deviceId: binding.deviceId,
                serial: binding.serial,
                model: "物理真机 (离线)",
                workerId: "worker01",
                step: latestEvt?.step || 0,
                type: "idle",
                status: "offline",
                action: "disconnected",
                actionDesc: "物理设备未连接，请检查 USB 连接或 ADB 授权",
                imageKey: latestEvt?.imageKey,
                platform: binding.platform,
                platformIdentity: binding.platformIdentity,
                isPhysical: true,
                adbStatus: "offline",
                timestamp: latestEvt?.timestamp || Date.now(),
              });
            }
          }

          // 3. Add any devices that have published step events
          for (const evt of globalStepEventBus.getAllLatest()) {
            const key = evt.deviceId;
            if (key && !deviceMap.has(key)) {
              deviceMap.set(key, {
                deviceId: evt.deviceId,
                serial: evt.deviceId,
                model: "移动终端设备",
                workerId: evt.workerId,
                step: evt.step,
                totalSteps: evt.totalSteps,
                type: evt.type,
                status: evt.status,
                action: evt.action,
                actionDesc: evt.actionDesc,
                imageKey: evt.imageKey,
                platform: evt.platform || "facebook",
                platformIdentity: evt.platformIdentity || "未绑定",
                timestamp: evt.timestamp,
              });
            }
          }

          result = { ok: true, devices: Array.from(deviceMap.values()) };
        } else if (path === "/devices/refresh" && req.method === "POST") {
          const reqBody = (await body(req, 4096)).toString();
          const input = reqBody ? JSON.parse(reqBody) : {};
          const serial = input.serial || input.deviceId || "RFCW40MYYCV";
          const pngBytes = await captureDeviceScreen(serial);
          requireFact(pngBytes, "DEVICE_SCREENSHOT_FAILED");
          const uploadResult = await screenshotStore.uploadScreenshot(pngBytes, {
            workerId: "worker01",
            deviceId: serial,
            sessionId: `refresh_${Date.now()}`,
            step: 0,
          });
          const published = globalStepEventBus.publish({
            workerId: "worker01",
            deviceId: serial,
            sessionId: `refresh_${Date.now()}`,
            step: 0,
            type: "idle",
            status: "idle",
            action: "manual_refresh",
            actionDesc: "已捕获物理真机实时屏幕快照",
            imageKey: uploadResult.imageKey,
            timestamp: Date.now(),
          });
          broadcastToWebClients({ type: "step", event: published });
          result = { ok: true, deviceId: serial, imageKey: uploadResult.imageKey, event: published };
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
    if (req.url === "/events" || req.url === "/api/runtime/ws/events") {
      ws.handleUpgrade(req, socket, head, (client) => {
        webClients.add(client);
        client.on("close", () => webClients.delete(client));
        client.on("error", () => webClients.delete(client));
        client.send(JSON.stringify({ type: "init", devices: globalStepEventBus.getAllLatest() }));
      });
      return;
    }
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
    assistance,
    executionBridge,
    async close() {
      await verification.close();
      await onboarding.close();
      for (const client of ws.clients) client.terminate();
      await new Promise<void>((resolve) => ws.close(() => resolve()));
      if (http.listening)
        await new Promise<void>((resolve, reject) =>
          http.close((e) => (e ? reject(e) : resolve())),
        );
      assistance.close();
      store.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.SG_RUNTIME_PORT ?? 4318);
  const dataDir = resolve(process.env.SG_RUNTIME_DATA ?? "../../.runtime");
  const verificationConfigPath = join(dataDir, "web-verification.json");
  const server = createRuntimeServer({
    dataDir,
    port,
    token: process.env.SG_RUNTIME_TOKEN ?? "",
    signingKey: process.env.SG_MEDIA_SIGNING_KEY ?? "",
    deviceTokens: JSON.parse(process.env.SG_DEVICE_TOKENS ?? "{}"),
    mediaBaseUrl: process.env.SG_MEDIA_BASE_URL,
    allowedOrigins: process.env.SG_ALLOWED_ORIGINS?.split(","),
    businessPlanExecution: process.env.SG_PRODUCT_EXECUTION_RUNTIME_TOKEN && process.env.SG_PRODUCT_EXECUTION_RUNTIME_BINDING_ID
      && process.env.SG_PRODUCT_EXECUTION_IDENTITY_ID && process.env.SG_PRODUCT_EXECUTION_CANONICAL_REF
      && process.env.SG_PRODUCT_EXECUTION_ACCOUNT_ID && process.env.SG_PRODUCT_EXECUTION_RUNTIME_ACCOUNT_ID && process.env.SG_PRODUCT_EXECUTION_PAGE_NAME
      ? { artemisRoot: process.env.SG_ARTEMIS_ROOT ?? "", runtimeUrl: `http://127.0.0.1:${port}`,
          token: process.env.SG_PRODUCT_EXECUTION_RUNTIME_TOKEN, deviceId: process.env.SG_PRODUCT_EXECUTION_SERIAL ?? "",
          serial: process.env.SG_PRODUCT_EXECUTION_SERIAL ?? "", bindingId: process.env.SG_PRODUCT_EXECUTION_RUNTIME_BINDING_ID,
          productDeviceId: process.env.SG_PRODUCT_EXECUTION_DEVICE_ID ?? "",
          productIdentityId: process.env.SG_PRODUCT_EXECUTION_IDENTITY_ID,
          canonicalIdentityRef: process.env.SG_PRODUCT_EXECUTION_CANONICAL_REF,
          accountId: process.env.SG_PRODUCT_EXECUTION_ACCOUNT_ID,
          runtimeAccountId: process.env.SG_PRODUCT_EXECUTION_RUNTIME_ACCOUNT_ID,
          pageName: process.env.SG_PRODUCT_EXECUTION_PAGE_NAME,
          callbackUrl: process.env.SG_PRODUCT_EXECUTION_CALLBACK_URL ?? "http://127.0.0.1:4320" }
      : undefined,
    verification: process.env.SG_WEB_VERIFICATION_MEDIA
      ? {
          artemisRoot: process.env.SG_ARTEMIS_ROOT ?? "",
          deviceId: process.env.SG_DEVICE_ID ?? "",
          serial: process.env.SG_DEVICE_SERIAL ?? "",
          mediaPath: resolve(process.env.SG_WEB_VERIFICATION_MEDIA),
          mediaSha256: process.env.SG_WEB_VERIFICATION_SHA256 ?? "",
          runtimeUrl: `http://127.0.0.1:${port}`,
        }
      : existsSync(verificationConfigPath)
        ? verificationConfigSchema.parse({
            ...JSON.parse(readFileSync(verificationConfigPath, "utf8")),
            runtimeUrl: `http://127.0.0.1:${port}`,
          })
        : undefined,
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
