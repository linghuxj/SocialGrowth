import { createHash, randomUUID } from "node:crypto";
import { z } from "zod-v3";
import { requireFact } from "./contracts.js";
import type { RuntimeStore } from "./store.js";

export const executionPolicy = z
  .object({
    version: z.literal("agent-supervision-v1").default("agent-supervision-v1"),
    mode: z.enum(["observe", "preflight", "onboarding", "client_test", "connectivity_test"]).default("preflight"),
    maxRecovery: z.number().int().min(0).max(2).default(2),
    // Creating identities/correcting bindings and publication remain separate workflows.
    allowPublication: z.literal(false).default(false),
    allowTrustedInstall: z.boolean().default(false),
    allowIdentityCreation: z.boolean().default(false),
    allowParticipationWithdrawal: z.boolean().default(false),
    allowNetworkCoexistenceCheck: z.boolean().default(false),
    allowPhoneInitialization: z.boolean().default(false),
    allowLogin: z.boolean().default(true),
  })
  .strict();
type Policy = z.infer<typeof executionPolicy>;
type Control = {
  sessionId: string;
  taskId: string;
  deviceId: string;
  expectedIdentity: string;
  expiresAt: string;
  policy: Policy;
  state: "active" | "waiting" | "revalidate" | "stopped" | "closed";
  reason?: string;
  passwordAttempts: number;
  otpAttempts: number;
  loginSubmits: number;
  recoveryAttempts: number;
  installAttempts?: number;
  identityCreationAttempts?: number;
  credentialReady?: boolean;
  reportedResult?: "OBSERVATION_COMPLETED";
};
const requestInput = z
  .object({
    traceId: z.string().uuid(),
    kind: z.enum(["content", "approval", "manual", "clarification"]),
    reason: z.enum([
      "MISSING_CONTENT",
      "APP_MISSING",
      "ACCOUNT_MISMATCH",
      "CREATE_IDENTITY",
      "APP_CRASH",
      "NETWORK_TIMEOUT",
      "ACCOUNT_RESTRICTED",
      "SECURITY_CHALLENGE",
      "OTHER",
    ]),
    message: z.string().trim().min(1).max(1000),
    screenshot: z.string().max(8 * 1024 * 1024),
  })
  .strict();
type Request = z.infer<typeof requestInput> & {
  id: string;
  sessionId: string;
  taskId: string;
  deviceId: string;
  expectedIdentity: string;
  expiresAt: string;
  createdAt: string;
  status:
    | "waiting"
    | "responded"
    | "claimed"
    | "verified"
    | "cancelled"
    | "expired"
    | "interrupted";
  response?: { decision: "provided" | "approved" | "completed"; text: string };
};
const png = (value: string) => {
  const bytes = Buffer.from(value, "base64");
  requireFact(
    bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
    "SCREENSHOT_PNG_REQUIRED",
  );
  return bytes;
};

