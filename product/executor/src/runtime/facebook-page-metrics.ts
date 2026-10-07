import { randomUUID, createHash } from "node:crypto";
import { z } from "zod-v3";
import type { RuntimeStore } from "./store.js";
import type { HumanAssistance } from "./human-assistance.js";
import { bindingSchema, requireFact } from "./contracts.js";
import { ArtemisMcp } from "./artemis.js";
import { AdbDevice, artemisStructuredResult } from "./device-executor.js";
import { pageMetricFactsSchema, pageMetricsTask, pageTaskResultEnvelope } from "./facebook-page-library.js";

const inputSchema = z.strictObject({ operationId: z.string().uuid(), projectId: z.string().uuid(), identityId: z.string().uuid() });
type Input = z.infer<typeof inputSchema>;
type Collection = Input & { state: "running" | "completed" | "unknown" | "failed"; traceId: string | null; accountId: string;
  bindingId: string; deviceId: string; serial: string; pageId: string; pageUrl: string; pageName: string;
  collectedAt: string | null; evidenceRefs: string[]; facts: z.infer<typeof pageMetricFactsSchema> | null; errorCode: string | null };

/** Common Page aggregate read, parameterized by an already verified mapping.
 * No caller-provided values, fixed phone gestures, publication or account creation. */
