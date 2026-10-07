import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { uuidSchema } from "@socialgrowth/product-contracts";
import { ArtemisReadScreenBridge, type ReadScreenBridgeAccess } from "./artemis-read-screen-bridge.js";

export const readSessionVersion = "2026-10-02.read-session-v1";
export const readSessionSources = ["socialgrowth_read_session.py", "socialgrowth_read_screen.py", "socialgrowth_read_only_driver.py",
  "socialgrowth_supervision.py", "socialgrowth_human_input.py", "socialgrowth_observer.py"] as const;
export interface ReadSessionBundle { sdkRoot: string; overlaysRoot: string; pythonPath: string; pythonSha256: string;
  pythonRuntimePath: string; pythonRuntimeSha256: string;
  sourceHashes: Record<typeof readSessionSources[number], string> }
export interface ReadSessionReceipt { launchId: string; scopeDigest: string; state: "launch_intent" | "ready" | "launch_unknown" | "child_exited";
  closeAcknowledged: boolean; exitCode: number | null; exitSignal: string | null }
const base = z.strictObject({ version: z.literal(readSessionVersion), launchId: uuidSchema, scopeDigest: z.string().regex(/^[a-f0-9]{64}$/), type: z.enum(["ready", "closed"]) });
const observed = base.extend({ type: z.literal("observed"), requestId: uuidSchema, width: z.int().min(2), height: z.int().min(2), sha256: z.string().regex(/^[a-f0-9]{64}$/) });
const response = z.union([base, observed]);
export type ReadSessionObservation = z.infer<typeof observed>;
export class ReadSessionError extends Error { constructor() { super("READ_SESSION_UNAVAILABLE"); } }
function fail(): never { throw new ReadSessionError(); }
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
function canonicalDirectory(path: string, privateOnly = false): void {
  const f = lstatSync(path);
  if (!isAbsolute(path) || realpathSync(path) !== path || !f.isDirectory() || f.isSymbolicLink()
    || (f.mode & (privateOnly ? 0o077 : 0o022)) !== 0 || (process.getuid && f.uid !== process.getuid())) fail();
}
function pinnedFile(path: string, hash: string, allowLink = false): void {
  const canonical = realpathSync(path), f = lstatSync(canonical);
  if (!isAbsolute(path) || (!allowLink && canonical !== path) || !f.isFile() || (f.mode & 0o022) !== 0
    || (process.getuid && f.uid !== process.getuid() && f.uid !== 0) || !/^[a-f0-9]{64}$/.test(hash) || sha(canonical) !== hash) fail();
}
// Fixed macOS policy: only original AF_UNIX endpoint, writes only to private
// SDK scratch, no IP networking or fork. Not a host-wide phone fence.
export function readSessionSandboxProfile(socketPath: string, pythonPath: string, pythonRuntimePath: string, scratch: string): string {
  const pythonCanonical = realpathSync(pythonPath);
  if (![socketPath, pythonPath, pythonCanonical, pythonRuntimePath, scratch].every(p => isAbsolute(p) && /^[A-Za-z0-9_/@. -]+$/.test(p))) fail();
  canonicalDirectory(scratch, true);
  return `(version 1)(allow default)(deny network*)(allow network-outbound (remote unix-socket (literal "${socketPath}")))`
    + `(deny file-write*)(allow file-write* (subpath "${scratch}"))(deny process-fork)(deny process-exec)(allow process-exec (literal "${pythonCanonical}") (literal "${pythonRuntimePath}"))`;
}

