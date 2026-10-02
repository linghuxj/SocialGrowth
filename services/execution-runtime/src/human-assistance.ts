import { randomUUID, randomBytes } from "node:crypto";
import { z } from "zod";
import type { RuntimeStore } from "./store.ts";
import { requireFact } from "./contracts.ts";
import { Supervision, executionPolicy } from "./supervision.ts";

export const assistanceScopeSchema = z
  .object({
    taskId: z.string().min(1).max(256),
    deviceId: z.string().min(1).max(256),
    serial: z.string().regex(/^[A-Za-z0-9._:-]+$/),
    packageName: z.enum(["com.facebook.katana", "com.google.android.youtube", "com.socialgrowth.product"]),
    expectedIdentity: z.string().min(1).max(512),
    expiresAt: z.string().datetime(),
    mode: z.enum(["execution", "diagnostic"]),
    policy: executionPolicy.optional(),
  })
  .strict().refine(scope =>
    (scope.packageName === "com.socialgrowth.product") === (scope.policy?.mode === "client_test") &&
    (scope.policy?.mode !== "client_test" || (scope.mode === "diagnostic" && !scope.policy.allowTrustedInstall && !scope.policy.allowIdentityCreation)),
    "Client tests require the diagnostic SocialGrowth package and no credential or installation scope",
  );
type Scope = z.infer<typeof assistanceScopeSchema>;
type Session = {
  id: string;
  token: string;
  scope: Scope;
  challengeId?: string;
  pendingCredential?: "password" | "otp";
};
type Challenge = Scope & {
  id: string;
  sessionId: string;
  traceId: string;
  createdAt: string;
  status:
    | "waiting"
    | "submitted"
    | "claimed"
    | "input_completed"
    | "cancelled"
    | "expired"
    | "failed"
    | "interrupted";
  resultCode?: string;
  workflowResult?: string;
  kind?: "password" | "otp";
};

/** Passwords exist only in bounded process memory; never in SQLite, WS journals or model text.
 * A process crash invalidates every capability and interrupts outstanding requests (no replay).
 */
