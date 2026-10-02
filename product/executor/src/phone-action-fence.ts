import { randomUUID } from "node:crypto";
import { closeSync, constants, lstatSync, openSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { admissionGenerationSchema, phoneActionRequestSchema, timestampSchema, uuidSchema,
  type PhoneActionRequest } from "@socialgrowth/product-contracts";

const grantSchema = phoneActionRequestSchema.omit({ actionId: true, kind: true }).extend({
  serial: z.string().min(1).max(128), leaseUntil: timestampSchema,
  allowedKinds: z.array(phoneActionRequestSchema.shape.kind).min(1),
});
export type LocalPhoneGrant = z.infer<typeof grantSchema>;
const proofSchema = z.strictObject({
  deviceId: uuidSchema, serial: z.string().min(1).max(128), stopRequestId: uuidSchema,
  controlGeneration: admissionGenerationSchema, evidenceId: uuidSchema, checkedAt: timestampSchema,
  allPathsFenced: z.literal(true), controllerReleased: z.literal(true), targetQuiescent: z.literal(true),
});
const ticketSchema = phoneActionRequestSchema.extend({ serial: z.string().min(1).max(128),
  checkedAt: timestampSchema, validUntil: timestampSchema, replayed: z.literal(false) });
export type PhoneTransportTicket = z.infer<typeof ticketSchema>;
const originalEndSchema = phoneActionRequestSchema.extend({ serial: z.string().min(1).max(128),
  stopRequestId: uuidSchema, stopGeneration: admissionGenerationSchema,
  checkedAt: timestampSchema, evidenceId: uuidSchema, status: z.literal("ended") });
const stateSchema = z.strictObject({
  deviceId: uuidSchema, serial: z.string().min(1).max(128), version: z.int().min(0),
  controlGeneration: admissionGenerationSchema, disposition: z.enum(["stop_requested", "stopped", "enabled"]),
  stopRequestId: uuidSchema.nullable(), proofCheckedAt: timestampSchema.nullable(), grant: grantSchema.nullable(),
});
type State = z.infer<typeof stateSchema>;
export type LocalStopScope = Pick<State, "deviceId" | "serial" | "controlGeneration" | "stopRequestId">;

// These are trusted internal sources, not request bodies or environment flags.
// No implementation is wired until real installation/ADB/transport facts exist.
export interface PhoneFenceAuthority {
  verifyHolder(grant: LocalPhoneGrant): Promise<void>;
  // Must freshly commit the original central begin_call BEFORE returning a
  // ticket. A replay/current-state response is NEVER a new action permission.
  beginAction(request: PhoneActionRequest): Promise<unknown>;
  recordActionOutcome(request: PhoneActionRequest, status: "ended" | "unknown"): Promise<void>;
  inspectStopped(scope: LocalStopScope): Promise<unknown>;
  // Original-operation evidence only. cancelled/lease expiry/process death are
  // insufficient; any physical probe needs its own current recovery permission.
  inspectOriginalAction(request: PhoneActionRequest, stop: LocalStopScope): Promise<unknown>;
}
export interface PhoneFenceTransport<T> {
  // Synchronous handoff is required: start must issue the transport call before
  // returning. Deferred callbacks and an unguarded raw driver violate this port.
  // Result must resolve only after the underlying operation has actually ended.
  start(request: PhoneActionRequest, serial: string, ticket: Readonly<PhoneTransportTicket>): Promise<T>;
}
export class PhoneFenceError extends Error {
  constructor(readonly code: "INVALID_BOUNDARY" | "DENIED" | "BUSY" | "UNKNOWN" | "STORAGE_UNAVAILABLE") {
    super(`Phone fence rejected: ${code}`);
  }
}
function deny(code: PhoneFenceError["code"] = "DENIED"): never { throw new PhoneFenceError(code); }
const fresh = (checkedAt: string, now: number) => Date.parse(checkedAt) <= now && now < Date.parse(checkedAt) + 10_000;

// Per-device durable start/stop fence for transports implementing the port.
// This does NOT claim to protect raw Artemis/ADB paths that bypass this class.
// Use one canonical private ledger per physical host; alternate ledgers are not
// a sandbox and must not be exposed as configurable worker authority.
export class PhoneActionFence<T = unknown> {
  private readonly db: DatabaseSync;
  constructor(path: string, private readonly deviceId: string, private readonly serial: string,
    private readonly authority: PhoneFenceAuthority, private readonly transport: PhoneFenceTransport<T>,
    private readonly now = () => Date.now()) {
    if (!uuidSchema.safeParse(deviceId).success || !serial || serial.length > 128) deny("INVALID_BOUNDARY");
    try {
      try { closeSync(openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600)); }
      catch (e) { if (!(e instanceof Error) || !("code" in e) || e.code !== "EEXIST") throw e; }
      const file = lstatSync(path);
      if (!file.isFile() || file.isSymbolicLink() || (file.mode & 0o077) !== 0
        || (process.getuid && file.uid !== process.getuid())) deny("INVALID_BOUNDARY");
      this.db = new DatabaseSync(path);
    } catch (e) { if (e instanceof PhoneFenceError) throw e; deny("STORAGE_UNAVAILABLE"); }
    try {
      this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS phone_fences(device_id TEXT PRIMARY KEY,serial TEXT NOT NULL UNIQUE,record TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS phone_fence_actions(action_id TEXT PRIMARY KEY,device_id TEXT NOT NULL,request TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('running','ended','unknown')),started_at INTEGER NOT NULL,ended_at INTEGER,end_evidence_id TEXT);
        CREATE TABLE IF NOT EXISTS phone_fence_holders(holder_id TEXT PRIMARY KEY,device_id TEXT NOT NULL);`);
      this.transaction(() => {
        const initial: State = { deviceId, serial, version: 0, controlGeneration: "1", disposition: "stop_requested",
          stopRequestId: randomUUID(), proofCheckedAt: null, grant: null };
        this.db.prepare("INSERT OR IGNORE INTO phone_fences VALUES(?,?,?)").run(deviceId, serial, JSON.stringify(initial));
        this.state(); // Refuse another serial/device mapping; never reinitialize.
      });
    } catch (e) { this.db.close(); if (e instanceof PhoneFenceError) throw e; deny("STORAGE_UNAVAILABLE"); }
  }
  close(): void { this.db.close(); }
  private transaction<T>(fn: () => T): T {
    try {
      this.db.exec("BEGIN IMMEDIATE");
      const value = fn(); this.db.exec("COMMIT"); return value;
    } catch (e) {
      try { if (this.db.isTransaction) this.db.exec("ROLLBACK"); } catch { deny("STORAGE_UNAVAILABLE"); }
      if (e instanceof PhoneFenceError) throw e;
      deny("STORAGE_UNAVAILABLE");
    }
  }
  private state(): State {
    const row = this.db.prepare("SELECT record FROM phone_fences WHERE device_id=?").get(this.deviceId);
    try {
      const s = stateSchema.parse(JSON.parse(String(row?.record)));
      if (s.deviceId !== this.deviceId || s.serial !== this.serial
        || (s.disposition === "enabled" && (!s.grant || s.stopRequestId !== null))
        || (s.disposition !== "enabled" && !s.stopRequestId)
        || (s.disposition === "stopped" && (!s.proofCheckedAt || s.grant !== null))) deny("INVALID_BOUNDARY");
      return s;
    } catch { deny("INVALID_BOUNDARY"); }
  }
  private save(s: State): void {
    if (!Number.isSafeInteger(s.version) || s.version >= Number.MAX_SAFE_INTEGER) deny("INVALID_BOUNDARY");
    this.db.prepare("UPDATE phone_fences SET record=? WHERE device_id=?").run(JSON.stringify({ ...s, version: s.version + 1 }), this.deviceId);
  }
  private unresolved(): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM phone_fence_actions WHERE device_id=? AND status<>'ended' LIMIT 1").get(this.deviceId));
  }
  snapshot(): State { return this.state(); }
  requestStop(stopRequestId: string): State {
    if (!uuidSchema.safeParse(stopRequestId).success) deny("INVALID_BOUNDARY");
    return this.transaction(() => {
      const s = this.state();
      if (s.stopRequestId === stopRequestId) return s;
      const generation = (BigInt(s.controlGeneration) + 1n).toString();
      if (!admissionGenerationSchema.safeParse(generation).success) deny("INVALID_BOUNDARY");
      this.save({ ...s, controlGeneration: generation, disposition: "stop_requested", stopRequestId, proofCheckedAt: null });
      return this.state(); // In-flight and unknown calls remain occupied.
    });
  }
  async confirmStopped(): Promise<State> {
    const captured = this.state();
    if (captured.disposition !== "stop_requested") deny();
    let raw: unknown;
    try { raw = await this.authority.inspectStopped(captured); } catch { deny(); }
    const proof = proofSchema.safeParse(raw);
    if (!proof.success) deny();
    return this.transaction(() => {
      const s = this.state(), p = proof.data;
      const lastEnd = this.db.prepare("SELECT max(ended_at) at FROM phone_fence_actions WHERE device_id=?").get(s.deviceId)?.at;
      if (s.version !== captured.version || this.unresolved() || (lastEnd !== null && lastEnd !== undefined && Date.parse(p.checkedAt) < Number(lastEnd))
        || p.deviceId !== s.deviceId || p.serial !== s.serial
        || p.controlGeneration !== s.controlGeneration || p.stopRequestId !== s.stopRequestId || !fresh(p.checkedAt, this.now())) deny();
      this.save({ ...s, disposition: "stopped", grant: null, proofCheckedAt: p.checkedAt });
      return this.state();
    });
  }
  async installHolder(raw: unknown): Promise<State> {
    const grant = grantSchema.safeParse(raw);
    if (!grant.success) deny("INVALID_BOUNDARY");
    const captured = this.state();
    try { await this.authority.verifyHolder(grant.data); } catch { deny(); }
    return this.transaction(() => {
      const s = this.state(), g = grant.data;
      if (s.version !== captured.version || s.disposition !== "stopped" || this.unresolved()
        || !s.proofCheckedAt || !fresh(s.proofCheckedAt, this.now()) || g.deviceId !== s.deviceId || g.serial !== s.serial
        || g.controlGeneration !== s.controlGeneration || Date.parse(g.leaseUntil) <= this.now()
        || this.db.prepare("SELECT 1 FROM phone_fence_holders WHERE holder_id=?").get(g.holderId)) deny();
      this.db.prepare("INSERT INTO phone_fence_holders VALUES(?,?)").run(g.holderId, s.deviceId);
      this.save({ ...s, disposition: "enabled", stopRequestId: null, grant: g }); return this.state();
    });
  }
  async reconcileOriginalAction(raw: unknown): Promise<void> {
    const parsed = phoneActionRequestSchema.safeParse(raw);
    if (!parsed.success) deny("INVALID_BOUNDARY");
    const r = parsed.data, captured = this.state();
    if (captured.disposition !== "stop_requested") deny();
    const saved = this.db.prepare("SELECT request,started_at,status FROM phone_fence_actions WHERE action_id=? AND device_id=?").get(r.actionId, this.deviceId);
    if (!saved || saved.request !== JSON.stringify(r) || saved.status === "ended") deny();
    let rawProof: unknown;
    try { rawProof = await this.authority.inspectOriginalAction(r, captured); } catch { deny(); }
    const proof = originalEndSchema.safeParse(rawProof);
    if (!proof.success) deny();
    this.transaction(() => {
      const s = this.state(), p = proof.data;
      const current = this.db.prepare("SELECT request,status FROM phone_fence_actions WHERE action_id=? AND device_id=?").get(r.actionId, this.deviceId);
      if (s.version !== captured.version || s.disposition !== "stop_requested" || !current || current.request !== saved.request
        || current.status === "ended" || Object.entries(r).some(([k, v]) => p[k as keyof typeof p] !== v)
        || p.serial !== s.serial || p.stopRequestId !== s.stopRequestId || p.stopGeneration !== s.controlGeneration
        || !fresh(p.checkedAt, this.now()) || Date.parse(p.checkedAt) < Number(saved.started_at)) deny();
      this.db.prepare("UPDATE phone_fence_actions SET status='ended',ended_at=?,end_evidence_id=? WHERE action_id=?")
        .run(Date.parse(p.checkedAt), p.evidenceId, r.actionId);
    });
    await this.report(r, "ended"); // Historical receipt does not reopen control.
  }
  async replayOriginalOutcome(raw: unknown): Promise<void> {
    const parsed = phoneActionRequestSchema.safeParse(raw);
    if (!parsed.success) deny("INVALID_BOUNDARY");
    const r = parsed.data;
    const row = this.db.prepare("SELECT request,status FROM phone_fence_actions WHERE action_id=? AND device_id=?").get(r.actionId, this.deviceId);
    if (!row || row.request !== JSON.stringify(r) || (row.status !== "ended" && row.status !== "unknown")) deny();
    // Replay only the durable receipt. Never obtain a new ticket or call start.
    await this.report(r, row.status);
  }
  private requireGrant(s: State, r: PhoneActionRequest): void {
    const g = s.grant;
    if (s.disposition !== "enabled" || !g || g.serial !== this.serial || g.controlGeneration !== s.controlGeneration
      || g.deviceId !== r.deviceId || g.holderId !== r.holderId || g.controlGeneration !== r.controlGeneration
      || g.taskAttemptId !== r.taskAttemptId || g.authorizationId !== r.authorizationId || g.purpose !== r.purpose
      || !g.allowedKinds.includes(r.kind) || Date.parse(g.leaseUntil) <= this.now()) deny();
  }
  async execute(raw: unknown): Promise<T> {
    const parsed = phoneActionRequestSchema.safeParse(raw);
    if (!parsed.success) deny("INVALID_BOUNDARY");
    const r = parsed.data;
    // Local check before central intent; recheck after awaiting the authority.
    this.transaction(() => { this.requireGrant(this.state(), r); if (this.unresolved()) deny("BUSY"); });
    let rawTicket: unknown;
    try { rawTicket = await this.authority.beginAction(r); } catch { deny(); }
    const ticket = ticketSchema.safeParse(rawTicket);
    if (!ticket.success) deny();
    this.transaction(() => {
      const s = this.state(), t = ticket.data;
      this.requireGrant(s, r);
      if (this.unresolved()) deny("BUSY");
      if (Object.entries(r).some(([k, v]) => t[k as keyof typeof t] !== v) || t.serial !== s.serial
        || !fresh(t.checkedAt, this.now()) || Date.parse(t.validUntil) <= this.now()
        || Date.parse(t.validUntil) > Date.parse(s.grant!.leaseUntil)
        || this.db.prepare("SELECT 1 FROM phone_fence_actions WHERE action_id=?").get(r.actionId)) deny();
      this.db.prepare("INSERT INTO phone_fence_actions VALUES(?,?,?,'running',?,NULL,NULL)").run(r.actionId, s.deviceId, JSON.stringify(r), this.now());
    }); // Durable original intent BEFORE any transport call.
    let pending: Promise<T>;
    try {
      pending = this.transaction(() => {
        this.requireGrant(this.state(), r);
        if (!fresh(ticket.data.checkedAt, this.now()) || Date.parse(ticket.data.validUntil) <= this.now()) deny();
        // Same SQLite writer lock as requestStop. No await/deferred handoff here.
        const started = this.transport.start(r, this.serial, Object.freeze({ ...ticket.data }));
        // A post-handoff storage failure must not leave a later transport
        // rejection unhandled, or cause a retry of the physical operation.
        void started.catch(() => undefined);
        return started;
      });
    } catch { this.finish(r, "unknown"); await this.report(r, "unknown"); deny("UNKNOWN"); }
    let result: T;
    try { result = await pending; }
    catch { this.finish(r, "unknown"); await this.report(r, "unknown"); deny("UNKNOWN"); }
    this.finish(r, "ended"); await this.report(r, "ended"); return result;
  }
  private async report(r: PhoneActionRequest, status: "ended" | "unknown"): Promise<void> {
    try { await this.authority.recordActionOutcome(r, status); }
    catch { deny("UNKNOWN"); } // Never repeat a physical call after receipt ACK loss.
  }
  private finish(r: PhoneActionRequest, status: "ended" | "unknown"): void {
    this.transaction(() => {
      // Original request scope, never newer holder/generation from current state.
      const row = this.db.prepare("SELECT request,status FROM phone_fence_actions WHERE action_id=? AND device_id=?").get(r.actionId, r.deviceId);
      if (!row || row.request !== JSON.stringify(r) || row.status === "ended") deny();
      this.db.prepare("UPDATE phone_fence_actions SET status=?,ended_at=? WHERE action_id=?")
        .run(status, status === "ended" ? this.now() : null, r.actionId);
    });
  }
}