/** Stores public task facts only. Credentials stay in HumanAssistance's bounded memory. */
export class Supervision {
  constructor(
    private store: RuntimeStore,
    private now = Date.now,
  ) {
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS agent_controls (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS agent_requests (id TEXT PRIMARY KEY, body TEXT NOT NULL, screenshot BLOB NOT NULL); CREATE TABLE IF NOT EXISTS agent_events (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, body TEXT NOT NULL)",
    );
    for (const c of this.controls())
      if (!["closed", "stopped"].includes(c.state)) this.stop(c.sessionId, "RUNTIME_RESTARTED");
    for (const r of this.requests())
      if (["waiting", "responded", "claimed"].includes(r.status))
        this.saveRequest({ ...r, status: "interrupted" });
  }
  controls(): Control[] {
    return this.store.db
      .prepare("SELECT body FROM agent_controls ORDER BY rowid DESC")
      .all()
      .map((r) => JSON.parse(r.body as string));
  }
  requests(): Omit<Request, "screenshot">[] {
    return this.store.db
      .prepare("SELECT body FROM agent_requests ORDER BY rowid DESC")
      .all()
      .map((r) => JSON.parse(r.body as string));
  }
  events() {
    return this.store.db
      .prepare("SELECT body FROM agent_events ORDER BY rowid DESC LIMIT 500")
      .all()
      .map((r) => JSON.parse(r.body as string));
  }
  private save(c: Control) {
    this.store.db
      .prepare(
        "INSERT INTO agent_controls VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      )
      .run(c.sessionId, JSON.stringify(c));
    return c;
  }
  private saveRequest(r: Omit<Request, "screenshot">) {
    this.store.db
      .prepare("UPDATE agent_requests SET body=? WHERE id=?")
      .run(JSON.stringify(r), r.id);
    return r;
  }
  event(sessionId: string, type: string, code: string) {
    const c = this.get(sessionId, false);
    const e = {
      id: randomUUID(),
      taskId: c.taskId,
      sessionId,
      at: new Date(this.now()).toISOString(),
      type,
      code,
    };
    this.store.db
      .prepare("INSERT INTO agent_events VALUES (?,?,?)")
      .run(e.id, c.taskId, JSON.stringify(e));
  }
  open(
    scope: Pick<Control, "sessionId" | "taskId" | "deviceId" | "expectedIdentity" | "expiresAt">,
    policy?: unknown,
    reviewedReadOnlyRetry = false,
  ) {
    const prior = this.controls().filter(
      (c) => c.taskId === scope.taskId && c.deviceId === scope.deviceId,
    );
    requireFact(prior.length === 0 || (reviewedReadOnlyRetry && executionPolicy.parse(policy ?? {}).mode === "preflight"
      && prior.every(c => ["closed", "stopped"].includes(c.state) && c.expectedIdentity === scope.expectedIdentity
        && c.policy.mode === "preflight" && !c.policy.allowPublication)), "TASK_RESTART_REQUIRES_REVIEW");
    const c = this.save({
      ...scope,
      policy: executionPolicy.parse(policy ?? {}),
      state: "active",
      passwordAttempts: 0,
      otpAttempts: 0,
      loginSubmits: 0,
      recoveryAttempts: 0,
    });
    this.event(c.sessionId, "opened", c.policy.mode);
    return c;
  }
  get(id: string, expire = true): Control {
    const row = this.store.db.prepare("SELECT body FROM agent_controls WHERE id=?").get(id);
    requireFact(row, "CONTROL_NOT_FOUND");
    let c: Control = JSON.parse(row.body as string);
    if (expire && Date.parse(c.expiresAt) <= this.now() && !["stopped", "closed"].includes(c.state))
      c = this.stop(id, "EXPIRED");
    return c;
  }
  stop(id: string, reason: string) {
    const current = this.get(id, false);
    if (current.state === "stopped") return current;
    const c = this.save({
      ...current,
      state: "stopped",
      reason,
      credentialReady: false,
    });
    this.event(id, "stopped", reason);
    return c;
  }
  close(id: string) {
    const c = this.get(id, false);
    if (c.state !== "stopped") this.save({ ...c, state: "closed", credentialReady: false });
    for (const r of this.requests())
      if (r.sessionId === id && ["waiting", "responded", "claimed"].includes(r.status))
        this.saveRequest({ ...r, status: "interrupted" });
  }
  credential(id: string, kind: "password" | "otp") {
    const c = this.get(id);
    requireFact(c.policy.allowLogin !== false, "LOGIN_NOT_AUTHORIZED");
    requireFact(c.state === "active" && !["observe", "client_test", "connectivity_test"].includes(c.policy.mode), "CONTROL_NOT_ACTIVE");
    const key = kind === "password" ? "passwordAttempts" : "otpAttempts";
    requireFact(c[key] === 0, "CREDENTIAL_BUDGET_EXHAUSTED");
    this.save({ ...c, [key]: 1, state: "waiting", credentialReady: false });
    this.event(id, "credential_requested", kind);
  }
  credentialFilled(id: string) {
    const c = this.get(id);
    requireFact(c.state === "waiting", "CONTROL_NOT_WAITING");
    this.save({ ...c, state: "active", credentialReady: true });
    this.event(id, "credential_filled", "NOT_AUTHENTICATED");
  }
  gate(id: string, raw: unknown) {
    const input = z
      .object({
        action: z.string().max(80),
        category: z.enum([
          "read",
          "navigate",
          "login_submit",
          "recovery",
          "install",
          "publish",
          "create_identity",
          "correct_account",
          "unmanaged",
        ]),
      })
      .strict()
      .parse(raw);
    const c = this.get(id);
    if (input.category === "read") return { allowed: true, state: c.state };
    requireFact(c.state === "active", "AGENT_ACTIONS_FROZEN");
    requireFact(c.policy.mode !== "observe", "OBSERVE_ONLY");
    requireFact(!c.policy.allowPhoneInitialization || !!c.installAttempts, "PHONE_PREPARATION_REQUIRED_BEFORE_NAVIGATION");
    if (c.policy.mode === "client_test" || c.policy.mode === "connectivity_test") {
      requireFact(input.category === "navigate", "CLIENT_TEST_ACTION_NOT_AUTHORIZED");
    }
    if (input.category === "create_identity") {
      requireFact(c.policy.mode === "onboarding" && c.policy.allowIdentityCreation && !c.identityCreationAttempts, "IDENTITY_CREATION_NOT_AUTHORIZED");
      this.save({ ...c, identityCreationAttempts: 1 });
      this.event(id, "action_permitted", "create_identity");
      return { allowed: true, state: c.state };
    }
    requireFact(
      !["install", "publish", "create_identity", "correct_account", "unmanaged"].includes(
        input.category,
      ),
      "ACTION_REQUIRES_SEPARATE_AUTHORIZED_WORKFLOW",
    );
    if (input.category === "login_submit") {
      requireFact(c.policy.allowLogin !== false, "LOGIN_NOT_AUTHORIZED");
      requireFact(
        c.credentialReady && c.loginSubmits < c.passwordAttempts + c.otpAttempts,
        "LOGIN_SUBMIT_NOT_AUTHORIZED",
      );
      this.save({ ...c, loginSubmits: c.loginSubmits + 1, credentialReady: false });
    } else if (input.category === "recovery") {
      requireFact(c.recoveryAttempts < c.policy.maxRecovery, "RECOVERY_BUDGET_EXHAUSTED");
      this.save({ ...c, recoveryAttempts: c.recoveryAttempts + 1 });
    }
    this.event(id, "action_permitted", input.category);
    return { allowed: true, state: c.state };
  }
  async ensureApp<T>(id: string, install: () => Promise<T>): Promise<T> {
    const c = this.get(id);
    requireFact(
      c.state === "active" && c.policy.mode !== "observe" && c.policy.allowTrustedInstall,
      "INSTALL_NOT_AUTHORIZED",
    );
    return this.runTrustedPreparation(id, install);
  }
  async preparePhone<T>(id: string, prepare: () => Promise<T>): Promise<T> {
    const c = this.get(id);
    requireFact(c.state === "active" && c.policy.mode === "connectivity_test"
      && c.policy.allowPhoneInitialization && !c.policy.allowLogin && !c.policy.allowTrustedInstall,
    "PHONE_INITIALIZATION_NOT_AUTHORIZED");
    return this.runTrustedPreparation(id, prepare);
  }
  private async runTrustedPreparation<T>(id: string, install: () => Promise<T>): Promise<T> {
    const c = this.get(id);
    requireFact(!c.installAttempts, "INSTALL_BUDGET_EXHAUSTED");
    this.save({ ...c, installAttempts: 1, state: "waiting", reason: "TRUSTED_INSTALL_RUNNING" });
    this.event(id, "install_started", "TRUSTED_CATALOG_ONLY");
    try {
      const result = await install();
      const current = this.get(id);
      requireFact(
        current.state === "waiting" && current.reason === "TRUSTED_INSTALL_RUNNING",
        "INSTALL_COMPLETED_AFTER_STOP",
      );
      this.save({ ...current, state: "active", reason: undefined });
      this.event(id, "install_finished", "REOBSERVE_REQUIRED");
      return result;
    } catch (error) {
      this.stop(id, "TRUSTED_INSTALL_FAILED");
      throw error;
    }
  }
  create(id: string, raw: unknown) {
    const c = this.get(id),
      input = requestInput.parse(raw);
    requireFact(c.state === "active", "CONTROL_NOT_ACTIVE");
    requireFact(
      !this.requests().some(
        (r) => r.sessionId === id && ["waiting", "responded", "claimed"].includes(r.status),
      ),
      "ASSISTANCE_ALREADY_PENDING",
    );
    requireFact(
      this.requests().filter((r) => r.sessionId === id).length < 8,
      "ASSISTANCE_BUDGET_EXHAUSTED",
    );
    const bytes = png(input.screenshot);
    const { screenshot: _screenshot, ...publicInput } = input;
    const request = {
      ...publicInput,
      id: randomUUID(),
      sessionId: id,
      taskId: c.taskId,
      deviceId: c.deviceId,
      expectedIdentity: c.expectedIdentity,
      createdAt: new Date(this.now()).toISOString(),
      expiresAt: new Date(Math.min(this.now() + 300000, Date.parse(c.expiresAt))).toISOString(),
      status: "waiting" as const,
    };
    this.store.db
      .prepare("INSERT INTO agent_requests VALUES (?,?,?)")
      .run(request.id, JSON.stringify(request), bytes);
    this.save({ ...c, state: "waiting" });
    this.event(id, "assistance_requested", input.reason);
    return request;
  }
  private request(id: string) {
    const r = this.requests().find((r) => r.id === id);
    requireFact(r, "ASSISTANCE_NOT_FOUND");
    if (
      Date.parse(r.expiresAt) <= this.now() &&
      ["waiting", "responded", "claimed"].includes(r.status)
    ) {
      this.saveRequest({ ...r, status: "expired" });
      this.stop(r.sessionId, "ASSISTANCE_EXPIRED");
      return { ...r, status: "expired" as const };
    }
    return r;
  }
  respond(id: string, raw: unknown) {
    const r = this.request(id);
    const v = z
      .object({
        expectedIdentity: z.string(),
        confirmed: z.literal(true),
        decision: z.enum(["provided", "approved", "completed", "cancel"]),
        text: z.string().trim().max(4000).default(""),
      })
      .strict()
      .parse(raw);
    requireFact(
      r.status === "waiting" && this.get(r.sessionId).state === "waiting",
      "ASSISTANCE_NOT_WAITING",
    );
    requireFact(v.expectedIdentity === r.expectedIdentity, "ASSISTANCE_ACCOUNT_MISMATCH");
    if (v.decision === "cancel") {
      this.stop(r.sessionId, "OPERATOR_CANCELLED");
      return this.saveRequest({ ...r, status: "cancelled" });
    }
    requireFact(
      (r.kind === "approval" && v.decision === "approved") ||
        (r.kind === "manual" && v.decision === "completed") ||
        (["content", "clarification"].includes(r.kind) && v.decision === "provided"),
      "RESPONSE_KIND_MISMATCH",
    );
    requireFact(v.text.length > 0, "RESPONSE_EVIDENCE_REQUIRED");
    this.event(r.sessionId, "operator_responded", r.kind);
    return this.saveRequest({
      ...r,
      status: "responded",
      response: { decision: v.decision, text: v.text },
    });
  }
  claim(id: string, requestId: string) {
    const r = this.request(requestId);
    requireFact(r.sessionId === id, "ASSISTANCE_SCOPE_MISMATCH");
    if (r.status !== "responded") return { status: r.status };
    requireFact(this.get(id).state === "waiting", "CONTROL_NOT_WAITING");
    this.saveRequest({ ...r, status: "claimed" });
    this.save({ ...this.get(id), state: "revalidate" });
    return { status: "claimed", response: r.response, requestId: r.id };
  }
  revalidate(id: string, raw: unknown) {
    const v = z
      .object({
        requestId: z.string().uuid(),
        expectedIdentity: z.string(),
        screenshot: z.string().max(8 * 1024 * 1024),
        continueTask: z.boolean(),
      })
      .strict()
      .parse(raw);
    const c = this.get(id),
      r = this.request(v.requestId);
    requireFact(
      r.sessionId === id && r.status === "claimed" && c.state === "revalidate",
      "REVALIDATION_NOT_PENDING",
    );
    requireFact(v.expectedIdentity === c.expectedIdentity, "ASSISTANCE_ACCOUNT_MISMATCH");
    const bytes = png(v.screenshot);
    this.saveRequest({ ...r, status: "verified" });
    this.store.db.prepare("UPDATE agent_requests SET screenshot=? WHERE id=?").run(bytes, r.id);
    // A human reply never grants additional capabilities, changes bindings or approves publication.
    if (
      !v.continueTask ||
      ["ACCOUNT_RESTRICTED", "ACCOUNT_MISMATCH", "CREATE_IDENTITY"].includes(r.reason)
    )
      this.stop(id, r.reason);
    else this.save({ ...c, state: "active" });
    this.event(id, "revalidated", createHash("sha256").update(bytes).digest("hex"));
    return this.get(id);
  }
  screenshot(id: string) {
    this.request(id);
    return this.store.db.prepare("SELECT screenshot FROM agent_requests WHERE id=?").get(id)!
      .screenshot as Uint8Array;
  }
  finishObservation(id: string) {
    const c = this.get(id);
    requireFact(
      c.policy.mode === "observe" &&
        c.state === "active" &&
        c.loginSubmits === 0 &&
        this.requests().some((r) => r.sessionId === id && r.status === "verified"),
      "OBSERVATION_EVIDENCE_INCOMPLETE",
    );
    this.save({ ...c, reportedResult: "OBSERVATION_COMPLETED" });
    this.event(id, "result_reported", "OBSERVATION_COMPLETED");
    return { resultCode: "OBSERVATION_COMPLETED", loginSubmitCount: 0, finalSubmitClicked: false };
  }
}
