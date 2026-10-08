import type { DeviceConnectionApi } from "./device-connection-api.js";
import { z } from "zod";
import { executorConsoleSchema, executorJobSchema, executorRequestSchema, executorChallengeSchema, type ExecutorConsole } from "@socialgrowth/product-contracts";
import { ProductTransactionError } from "./product-transaction-error.js";
import type { OperatorAuthService } from "./operator-auth-service.js";

type ConsoleAuth = Pick<OperatorAuthService, "authenticateSession">;
type Mutation = "bootstrap-handoff" | "bootstrap-initialization-resume" | "bootstrap-verifications" | "verifications" | "verifications/stop" | "supervision/respond" | "assistance/submit" | "assistance/cancel" | "device-control";
type Screenshot = "supervision" | "verifications" | "assistance";
export class ExecutorConsoleService {
  private readonly preparationOperations = new Set<string>();
  private readonly initializationDispatches = new Map<string, ExecutorConsole["phoneInitializationDispatches"][number]>();
  constructor(private readonly auth: ConsoleAuth, private readonly config: { url: string; token: string } | null, private readonly connections?: Pick<DeviceConnectionApi, "bootstrapDevices" | "preparationTarget" | "initializationTarget" | "handoffBootstrap">, private readonly automaticPhoneInitialization = false) {}
  private initializationTimer?: ReturnType<typeof setInterval>;
  private initializationTickRunning = false;
  onModuleInit() {
    if (!this.automaticPhoneInitialization || !this.config || !this.connections) return;
    this.initializationTimer = setInterval(() => { void this.initializeConnectedPhones(); }, 15000);
    this.initializationTimer.unref();
    void this.initializeConnectedPhones();
  }
  onModuleDestroy() { if (this.initializationTimer) clearInterval(this.initializationTimer); }
  async initializeConnectedPhones(): Promise<void> {
    if (!this.automaticPhoneInitialization || !this.config || !this.connections || this.initializationTickRunning) return;
    const connections = this.connections;
    this.initializationTickRunning = true;
    let devices: Awaited<ReturnType<DeviceConnectionApi["bootstrapDevices"]>>;
    try {
      devices = await connections.bootstrapDevices();
    } catch { return; /* Scope scan failed; do not infer device readiness. */ }
    finally { this.initializationTickRunning = false; }
    for (const id of this.initializationDispatches.keys()) if (!devices.some(d => d.deviceId === id)) this.initializationDispatches.delete(id);
    // Each phone has its own mutex. A slow connection or handoff cannot delay
    // dispatch for another phone; no operation is replayed on network loss.
    await Promise.allSettled(devices.map(async device => {
      if (!device.connected || this.preparationOperations.has(device.deviceId)) return;
      this.preparationOperations.add(device.deviceId);
      const dispatch = (state: ExecutorConsole["phoneInitializationDispatches"][number]["state"], reason?: ExecutorConsole["phoneInitializationDispatches"][number]["reason"]) => {
        this.initializationDispatches.set(device.deviceId, { deviceId: device.deviceId, state, updatedAt: new Date().toISOString(), ...(reason ? { reason } : {}) });
      };
      let phase: "connection_unconfirmed" | "executor_unconfirmed" | "handoff_unconfirmed" = "connection_unconfirmed";
      try {
        dispatch("dispatching");
        const target = await connections.initializationTarget(device.deviceId);
        phase = "executor_unconfirmed";
        // Same deterministic request ID on network loss; the runtime returns the
        // original job and never starts a second attempt, including unknowns.
        let original = await this.value(await this.request("phone-initializations", target));
        const recoverable = executorJobSchema.safeParse(original);
        if (recoverable.success && recoverable.data.deviceId === device.deviceId && recoverable.data.expectedName === "手机环境初始化"
          && recoverable.data.status === "finished" && recoverable.data.resultCode === "UNCONFIRMED" && !recoverable.data.initializationRecovery
          && recoverable.data.initializationStartupRecoveryCount !== undefined && recoverable.data.initializationStartupRecoveryCount < 2
          && Date.now() - Date.parse(recoverable.data.finishedAt ?? "") >= 30000) {
          try {
            // Only new-policy jobs qualify automatically; runtime independently
            // proves failed startup/zero actions/cleared engine locks and transfers
            // its own hold atomically. Unknown installs/configuration stay blocked.
            original = await this.value(await this.request("phone-initializations/resume", { ...target, id: recoverable.data.id, automatic: true }));
          } catch { dispatch("blocked", "original_requires_attention"); return; }
        }
        const completed = z.object({ deviceId: z.string().uuid(), status: z.literal("finished"), resultCode: z.literal("CONNECTIVITY_SETUP_COMPLETED"),
          managementAddress: z.string(), stability: z.object({ observedSeconds: z.number().min(300), transport: z.literal("tailnet_and_bootstrap") }) }).safeParse(original);
        if (device.mode === "bootstrap" && completed.success && completed.data.deviceId === device.deviceId) {
          // Rechecks the live node, enrollment and paired hardware before ending
          // bootstrap. Failed/unknown setup never triggers a handoff.
          phase = "handoff_unconfirmed";
          dispatch("handing_off");
          await connections.handoffBootstrap(device.deviceId, completed.data.managementAddress);
        }
        const result = z.object({ deviceId: z.literal(device.deviceId), status: z.string() }).safeParse(original);
        if (completed.success && completed.data.deviceId === device.deviceId) dispatch("completed");
        else if (result.success && result.data.status === "running") this.initializationDispatches.delete(device.deviceId);
        else dispatch("blocked", "original_requires_attention");
      } catch { dispatch("blocked", phase); /* Raw upstream bodies and credentials never reach the console. */ }
      finally { this.preparationOperations.delete(device.deviceId); }
    }));
  }
  private async request(path: string, body?: unknown): Promise<Response> {
    if (!this.config) throw new ProductTransactionError("FACT_VERSION_STALE", "执行服务尚未配置");
    try {
      return await fetch(new URL(`/api/runtime/${path}`, this.config.url), {
        method: body === undefined ? "GET" : "POST", signal: AbortSignal.timeout(20_000),
        headers: { authorization: `Bearer ${this.config.token}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new ProductTransactionError("INTERNAL_ERROR", "执行服务结果未确认。请查询原任务，勿重复提交。", true); }
  }
  private async value(response: Response): Promise<unknown> {
    const raw: unknown = await response.json();
    if (!response.ok || !raw || typeof raw !== "object" || ("ok" in raw && raw.ok === false)) {
      // No upstream raw message, credential or token reaches the browser.
      throw new ProductTransactionError(response.status < 500 ? "FACT_VERSION_STALE" : "INTERNAL_ERROR", "执行服务拒绝操作或结果未确认。请刷新原任务状态。", true);
    }
    return "ok" in raw && "value" in raw ? raw.value : raw;
  }
  async read(token: string): Promise<ExecutorConsole> {
    await this.auth.authenticateSession(token);
    const empty = { automaticPhoneInitialization: this.automaticPhoneInitialization, phoneInitializationDispatches: [...this.initializationDispatches.values()], configured: !!this.config, bootstrapDevices: this.connections ? await this.connections.bootstrapDevices() : [], available: false, tasks: [], holds: [], jobs: [], requests: [], challenges: [] };
    if (!this.config) return executorConsoleSchema.parse(empty);
    const raw = await this.value(await this.request("status"));
    if (!raw || typeof raw !== "object") throw new Error("EXECUTOR_STATUS_INVALID");
    const status = raw as Record<string, unknown>;
    const list = (value: unknown): Record<string, unknown>[] => {
      if (!Array.isArray(value) || value.some(item => !item || typeof item !== "object")) throw new Error("EXECUTOR_STATUS_INVALID");
      return value as Record<string, unknown>[];
    };
    const supervision = status.supervision as { requests: unknown };
    const options = status.verificationOptions as { available: boolean; deviceId?: string };
    return executorConsoleSchema.parse({ ...empty, available: options.available,
      ...(options.deviceId ? { deviceId: options.deviceId } : {}),
      tasks: list(status.tasks).map(task => {
        const body = task.task && typeof task.task === "object" ? task.task as Record<string, unknown> : task;
        const binding = body.binding && typeof body.binding === "object" ? body.binding as Record<string, unknown> : null;
        return { id: task.taskId, status: task.status, ...(typeof binding?.deviceId === "string" ? { deviceId: binding.deviceId } : {}) };
      }),
      holds: list(status.deviceHolds).map(hold => ({ device: hold.device, actor: hold.actor, since: hold.since })),
      jobs: list(status.verifications).map(job => executorJobSchema.parse(job)),
      requests: list(supervision.requests).map(request => executorRequestSchema.parse(request)),
      challenges: list(status.assistance).map(challenge => executorChallengeSchema.parse(challenge)),
    });
  }
  async mutate(token: string, csrf: string, path: Mutation, input: unknown): Promise<{ accepted: true }> {
    if (!csrf) throw new ProductTransactionError("AUTHORIZATION_DENIED", "需要当前登录的操作凭据");
    await this.auth.authenticateSession(token, csrf);
    const deviceId = path.startsWith("bootstrap-") ? z.object({ deviceId: z.string().uuid() }).parse(input).deviceId : null;
    if (deviceId && this.preparationOperations.has(deviceId)) throw new ProductTransactionError("FACT_VERSION_STALE", "该设备操作处理中，请查询原任务");
    if (deviceId) this.preparationOperations.add(deviceId);
    try {
    if (path === "bootstrap-handoff") {
      const request = z.strictObject({ deviceId: z.string().uuid(), address: z.string().max(128) }).parse(input);
      const state = await this.read(token);
      if (!this.connections || state.jobs.some(j => j.deviceId === request.deviceId && j.status === "running") || state.tasks.some(t => (!t.deviceId || t.deviceId === request.deviceId) && ["queued", "running", "unknown", "blocked"].includes(t.status)))
        throw new ProductTransactionError("FACT_VERSION_STALE", "请先等待设备任务结束，再切换管理连接");
      await this.connections.handoffBootstrap(request.deviceId, request.address);
    } else if (path === "bootstrap-initialization-resume") {
      const request = z.strictObject({ deviceId: z.string().uuid(), id: z.string().uuid() }).parse(input);
      if (!this.connections) throw new ProductTransactionError("FACT_VERSION_STALE", "手机连接尚未配置");
      const target = await this.connections.initializationTarget(request.deviceId);
      await this.value(await this.request("phone-initializations/resume", { ...target, id: request.id }));
    } else if (path === "bootstrap-verifications") {
      const request = z.strictObject({ deviceId: z.string().uuid(), requestId: z.string().uuid(), acknowledgePreparation: z.literal(true) }).parse(input);
      if (!this.connections) throw new ProductTransactionError("FACT_VERSION_STALE", "首次接入尚未配置");
      const target = await this.connections.preparationTarget(request.deviceId);
      await this.value(await this.request(path, { ...target, requestId: request.requestId }));
    } else await this.value(await this.request(path, input));
    return { accepted: true };
    } finally { if (deviceId) this.preparationOperations.delete(deviceId); }
  }
  async screenshot(token: string, kind: Screenshot, id: string, result: boolean): Promise<Buffer> {
    await this.auth.authenticateSession(token);
    const response = await this.request(`${kind}/screenshot?id=${encodeURIComponent(id)}${kind === "assistance" && result ? "&result=1" : ""}`);
    if (!response.ok || !response.headers.get("content-type")?.startsWith("image/png")) throw new ProductTransactionError("FACT_VERSION_STALE", "截图不可用");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 16 * 1024 * 1024 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("SCREENSHOT_INVALID");
    return bytes;
  }
}