export class HumanAssistance {
  readonly supervision: Supervision;
  private sessions = new Map<string, Session>();
  private secrets = new Map<string, Buffer>();
  private timer: ReturnType<typeof setInterval>;
  constructor(
    private store: RuntimeStore,
    private now = Date.now,
  ) {
    this.supervision = new Supervision(store, now);
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS human_assistance (id TEXT PRIMARY KEY, body TEXT NOT NULL, screenshot BLOB NOT NULL)",
    );
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS human_assistance_results (id TEXT PRIMARY KEY, screenshot BLOB NOT NULL)",
    );
    for (const c of this.list())
      if (["waiting", "submitted", "claimed"].includes(c.status))
        this.update({ ...c, status: "interrupted", resultCode: "RUNTIME_RESTARTED" });
    this.timer = setInterval(() => this.expire(), 1000);
    this.timer.unref();
  }
  open(raw: unknown) {
    this.expire();
    const scope = assistanceScopeSchema.parse(raw);
    requireFact(!scope.serial.startsWith("emulator-"), "PHYSICAL_DEVICE_REQUIRED");
    requireFact(
      Date.parse(scope.expiresAt) > this.now() &&
        Date.parse(scope.expiresAt) <= this.now() + 900000,
      "ASSISTANCE_EXPIRY_INVALID",
    );
    requireFact(
      ![...this.sessions.values()].some((s) => s.scope.deviceId === scope.deviceId),
      "ASSISTANCE_DEVICE_BUSY",
    );
    const session: Session = { id: randomUUID(), token: randomBytes(32).toString("hex"), scope };
    this.supervision.open({ sessionId: session.id, ...scope }, scope.policy);
    this.sessions.set(session.token, session);
    return { sessionId: session.id, token: session.token, ...scope };
  }
  session(token: string) {
    this.expire();
    const s = this.sessions.get(token);
    requireFact(s, "ASSISTANCE_SESSION_INVALID");
    return s;
  }
  create(token: string, raw: unknown) {
    const s = this.session(token);
    const input = z
      .object({
        traceId: z.string().uuid(),
        screenshot: z.string().max(8 * 1024 * 1024),
        kind: z.enum(["password", "otp"]).default("password"),
      })
      .strict()
      .parse(raw);
    requireFact(
      !this.list().some((c) => c.sessionId === s.id && (c.kind ?? "password") === input.kind),
      "ASSISTANCE_SINGLE_ATTEMPT_ONLY",
    );
    requireFact(
      !s.challengeId || this.get(s.challengeId).status === "input_completed",
      "ASSISTANCE_ALREADY_PENDING",
    );
    if (!s.pendingCredential) this.beginCredential(token, input.kind);
    requireFact(s.pendingCredential === input.kind, "CREDENTIAL_KIND_MISMATCH");
    const screenshot = Buffer.from(input.screenshot, "base64");
    requireFact(
      screenshot.subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
      "SCREENSHOT_PNG_REQUIRED",
    );
    const c: Challenge = {
      ...s.scope,
      id: randomUUID(),
      sessionId: s.id,
      traceId: input.traceId,
      kind: input.kind,
      createdAt: new Date(this.now()).toISOString(),
      expiresAt: new Date(
        Math.min(this.now() + 300000, Date.parse(s.scope.expiresAt)),
      ).toISOString(),
      status: "waiting",
    };
    this.store.db
      .prepare("INSERT INTO human_assistance VALUES (?,?,?)")
      .run(c.id, JSON.stringify(c), screenshot);
    s.challengeId = c.id;
    s.pendingCredential = undefined;
    return c;
  }
  beginCredential(token: string, kind: "password" | "otp") {
    const s = this.session(token);
    requireFact(!s.pendingCredential, "CREDENTIAL_ALREADY_PENDING");
    this.supervision.credential(s.id, kind);
    s.pendingCredential = kind;
    return { ok: true };
  }
  private get(id: string): Challenge {
    const row = this.store.db.prepare("SELECT body FROM human_assistance WHERE id=?").get(id);
    requireFact(row, "ASSISTANCE_NOT_FOUND");
    return JSON.parse(row.body as string);
  }
  private update(c: Challenge) {
    this.store.db
      .prepare("UPDATE human_assistance SET body=? WHERE id=?")
      .run(JSON.stringify(c), c.id);
    return c;
  }
  list(): Challenge[] {
    return this.store.db
      .prepare("SELECT body FROM human_assistance ORDER BY rowid DESC")
      .all()
      .map((r) => JSON.parse(r.body as string));
  }
  deviceBusy(deviceId: string) {
    this.expire();
    return [...this.sessions.values()].some((s) => s.scope.deviceId === deviceId);
  }
  screenshot(id: string, result = false) {
    this.get(id);
    const row = this.store.db
      .prepare(
        `SELECT screenshot FROM ${result ? "human_assistance_results" : "human_assistance"} WHERE id=?`,
      )
      .get(id);
    requireFact(row, "ASSISTANCE_SCREENSHOT_UNAVAILABLE");
    return row.screenshot as Uint8Array;
  }
  report(token: string, raw: unknown) {
    const s = this.session(token);
    const input = z
      .object({
        resultCode: z.enum([
          "LOGIN_REJECTED",
          "LOGIN_BLOCKED",
          "IDENTITY_MISMATCH",
          "PREFLIGHT_READY",
          "COMPLETED",
          "UNCONFIRMED",
        ]),
        screenshot: z.string().max(8 * 1024 * 1024),
      })
      .strict()
      .parse(raw);
    if (
      ["LOGIN_REJECTED", "LOGIN_BLOCKED", "IDENTITY_MISMATCH", "UNCONFIRMED"].includes(
        input.resultCode,
      )
    )
      this.supervision.stop(s.id, input.resultCode);
    if (!s.challengeId) return { ok: true };
    const c = this.get(s.challengeId);
    requireFact(!c.workflowResult, "ASSISTANCE_RESULT_ALREADY_RECORDED");
    const screenshot = Buffer.from(input.screenshot, "base64");
    requireFact(
      screenshot.subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
      "SCREENSHOT_PNG_REQUIRED",
    );
    this.erase(c.id);
    this.store.transaction(() => {
      this.store.db
        .prepare("INSERT INTO human_assistance_results VALUES (?,?)")
        .run(c.id, screenshot);
      this.update({
        ...c,
        status: ["waiting", "submitted", "claimed"].includes(c.status) ? "interrupted" : c.status,
        workflowResult: input.resultCode,
      });
    });
    return { ok: true };
  }
  submit(id: string, raw: unknown) {
    this.expire();
    const c = this.get(id);
    const input = z
      .object({
        password: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[\x20-\x7e]+$/),
        expectedIdentity: z.string(),
        confirmed: z.literal(true),
      })
      .strict()
      .parse(raw);
    requireFact(c.status === "waiting", "ASSISTANCE_NOT_WAITING");
    requireFact(input.expectedIdentity === c.expectedIdentity, "ASSISTANCE_ACCOUNT_MISMATCH");
    requireFact(this.supervision.get(c.sessionId).state === "waiting", "AGENT_ACTIONS_FROZEN");
    if (c.kind === "otp")
      requireFact(/^[A-Za-z0-9-]{4,12}$/.test(input.password), "OTP_FORMAT_INVALID");
    this.secrets.set(id, Buffer.from(input.password));
    return this.update({ ...c, status: "submitted" });
  }
  claim(token: string, id: string) {
    const s = this.session(token),
      c = this.get(id);
    requireFact(s.challengeId === id && c.sessionId === s.id, "ASSISTANCE_SCOPE_MISMATCH");
    if (c.status !== "submitted") return { status: c.status };
    requireFact(this.supervision.get(c.sessionId).state === "waiting", "AGENT_ACTIONS_FROZEN");
    const secret = this.secrets.get(id);
    requireFact(secret, "ASSISTANCE_SECRET_UNAVAILABLE");
    const password = secret.toString();
    secret.fill(0);
    this.secrets.delete(id);
    this.update({ ...c, status: "claimed" });
    // Only this one-time authenticated response includes the secret; never journal it.
    return { status: "claimed", password };
  }
  finish(token: string, id: string, raw: unknown) {
    const s = this.session(token),
      c = this.get(id);
    requireFact(s.challengeId === id, "ASSISTANCE_SCOPE_MISMATCH");
    const input = z
      .object({
        resultCode: z.enum(["INPUT_COMPLETED", "SCREEN_CHANGED", "INPUT_FAILED", "CANCELLED"]),
      })
      .strict()
      .parse(raw);
    requireFact(
      ["waiting", "submitted", "claimed"].includes(c.status),
      "ASSISTANCE_ALREADY_FINISHED",
    );
    requireFact(
      input.resultCode !== "INPUT_COMPLETED" || c.status === "claimed",
      "ASSISTANCE_INPUT_NOT_CLAIMED",
    );
    this.erase(id);
    if (input.resultCode === "INPUT_COMPLETED") this.supervision.credentialFilled(s.id);
    else this.supervision.stop(s.id, input.resultCode);
    return this.update({
      ...c,
      status: input.resultCode === "INPUT_COMPLETED" ? "input_completed" : "failed",
      resultCode: input.resultCode,
    });
  }
  cancel(id: string) {
    const c = this.get(id);
    requireFact(
      ["waiting", "submitted"].includes(c.status),
      "ASSISTANCE_CANNOT_CANCEL_CLAIMED_INPUT",
    );
    this.erase(id);
    this.supervision.stop(c.sessionId, "OPERATOR_CANCELLED");
    return this.update({ ...c, status: "cancelled" });
  }
  closeSession(token: string) {
    const s = this.sessions.get(token);
    if (!s) return;
    this.supervision.close(s.id);
    if (s.challengeId) {
      const c = this.get(s.challengeId);
      this.erase(c.id);
      if (["waiting", "submitted", "claimed"].includes(c.status))
        this.update({ ...c, status: "interrupted" });
    }
    this.sessions.delete(token);
  }
  private erase(id: string) {
    this.secrets.get(id)?.fill(0);
    this.secrets.delete(id);
  }
  private expire() {
    for (const c of this.list())
      if (
        Date.parse(c.expiresAt) <= this.now() &&
        ["waiting", "submitted", "claimed"].includes(c.status)
      ) {
        this.erase(c.id);
        this.supervision.stop(c.sessionId, "ASSISTANCE_EXPIRED");
        this.update({ ...c, status: "expired" });
      }
    for (const [token, s] of this.sessions)
      if (Date.parse(s.scope.expiresAt) <= this.now()) this.closeSession(token);
  }
  close() {
    clearInterval(this.timer);
    for (const token of this.sessions.keys()) this.closeSession(token);
  }
}
