import { executorConsoleSchema, executorJobSchema, executorRequestSchema, executorChallengeSchema, type ExecutorConsole } from "@socialgrowth/product-contracts";
import { ProductTransactionError } from "./product-transaction-error.js";
import type { OperatorAuthService } from "./operator-auth-service.js";

type ConsoleAuth = Pick<OperatorAuthService, "authenticateSession">;
type Mutation = "verifications" | "verifications/stop" | "supervision/respond" | "assistance/submit" | "assistance/cancel" | "device-control";
type Screenshot = "supervision" | "verifications" | "assistance";
export class ExecutorConsoleService {
  constructor(private readonly auth: ConsoleAuth, private readonly config: { url: string; token: string } | null) {}
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
    const empty = { configured: !!this.config, available: false, tasks: [], holds: [], jobs: [], requests: [], challenges: [] };
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
      tasks: list(status.tasks).map(task => ({ id: task.taskId, status: task.status })),
      holds: list(status.deviceHolds).map(hold => ({ device: hold.device, actor: hold.actor, since: hold.since })),
      jobs: list(status.verifications).map(job => executorJobSchema.parse(job)),
      requests: list(supervision.requests).map(request => executorRequestSchema.parse(request)),
      challenges: list(status.assistance).map(challenge => executorChallengeSchema.parse(challenge)),
    });
  }
  async mutate(token: string, csrf: string, path: Mutation, input: unknown): Promise<{ accepted: true }> {
    if (!csrf) throw new ProductTransactionError("AUTHORIZATION_DENIED", "需要当前登录的操作凭据");
    await this.auth.authenticateSession(token, csrf);
    await this.value(await this.request(path, input));
    return { accepted: true };
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