export class FacebookPageMetrics {
  private active = new Map<string, Promise<void>>();
  constructor(private store: RuntimeStore, private assistance: HumanAssistance,
    private config: { artemisRoot: string; runtimeUrl: string; token: string; callbackUrl: string }) {
    store.db.exec("CREATE TABLE IF NOT EXISTS facebook_page_metric_collections(operation_id TEXT PRIMARY KEY,body TEXT NOT NULL)");
    for (const row of this.list()) if (row.state === "running") this.save({ ...row, state: "unknown", errorCode: "RUNTIME_RESTARTED" });
  }
  list(): Array<Collection & { evidenceVerified: boolean }> {
    return this.store.db.prepare("SELECT body FROM facebook_page_metric_collections ORDER BY rowid DESC").all().map(r => {
      const row = JSON.parse(r.body as string) as Collection;
      const evidenceVerified = row.evidenceRefs.length >= 3 && row.evidenceRefs.every(id => {
        const evidence = this.store.db.prepare("SELECT sha256,body FROM evidence WHERE id=? AND task=?").get(id, row.operationId);
        return evidence && createHash("sha256").update(Buffer.from(evidence.body as Uint8Array)).digest("hex") === evidence.sha256;
      });
      return { ...row, evidenceVerified: Boolean(evidenceVerified) };
    });
  }
  read(id: string) { return this.list().find(r => r.operationId === id) ?? null; }
  private save(row: Collection) { this.store.db.prepare("INSERT INTO facebook_page_metric_collections VALUES(?,?) ON CONFLICT(operation_id) DO UPDATE SET body=excluded.body").run(row.operationId, JSON.stringify(row)); return row; }
  private async authorize(row: Collection) {
    const response = await fetch(new URL("/api/internal/page-metrics/authorize", this.config.callbackUrl), { method: "POST",
      headers: { authorization: `Bearer ${this.config.token}`, "content-type": "application/json" },
      body: JSON.stringify({ projectId: row.projectId, identityId: row.identityId, accountId: row.accountId }), signal: AbortSignal.timeout(10000) });
    requireFact(response.ok && (await response.json() as { allowed: boolean }).allowed === true, "PAGE_METRIC_SCOPE_CHANGED");
  }
  async authorizeAction(id: string, category: string) {
    const row = this.read(id); requireFact(row?.state === "running" && ["read", "navigate"].includes(category), "PAGE_METRIC_ACTION_NOT_ALLOWED");
    requireFact(this.store.db.prepare("SELECT actor FROM device_holds WHERE device=?").get(row.deviceId)?.actor === id, "DEVICE_HOLD_NOT_OWNED");
    await this.authorize(row);
  }
  async start(raw: unknown) {
    const input = inputSchema.parse(raw), previous = this.read(input.operationId);
    if (previous) { requireFact(previous.projectId === input.projectId && previous.identityId === input.identityId, "ID_CONFLICT"); return previous; }
    const mapping = this.store.db.prepare("SELECT * FROM business_plan_page_identity_mappings WHERE identity_id=?").get(input.identityId);
    requireFact(mapping, "PAGE_IDENTITY_MAPPING_UNAVAILABLE");
    const bindingRow = this.store.db.prepare("SELECT body FROM bindings WHERE id=?").get(mapping.binding_id as string);
    requireFact(bindingRow, "RUNTIME_BINDING_UNAVAILABLE");
    const binding = bindingSchema.parse(JSON.parse(bindingRow.body as string));
    requireFact(binding.platform === "facebook" && binding.accountId === mapping.runtime_account_id && binding.platformIdentity === mapping.parent_identity
      && Date.parse(binding.validUntil) > Date.now(), "RUNTIME_BINDING_UNAVAILABLE");
    const refs = z.array(z.string().uuid()).min(1).parse(JSON.parse(mapping.evidence_refs as string));
    requireFact(refs.every(ref => this.store.db.prepare("SELECT 1 FROM evidence WHERE id=? AND task=?").get(ref, mapping.audit_operation_id as string)), "PAGE_MAPPING_EVIDENCE_MISSING");
    requireFact(!this.assistance.deviceBusy(binding.deviceId) && !this.store.db.prepare("SELECT 1 FROM tasks WHERE device IN (?,?) AND status IN ('queued','running')").get(binding.deviceId, binding.serial), "DEVICE_BUSY");
    const row: Collection = { ...input, state: "running", traceId: null, accountId: mapping.account_id as string, bindingId: binding.id,
      deviceId: binding.deviceId, serial: binding.serial, pageId: mapping.page_id as string, pageUrl: mapping.page_url as string,
      pageName: mapping.page_name as string, facts: null, collectedAt: null, evidenceRefs: [], errorCode: null };
    await this.authorize(row);
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      requireFact(this.store.db.prepare("INSERT OR IGNORE INTO device_holds(device,actor,since) VALUES(?,?,?)").run(row.deviceId, row.operationId, new Date().toISOString()).changes === 1, "DEVICE_HELD");
      this.save(row); this.store.db.exec("COMMIT");
    } catch (error) { this.store.db.exec("ROLLBACK"); throw error; }
    let session: ReturnType<HumanAssistance["open"]>;
    try { session = this.assistance.open({ taskId: row.operationId, deviceId: row.deviceId, serial: row.serial,
      packageName: "com.facebook.katana", expectedIdentity: row.pageUrl, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      mode: "execution", policy: { mode: "preflight", maxRecovery: 0, allowPublication: false, allowTrustedInstall: false, allowIdentityCreation: false } }); }
    catch (error) {
      this.save({ ...row, state: "failed", errorCode: "PAGE_METRIC_SESSION_UNAVAILABLE" });
      this.store.db.prepare("DELETE FROM device_holds WHERE device=? AND actor=?").run(row.deviceId, row.operationId);
      throw error;
    }
    const task = this.execute(row, binding.platformIdentity, session.token);
    this.active.set(row.operationId, task); void task.finally(() => this.active.delete(row.operationId));
    return { ...row, evidenceVerified: false };
  }
  private archive(row: Collection, mime: string, bytes: Buffer) {
    const id = randomUUID(); this.store.db.prepare("INSERT INTO evidence(id,task,sha256,mime,body) VALUES(?,?,?,?,?)").run(id, row.operationId, createHash("sha256").update(bytes).digest("hex"), mime, bytes);
    row.evidenceRefs.push(id); this.save(row); return id;
  }
  private async execute(row: Collection, parentIdentity: string, token: string) {
    const client = new ArtemisMcp(this.config.artemisRoot, { url: this.config.runtimeUrl, token, deviceId: row.deviceId, serial: row.serial });
    let terminal = false;
    try {
      await client.connect(); await this.authorizeAction(row.operationId, "navigate");
      const launch = z.object({ trace_id: z.string().uuid(), device_serial: z.string() }).passthrough().parse(await client.call("mobile_run_task", {
        device_serial: row.serial, locked_app_package: "com.facebook.katana", model: "Pro", verification_level: "strict",
        task_desc: pageMetricsTask({ ...row, parentIdentity }), expected_output_desc: "Exact page metric JSON from actual observed UI, or UNCONFIRMED. No secrets or invented values." }));
      requireFact(launch.device_serial === row.serial, "ARTEMIS_DEVICE_MISMATCH");
      row.traceId = launch.trace_id; this.save(row);
      const deadline = Date.now() + 10 * 60_000;
      while (Date.now() < deadline) {
        const status = z.object({ trace_id: z.string().uuid(), device_serial: z.string(), status: z.string(), result: z.unknown().optional() }).passthrough()
          .parse(await client.call("mobile_manage_task", { trace_id: row.traceId, action: "status" }));
        requireFact(status.trace_id === row.traceId && status.device_serial === row.serial, "ARTEMIS_DEVICE_MISMATCH");
        if (!["running", "pending"].includes(status.status)) {
          terminal = true; this.archive(row, "application/json", Buffer.from(JSON.stringify(status)));
          requireFact(["completed", "success"].includes(status.status), "PAGE_METRIC_UNCONFIRMED");
          const envelope = await pageTaskResultEnvelope(status.result, this.config.artemisRoot, row.traceId, "metrics");
          const facts = pageMetricFactsSchema.parse(artemisStructuredResult(envelope.value));
          requireFact(facts.pageId === row.pageId && facts.pageUrl === row.pageUrl && facts.pageName === row.pageName, "PAGE_IDENTITY_MISMATCH");
          await this.authorizeAction(row.operationId, "read");
          this.archive(row, "image/png", await new AdbDevice().screenshot(row.serial));
          this.archive(row, "application/json", Buffer.from(JSON.stringify({ traceId: row.traceId, serial: row.serial, facts, noteDigest: envelope.noteDigest ?? null })));
          row.facts = facts; row.collectedAt = new Date().toISOString(); row.state = "completed"; this.save(row); return;
        }
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      throw new Error("PAGE_METRIC_TIMEOUT");
    } catch (error) {
      if (row.traceId && !terminal) {
        try { await client.call("mobile_manage_task", { trace_id: row.traceId, action: "cancel" });
          const stopped = await client.call("mobile_manage_task", { trace_id: row.traceId, action: "status" }) as Record<string, unknown>;
          terminal = stopped.trace_id === row.traceId && stopped.device_serial === row.serial && ["cancelled", "canceled", "failed", "completed"].includes(String(stopped.status));
        } catch { /* Unknown original stays held; never retry it. */ }
      }
      row.state = terminal ? "failed" : "unknown"; row.errorCode = error instanceof Error && error.message === "PAGE_METRIC_TIMEOUT" ? "PAGE_METRIC_TIMEOUT" : "PAGE_METRIC_UNCONFIRMED"; this.save(row);
    } finally {
      await client.close().catch(() => undefined); this.assistance.closeSession(token);
      if (terminal) this.store.db.prepare("DELETE FROM device_holds WHERE device=? AND actor=?").run(row.deviceId, row.operationId);
    }
  }
}