// Internal bootstrap/observer process, NOT an Artemis business-task dispatcher.
// Does not consume the queue, call a model, claim allPathsFenced or stop proof.
// Original launch intent is durable before spawn. Replays only read receipts;
// process restart/PID disappearance never automatically relaunch this scope.
export class ArtemisReadSessionProcess {
  private readonly db: DatabaseSync;
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private wait: { resolve: (value: z.infer<typeof response>) => void; reject: () => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private closedAcknowledged = false;
  private launchId: string | null = null;
  private exit: Promise<void> | null = null;
  private stopping = false;
  private ownsBoundary = false;
  private closing: Promise<void> | null = null;
  private scratch: string | null = null;
  private observedOriginals = new Set<string>();
  constructor(private readonly ledgerPath: string, private readonly bundle: ReadSessionBundle,
    private readonly bridge: ArtemisReadScreenBridge, private readonly access: ReadScreenBridgeAccess) {
    try {
      canonicalDirectory(dirname(ledgerPath), true);
      if (!isAbsolute(ledgerPath) || !(bridge instanceof ArtemisReadScreenBridge)) fail();
      try { closeSync(openSync(ledgerPath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600)); }
      catch (e) { if (!(e instanceof Error) || !("code" in e) || e.code !== "EEXIST") throw e; }
      const f = lstatSync(ledgerPath);
      if (!f.isFile() || f.isSymbolicLink() || (f.mode & 0o077) || (process.getuid && f.uid !== process.getuid())) fail();
      this.db = new DatabaseSync(ledgerPath);
      this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS read_session_launches(scope_digest TEXT PRIMARY KEY,launch_id TEXT NOT NULL UNIQUE,
        serial TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('launch_intent','ready','launch_unknown','child_exited')),
        close_ack INTEGER NOT NULL DEFAULT 0,exit_code INTEGER,exit_signal TEXT);
        CREATE UNIQUE INDEX IF NOT EXISTS read_session_one_owner ON read_session_launches(serial) WHERE state<>'child_exited';`);
    } catch { fail(); }
  }
  receipt(): ReadSessionReceipt | null {
    try {
      const r = this.db.prepare("SELECT * FROM read_session_launches WHERE scope_digest=?").get(this.access.scopeDigest);
      if (!r) return null;
      return { launchId: String(r.launch_id), scopeDigest: String(r.scope_digest), state: r.state as ReadSessionReceipt["state"],
        closeAcknowledged: r.close_ack === 1, exitCode: r.exit_code === null ? null : Number(r.exit_code), exitSignal: r.exit_signal === null ? null : String(r.exit_signal) };
    } catch { fail(); }
  }
  private validateBundle(): void {
    if (process.platform !== "darwin") fail(); // No fallback to unsandboxed spawn.
    canonicalDirectory(this.bundle.sdkRoot); canonicalDirectory(this.bundle.overlaysRoot);
    pinnedFile(this.bundle.pythonPath, this.bundle.pythonSha256, true);
    pinnedFile(this.bundle.pythonRuntimePath, this.bundle.pythonRuntimeSha256);
    for (const name of readSessionSources) pinnedFile(join(this.bundle.overlaysRoot, name), this.bundle.sourceHashes[name]);
    const sandbox = lstatSync("/usr/bin/sandbox-exec");
    if (!sandbox.isFile() || sandbox.uid !== 0 || (sandbox.mode & 0o022)) fail();
  }
  async start(): Promise<{ replayed: boolean; receipt: ReadSessionReceipt }> {
    const original = this.receipt(); if (original) return { replayed: true, receipt: original };
    if (this.closing) fail();
    try {
      this.validateBundle(); this.bridge.requireCurrentAccess(this.access);
      this.db.exec("BEGIN IMMEDIATE");
      const current = this.receipt();
      if (current) { this.db.exec("COMMIT"); return { replayed: true, receipt: current }; }
      this.launchId = randomUUID();
      this.db.prepare("INSERT INTO read_session_launches(scope_digest,launch_id,serial,state) VALUES(?,?,?,'launch_intent')").run(this.access.scopeDigest, this.launchId, this.access.serial);
      this.db.exec("COMMIT"); // Never erase this intent after an uncertain launch.
      this.ownsBoundary = true;
      this.scratch = mkdtempSync(join(dirname(this.ledgerPath), "read-session-"));
      for (const name of ["tmp", "app", "traces"]) mkdirSync(join(this.scratch, name), { mode: 0o700 });
      const profile = readSessionSandboxProfile(this.access.socketPath, this.bundle.pythonPath, this.bundle.pythonRuntimePath, this.scratch);
      this.bridge.requireCurrentAccess(this.access); this.validateBundle();
      const child = spawn("/usr/bin/sandbox-exec", ["-p", profile, this.bundle.pythonPath, "-I", "-B", join(this.bundle.overlaysRoot, "socialgrowth_read_session.py"), this.bundle.sdkRoot], {
        cwd: this.scratch, env: { PATH: "/usr/bin:/bin", PYTHONDONTWRITEBYTECODE: "1", TMPDIR: join(this.scratch, "tmp"),
          ARTEMIS_APP_DIR: join(this.scratch, "app"), ARTEMIS_TRACES_DIR: join(this.scratch, "traces") }, stdio: ["pipe", "pipe", "pipe"], shell: false,
      });
      this.child = child;
      const ready = this.expect(15_000);
      child.stdout.on("data", v => this.read(v));
      child.stderr.resume(); // Never persist raw SDK/config/private-input errors.
      child.stdin.on("error", () => this.reject()); child.on("error", () => this.reject());
      this.exit = new Promise(resolve => child.once("close", (code, signal) => {
        try { this.db.prepare("UPDATE read_session_launches SET state='child_exited',close_ack=?,exit_code=?,exit_signal=? WHERE launch_id=?")
          .run(this.closedAcknowledged ? 1 : 0, code, signal, this.launchId); }
        catch { /* Intent survives; caller fails closed. */ }
        this.reject(); this.stopBoundary(); resolve();
      }));
      child.stdin.write(JSON.stringify({ version: readSessionVersion, launchId: this.launchId,
        access: { socket_path: this.access.socketPath, token: this.access.token, scope_digest: this.access.scopeDigest, serial: this.access.serial } }) + "\n");
      const ack = await ready;
      if (ack.type !== "ready" || this.stopping) fail();
      this.bridge.requireCurrentAccess(this.access);
      this.db.prepare("UPDATE read_session_launches SET state='ready' WHERE launch_id=? AND state='launch_intent'").run(this.launchId);
      return { replayed: false, receipt: this.receipt()! };
    } catch {
      try {
        if (this.db.isTransaction) this.db.exec("ROLLBACK");
        if (this.launchId) this.db.prepare("UPDATE read_session_launches SET state='launch_unknown' WHERE launch_id=? AND state<>'child_exited'").run(this.launchId);
      } catch { /* Preserve original intent; storage failure never skips shutdown. */ }
      this.stopBoundary(); await this.close(); fail();
    }
  }
  private expect(timeout: number): Promise<z.infer<typeof response>> {
    if (this.wait) fail();
    const pending = new Promise<z.infer<typeof response>>((resolve, reject) => {
      this.wait = { resolve, reject: () => reject(new ReadSessionError()), timer: setTimeout(() => { this.reject(); this.stopBoundary(); this.child?.kill("SIGKILL"); }, timeout) };
    });
    // An early pipe/storage exception can enter shutdown before await attaches.
    // Consume only the unhandled-rejection notification; callers still reject.
    void pending.catch(() => undefined);
    return pending;
  }
  private reject(): void { if (this.wait) { const w = this.wait; this.wait = null; clearTimeout(w.timer); w.reject(); } }
  private read(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");
    if (Buffer.byteLength(this.buffer) > 2048) { this.reject(); this.stopBoundary(); this.child?.kill("SIGKILL"); return; }
    const n = this.buffer.indexOf("\n"); if (n < 0) return;
    const frame = this.buffer.slice(0, n); this.buffer = this.buffer.slice(n + 1);
    let r: z.infer<typeof response>;
    try { r = response.parse(JSON.parse(frame)); if (r.launchId !== this.launchId || r.scopeDigest !== this.access.scopeDigest || !this.wait || this.buffer) fail(); }
    catch { this.reject(); this.stopBoundary(); this.child?.kill("SIGKILL"); return; }
    const w = this.wait; this.wait = null; clearTimeout(w!.timer); w!.resolve(r);
  }
  async observe(requestId: string): Promise<ReadSessionObservation> {
    if (!uuidSchema.safeParse(requestId).success || requestId !== requestId.toLowerCase() || this.observedOriginals.has(requestId)
      || !this.child || this.stopping || this.receipt()?.state !== "ready") fail();
    this.bridge.requireCurrentAccess(this.access);
    this.observedOriginals.add(requestId); // Failed/lost reads are never reissued.
    const pending = this.expect(35_000);
    try { this.child.stdin.write(JSON.stringify({ version: readSessionVersion, launchId: this.launchId, type: "observe", requestId }) + "\n");
      const r = await pending; this.bridge.requireCurrentAccess(this.access); if (r.type !== "observed" || r.requestId !== requestId) fail(); return observed.parse(r); }
    catch { this.stopBoundary(); await this.close(); fail(); }
  }
  private stopBoundary(): void {
    if (this.ownsBoundary && !this.stopping) {
      this.stopping = true;
      try { this.bridge.requestProcessStop(randomUUID()); }
      catch { this.child?.kill("SIGKILL"); } // Storage failure is not stop evidence.
    }
  }
  close(): Promise<void> { return this.closing ??= this.performClose(); }
  private async performClose(): Promise<void> {
    if (!this.child) { if (this.ownsBoundary) { await this.bridge.close(); this.cleanScratch(); } return; }
    this.stopBoundary(); this.reject();
    if (this.child.exitCode === null && this.child.signalCode === null) {
      const pending = this.expect(5000);
      this.child.stdin.end(JSON.stringify({ version: readSessionVersion, launchId: this.launchId, type: "close" }) + "\n");
      try { const ack = await pending; this.closedAcknowledged = ack.type === "closed"; } catch { /* wait own original child exit */ }
      const timer = setTimeout(() => this.child?.kill("SIGKILL"), 1000);
      await this.exit; clearTimeout(timer);
    } else await this.exit;
    await this.bridge.close(); // Drains original fenced work; never phone stop proof.
    this.child = null;
    this.cleanScratch();
  }
  private cleanScratch(): void { if (this.scratch) { rmSync(this.scratch, { recursive: true }); this.scratch = null; } }
  dispose(): void { if (this.child || this.wait) fail(); this.db.close(); }
}
