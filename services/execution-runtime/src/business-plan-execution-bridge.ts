import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ExecutionReceipt } from "../../../apps/artemis-controller/src/types.ts";
import { AdbDevice, executeDeviceTask, type DevicePort } from "./device-executor.ts";
import { ArtemisMcp, type ArtemisPort } from "./artemis.ts";
import type { HumanAssistance } from "./human-assistance.ts";
import type { RuntimeStore } from "./store.ts";
import { bindingSchema, requireFact } from "./contracts.ts";

const uuid = z.string().uuid();
const scopeSchema = z.strictObject({
  projectId: uuid, taskId: uuid, taskRevision: z.number().int().positive(), planId: uuid,
  planRevision: z.number().int().positive(), projectVersion: z.number().int().nonnegative(), approvalId: uuid,
  contentUnitId: uuid, variantId: uuid, materialRevision: z.number().int().positive(),
  expectedFiles: z.array(z.strictObject({ objectId: uuid, sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().positive(), contentType: z.string().min(1).max(100) })).min(1).max(20),
  taskAttemptId: uuid, identityId: uuid, reservedDeviceId: uuid,
  platform: z.literal("facebook"), form: z.literal("facebook_video"), scheduledAt: z.string().datetime({ offset: true }),
});
const startSchema = z.strictObject({
  operationId: uuid, claimId: uuid, scopeFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  scope: scopeSchema, canonicalIdentityRef: z.string().trim().min(1).max(512), accountId: uuid,
  pageName: z.string().trim().min(1).max(200), captionText: z.string().trim().min(1).max(5000),
  assetSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
type StartInput = z.infer<typeof startSchema>;
type ExecutionPhase = "identity_audit" | "content_preflight";
type Diagnostic = { phase: ExecutionPhase | "unknown"; reason: string };
const diagnosticReasons = new Set(["EXECUTION_TIMEOUT", "ARTEMIS_TASK_FAILED", "ARTEMIS_DEVICE_MISMATCH", "ARTEMIS_TOOL_FAILED",
  "ARTEMIS_CONTRACT_UNSUPPORTED", "ARTEMIS_HUMAN_INPUT_EXTENSION_REQUIRED", "TECHNICAL_FAILURE", "IDENTITY_GATE_VIOLATED",
  "PAGE_IDENTITY_AUDIT_INCOMPLETE", "DIAGNOSTIC_UNAVAILABLE"]);
type ActionCategory = "read" | "navigate" | "login_submit" | "recovery" | "install" | "publish" | "create_identity" | "correct_account" | "unmanaged";
type BridgeRecord = StartInput & { state: "running" | "completed" | "unknown" | "blocked"; startedAt: string;
  updatedAt: string; traceId: string | null; executionPhase?: ExecutionPhase; diagnostic?: Diagnostic;
  receipt: ExecutionReceipt | null; blocker: string | null };

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stable(object[key])}`).join(",")}}`;
}

export interface BusinessPlanExecutionBridgeConfig {
  dataDir: string;
  artemisRoot: string;
  runtimeUrl: string;
  token: string;
  deviceId: string;
  serial: string;
  bindingId: string;
  productDeviceId: string;
  productIdentityId: string;
  canonicalIdentityRef: string;
  accountId: string;
  runtimeAccountId: string;
  pageName: string;
  callbackUrl: string;
}

/** A narrow no-publication bridge. It accepts only a current FB video scope and
 * executes through the existing device executor and HumanAssistance/Supervision. */
export class BusinessPlanExecutionBridge {
  private readonly active = new Map<string, Promise<void>>();
  constructor(private readonly store: RuntimeStore, private readonly assistance: HumanAssistance,
    private readonly config: BusinessPlanExecutionBridgeConfig,
    private readonly ports: { artemis: (root: string, assistance: { url: string; token: string; deviceId: string; serial: string }) => ArtemisPort;
      device: DevicePort } = { artemis: (root, scope) => new ArtemisMcp(root, scope), device: new AdbDevice() }) {
    store.db.exec("CREATE TABLE IF NOT EXISTS business_plan_executions (operation_id TEXT PRIMARY KEY, body TEXT NOT NULL, request_digest TEXT NOT NULL)");
    store.db.exec("CREATE TABLE IF NOT EXISTS business_plan_identity_audits (operation_id TEXT PRIMARY KEY, binding_id TEXT NOT NULL, previous_identity TEXT NOT NULL, previous_binding_json TEXT NOT NULL, observed_page_url TEXT NOT NULL, page_name TEXT NOT NULL, evidence_refs TEXT NOT NULL, verified_at TEXT NOT NULL)");
    store.db.exec("CREATE TABLE IF NOT EXISTS business_plan_page_identity_mappings (identity_id TEXT PRIMARY KEY, canonical_ref TEXT NOT NULL, account_id TEXT NOT NULL, runtime_account_id TEXT NOT NULL, binding_id TEXT NOT NULL, audit_operation_id TEXT NOT NULL, parent_identity TEXT NOT NULL, page_id TEXT NOT NULL, page_url TEXT NOT NULL, page_name TEXT NOT NULL, evidence_refs TEXT NOT NULL, verified_at TEXT NOT NULL)");
    for (const row of this.rows()) if (row.state === "running") this.update({ ...row, state: "unknown", blocker: "runtime_restarted_original_attempt_held", updatedAt: new Date().toISOString() });
  }
  private rows(): BridgeRecord[] { return this.store.db.prepare("SELECT body FROM business_plan_executions ORDER BY rowid DESC").all().map(row => JSON.parse(row.body as string)); }
  private update(record: BridgeRecord) {
    const current = this.store.db.prepare("SELECT body FROM business_plan_executions WHERE operation_id=?").get(record.operationId) as { body: string } | undefined;
    const previous = current ? JSON.parse(current.body) as BridgeRecord : null;
    if (!record.traceId && previous?.traceId) record = { ...record, traceId: previous.traceId };
    this.store.db.prepare("UPDATE business_plan_executions SET body=? WHERE operation_id=?").run(JSON.stringify(record), record.operationId);
    return record;
  }
  read(operationId: string) {
    requireFact(uuid.safeParse(operationId).success, "INPUT_INVALID");
    const record = this.rows().find(row => row.operationId === operationId) ?? null;
    if (!record) return null;
    if (!record.receipt) return record.state === "unknown" ? { ...record, diagnostic: this.legacyDiagnostic(record) } : record;
    const refs = record.receipt.evidenceRefs;
    const archived = refs.length > 0 && refs.every(ref => this.store.db.prepare("SELECT 1 FROM evidence WHERE id=? AND task=?").get(ref, operationId));
    const mapping = this.store.db.prepare("SELECT identity_id,canonical_ref,account_id,runtime_account_id,binding_id,audit_operation_id,parent_identity,page_id,page_url,page_name,evidence_refs FROM business_plan_page_identity_mappings WHERE identity_id=?")
      .get(record.scope.identityId) as { identity_id: string; canonical_ref: string; account_id: string; binding_id: string; parent_identity: string;
        runtime_account_id: string; audit_operation_id: string; page_id: string; page_url: string; page_name: string; evidence_refs: string } | undefined;
    const identityMappingVerified = Boolean(mapping && mapping.identity_id === record.scope.identityId && mapping.canonical_ref === record.canonicalIdentityRef
      && mapping.account_id === record.accountId && mapping.runtime_account_id === this.config.runtimeAccountId
      && mapping.binding_id === this.config.bindingId && mapping.parent_identity
      && mapping.page_id === record.receipt.observedIdentityId && mapping.page_url === record.receipt.observedIdentity
      && mapping.page_name === record.receipt.observedIdentityName && record.receipt.managementVerified === true
      && JSON.parse(mapping.evidence_refs).every((ref: string) => this.store.db.prepare("SELECT 1 FROM evidence WHERE id=? AND task=?").get(ref, mapping.audit_operation_id)));
    return { ...record, evidenceVerified: Boolean(archived), identityMappingVerified };
  }
  private legacyDiagnostic(record: BridgeRecord): Diagnostic | undefined {
    if (!record.traceId) return undefined;
    const rows = this.store.db.prepare("SELECT sha256,mime,body FROM evidence WHERE task=? AND mime='application/json'").all(record.operationId) as Array<{ sha256: string; mime: string; body: Buffer }>;
    const parsed = rows.flatMap(row => {
      const body = Buffer.from(row.body);
      if (body.length > 128 * 1024 || createHash("sha256").update(body).digest("hex") !== row.sha256) return [];
      try { const value = JSON.parse(body.toString("utf8")); return value && typeof value === "object" ? [value as Record<string, unknown>] : []; } catch { return []; }
    });
    const traces = parsed.filter(value => value.traceId === record.traceId && value.deviceSerial === this.config.serial
      && value.attemptId === record.scope.taskAttemptId && typeof value.taskId === "string" && uuid.safeParse(value.taskId).success);
    if (traces.length !== 1) return undefined;
    const trace = traces[0]!;
    const failures = parsed.filter(value => value.taskId === trace.taskId && value.attemptId === trace.attemptId
      && (value.stage === "device_work_started" || value.stage === "before_device_work")
      && typeof value.reason === "string" && diagnosticReasons.has(value.reason));
    if (failures.length !== 1) return undefined;
    const hasMapping = Boolean(this.store.db.prepare("SELECT 1 FROM business_plan_page_identity_mappings WHERE identity_id=?").get(record.scope.identityId));
    return { phase: hasMapping ? "content_preflight" : "identity_audit", reason: failures[0]!.reason as string };
  }
  ownsOperation(operationId: string) { return this.read(operationId) !== null; }
  list() { return this.rows().map(row => this.read(row.operationId)); }
  async start(raw: unknown) {
    const input = startSchema.parse(raw), digest = createHash("sha256").update(stable(input)).digest("hex");
    const previous = this.read(input.operationId);
    if (previous) {
      const stored = this.store.db.prepare("SELECT request_digest FROM business_plan_executions WHERE operation_id=?").get(input.operationId);
      requireFact(stored?.request_digest === digest, "ID_CONFLICT");
      return previous;
    }
    const binding = this.runtimeBinding(input);
    const file = input.scope.expectedFiles[0];
    requireFact(input.scope.expectedFiles.length === 1 && file?.contentType === "video/mp4" && file.sha256 === input.assetSha256, "BUSINESS_PLAN_FILE_SCOPE_INVALID");
    const asset = this.store.db.prepare("SELECT mime,size FROM assets WHERE sha256=?").get(file.sha256) as { mime: string; size: number } | undefined;
    requireFact(asset?.mime === "video/mp4", "BUSINESS_PLAN_ASSET_MISSING");
    requireFact(asset.size === file.bytes, "BUSINESS_PLAN_ASSET_SIZE_MISMATCH");
    const assetPath = join(this.config.dataDir, "assets", file.sha256);
    const bytes = await readFile(assetPath);
    requireFact(bytes.length === file.bytes && createHash("sha256").update(bytes).digest("hex") === file.sha256, "BUSINESS_PLAN_ASSET_INVALID");
    requireFact(!this.assistance.deviceBusy(binding.deviceId), "DEVICE_BUSY");
    requireFact(!this.store.db.prepare("SELECT 1 FROM device_holds WHERE device=?").get(binding.deviceId), "DEVICE_HELD");
    requireFact(!this.rows().some(row => row.state === "running" && row.scope.reservedDeviceId === input.scope.reservedDeviceId), "DEVICE_BUSY");
    requireFact(!this.runtimeUnresolved(binding.deviceId), "DEVICE_HAS_UNRESOLVED_RUNTIME_TASK");
    const timestamp = new Date().toISOString();
    const record: BridgeRecord = { ...input, state: "running", startedAt: timestamp, updatedAt: timestamp, traceId: null, receipt: null, blocker: null };
    // Claim the shared device hold and durable original operation together before any
    // phone call; other runtime workflows use the same primary-key hold.
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      const held = this.store.db.prepare("INSERT OR IGNORE INTO device_holds(device,actor,since) VALUES(?,?,?)")
        .run(binding.deviceId, record.operationId, timestamp);
      requireFact(held.changes === 1, "DEVICE_HELD");
      this.store.db.prepare("INSERT INTO business_plan_executions(operation_id,body,request_digest) VALUES(?,?,?)")
        .run(record.operationId, JSON.stringify(record), digest);
      this.store.db.exec("COMMIT");
    } catch (error) {
      this.store.db.exec("ROLLBACK");
      throw error;
    }
    const task: Parameters<typeof executeDeviceTask>[0] = {
      directive: {
        schemaVersion: "design-v1", taskId: record.operationId, attemptId: input.scope.taskAttemptId,
        projectId: input.scope.projectId, strategyVersionId: input.scope.planId, approvalId: input.scope.approvalId,
        bindingId: binding.id, deviceId: binding.deviceId, accountId: binding.accountId, platform: "facebook",
        targetAppPackage: "com.facebook.katana", contentIdentityId: input.scope.identityId,
        sliceId: file.objectId, media: { url: `http://127.0.0.1:${new URL(this.config.runtimeUrl).port}/api/runtime/assets/${file.sha256}`,
          sha256: file.sha256, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() },
        captionText: input.captionText, scheduledAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        timeZone: "UTC", steps: [{ stepIndex: 0, action: "open_app" }, { stepIndex: 1, action: "select_media" }, { stepIndex: 2, action: "input_text", value: input.captionText }],
        taskTimeoutMs: 15 * 60_000,
      },
      settings: { mode: "preflight", captionText: input.captionText, audience: "public", aiLabel: false,
        aiLabelReason: "not_applicable_preflight", taskTimeoutMs: 15 * 60_000, requireFacebookPage: true,
        expectedFacebookPageName: input.pageName },
      binding,
    };
    const session = this.assistance.open({ taskId: record.operationId, deviceId: binding.deviceId, serial: binding.serial,
      packageName: "com.facebook.katana", expectedIdentity: binding.platformIdentity,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), mode: "execution",
      policy: { mode: "preflight", maxRecovery: 0, allowPublication: false, allowTrustedInstall: false, allowIdentityCreation: false } });
    const promise = this.execute(record, task, bytes, session.token);
    this.active.set(record.operationId, promise);
    void promise.finally(() => this.active.delete(record.operationId));
    return record;
  }
  private runtimeBinding(input: StartInput) {
    requireFact(input.scope.reservedDeviceId === this.config.productDeviceId, "PRODUCT_DEVICE_BINDING_MISMATCH");
    const bindings = this.store.db.prepare("SELECT body FROM bindings").all().map(row => bindingSchema.safeParse(JSON.parse(row.body as string))).filter(result => result.success).map(result => result.data);
    const binding = bindings.find(value => value.id === this.config.bindingId && value.deviceId === this.config.deviceId && value.serial === this.config.serial);
    requireFact(binding && binding.platform === "facebook" && binding.platformIdentity.trim().length > 0 && Date.parse(binding.validUntil) > Date.now(), "RUNTIME_BINDING_UNAVAILABLE");
    requireFact(input.scope.platform === binding.platform && input.scope.identityId === this.config.productIdentityId
      && input.canonicalIdentityRef === this.config.canonicalIdentityRef && input.accountId === this.config.accountId
      && binding.accountId === this.config.runtimeAccountId && input.pageName === this.config.pageName, "RUNTIME_IDENTITY_SCOPE_MISMATCH");
    return binding;
  }
  private runtimeUnresolved(deviceId: string) {
    const tasks = this.store.db.prepare("SELECT status,body,receipt FROM tasks WHERE device=?").all(deviceId) as Array<{ status: string; body: string; receipt: string | null }>;
    // Historical unknown outcomes stay frozen and are queried only by their original
    // task identity. They do not, by themselves, represent an active phone session.
    return tasks.some(row => row.status === "queued" || row.status === "running");
  }
  private pageMapping(record: BridgeRecord) {
    const row = this.store.db.prepare("SELECT canonical_ref,account_id,runtime_account_id,binding_id,audit_operation_id,parent_identity,page_id,page_url,page_name,evidence_refs FROM business_plan_page_identity_mappings WHERE identity_id=?")
      .get(record.scope.identityId) as { canonical_ref: string; account_id: string; binding_id: string; audit_operation_id: string;
        runtime_account_id: string; parent_identity: string; page_id: string; page_url: string; page_name: string; evidence_refs: string } | undefined;
    if (!row || row.canonical_ref !== record.canonicalIdentityRef || row.account_id !== record.accountId || row.runtime_account_id !== this.config.runtimeAccountId || row.binding_id !== this.config.bindingId
      || row.parent_identity !== this.runtimeBinding(record).platformIdentity || row.page_name !== record.pageName) return null;
    let evidenceRefs: string[];
    try { evidenceRefs = z.array(z.string().uuid()).min(1).parse(JSON.parse(row.evidence_refs)); } catch { return null; }
    if (!evidenceRefs.every(ref => this.store.db.prepare("SELECT 1 FROM evidence WHERE id=? AND task=?").get(ref, row.audit_operation_id))) return null;
    return { id: row.page_id, url: row.page_url, parentIdentity: row.parent_identity, evidenceRefs, auditOperationId: row.audit_operation_id };
  }
  private async execute(record: BridgeRecord, task: Parameters<typeof executeDeviceTask>[0], bytes: Buffer, assistanceToken: string) {
    const artemis = this.ports.artemis(this.config.artemisRoot, { url: this.config.runtimeUrl, token: assistanceToken,
      deviceId: this.config.deviceId, serial: this.config.serial });
    let phase: ExecutionPhase = "identity_audit";
    let phaseReceipt: ExecutionReceipt | null = null;
    try {
      await (artemis as ArtemisPort & { connect?: () => Promise<void> }).connect?.();
      const runTask = (taskInput: Parameters<typeof executeDeviceTask>[0], taskPhase: ExecutionPhase) => executeDeviceTask(taskInput, { artemis, device: this.ports.device,
        download: async url => { requireFact(new URL(url).origin === new URL(this.config.runtimeUrl).origin, "MEDIA_ORIGIN_MISMATCH"); return bytes; },
        authorizePrepare: async () => { await this.authorizePrepare(record, assistanceToken); },
        trace: traceId => this.update({ ...record, traceId, executionPhase: taskPhase, updatedAt: new Date().toISOString() }), installMissing: false,
        archive: async (mime, body) => {
          const id = randomUUID(), digest = createHash("sha256").update(body).digest("hex");
          this.store.db.prepare("INSERT INTO evidence(id,task,sha256,mime,body) VALUES(?,?,?,?,?)").run(id, record.operationId, digest, mime, body);
          return id;
        } });
      let mapping = this.pageMapping(record);
      if (!mapping) {
        const auditTask = { ...task, directive: { ...task.directive, taskId: randomUUID() }, settings: { ...task.settings, identityAuditOnly: true } } as Parameters<typeof executeDeviceTask>[0];
        phase = "identity_audit";
        const audit = await runTask(auditTask, phase);
        phaseReceipt = audit;
        const auditPassed = audit.executionStatus === "completed" && audit.publishStatus === "not_submitted"
          && audit.finalSubmitClicked === false && audit.mutationsPerformed === 0
          && audit.observedIdentityKind === "facebook_page" && audit.observedIdentityName === record.pageName
          && Boolean(audit.observedIdentityId && audit.observedIdentity && audit.parentIdentity === task.binding.platformIdentity)
          && audit.managementVerified === true && audit.evidenceRefs.length > 0;
        if (!auditPassed) {
          const diagnostic = this.receiptDiagnostic(record, audit, phase);
          this.update({ ...record, state: "unknown", receipt: audit, executionPhase: phase, diagnostic,
            blocker: diagnostic.reason, updatedAt: new Date().toISOString() });
          return;
        }
        const verifiedAt = new Date().toISOString(), previousBinding = this.runtimeBinding(record);
        requireFact(typeof previousBinding.platformIdentity === "string" && audit.parentIdentity === previousBinding.platformIdentity
          && typeof audit.observedIdentityId === "string" && typeof audit.observedIdentity === "string"
          && typeof audit.observedIdentityName === "string", "PAGE_IDENTITY_AUDIT_INCOMPLETE");
        const saved = this.store.db.prepare("INSERT OR IGNORE INTO business_plan_page_identity_mappings(identity_id,canonical_ref,account_id,runtime_account_id,binding_id,audit_operation_id,parent_identity,page_id,page_url,page_name,evidence_refs,verified_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
          .run(record.scope.identityId, record.canonicalIdentityRef, record.accountId, this.config.runtimeAccountId, previousBinding.id, record.operationId,
            audit.parentIdentity!, audit.observedIdentityId!, audit.observedIdentity!, audit.observedIdentityName!, JSON.stringify(audit.evidenceRefs), verifiedAt);
        requireFact(saved.changes === 1, "PAGE_IDENTITY_MAPPING_CONFLICT");
        this.store.db.prepare("INSERT OR IGNORE INTO business_plan_identity_audits VALUES(?,?,?,?,?,?,?,?)")
          .run(record.operationId, previousBinding.id, previousBinding.platformIdentity!, JSON.stringify(previousBinding), audit.observedIdentity!,
            record.pageName, JSON.stringify(audit.evidenceRefs), verifiedAt);
        mapping = this.pageMapping(record);
      }
      requireFact(mapping, "PAGE_IDENTITY_MAPPING_UNAVAILABLE");
      const contentTask = { ...task, directive: { ...task.directive, taskId: randomUUID() }, settings: {
        ...task.settings, expectedFacebookPageIdentity: { id: mapping.id, url: mapping.url } } } as Parameters<typeof executeDeviceTask>[0];
      phase = "content_preflight";
      const contentReceipt = await runTask(contentTask, phase);
      phaseReceipt = contentReceipt;
      const receipt: ExecutionReceipt = { ...contentReceipt,
        observedIdentityId: mapping.id, parentIdentity: mapping.parentIdentity, managementVerified: true };
      const state = receipt.executionStatus === "completed" && receipt.publishStatus === "not_submitted" ? "completed" : receipt.publishStatus === "unknown" ? "unknown" : "blocked";
      const diagnostic = state === "completed" ? undefined : this.receiptDiagnostic(record, receipt, phase);
      this.update({ ...record, state, receipt, executionPhase: phase, diagnostic, updatedAt: new Date().toISOString(), blocker: state === "blocked" ? receipt.failureCode ?? "BUSINESS_PLAN_PREFLIGHT_NOT_CONFIRMED" : diagnostic?.reason ?? null });
    } catch (error) {
      const diagnostic = phaseReceipt ? this.receiptDiagnostic(record, phaseReceipt, phase) : { phase: "unknown" as const, reason: this.safeReason(error) };
      this.update({ ...record, state: "unknown", ...(phaseReceipt ? { receipt: phaseReceipt } : {}), executionPhase: phase,
        diagnostic, updatedAt: new Date().toISOString(), blocker: diagnostic.reason });
    } finally {
      await artemis.close().catch(() => undefined);
      this.assistance.closeSession(assistanceToken);
      const final = this.read(record.operationId);
      if (final?.state === "completed" || final?.state === "blocked") {
        this.store.db.prepare("DELETE FROM device_holds WHERE device=? AND actor=?").run(task.binding.deviceId, record.operationId);
      }
    }
  }
  private safeReason(error: unknown) {
    const reason = error instanceof Error ? error.message : "";
    return diagnosticReasons.has(reason) ? reason : "DIAGNOSTIC_UNAVAILABLE";
  }
  private receiptDiagnostic(record: BridgeRecord, receipt: ExecutionReceipt, phase: ExecutionPhase): Diagnostic {
    const stored = this.legacyDiagnostic({ ...record, traceId: this.read(record.operationId)?.traceId ?? record.traceId });
    if (stored?.phase === phase) return stored;
    if (receipt.failureCode === "IDENTITY_CHALLENGE") return { phase, reason: "IDENTITY_GATE_VIOLATED" };
    if (receipt.failureCode && diagnosticReasons.has(receipt.failureCode)) return { phase, reason: receipt.failureCode };
    return { phase, reason: "DIAGNOSTIC_UNAVAILABLE" };
  }
  async authorizeAction(operationId: string, action: string, category: ActionCategory) {
    const record = this.read(operationId);
    requireFact(record?.state === "running", "BUSINESS_PLAN_OPERATION_NOT_RUNNING");
    const response = await fetch(new URL("/api/internal/business-plan-workflow/authorize-action", this.config.callbackUrl), {
      method: "POST", headers: { authorization: `Bearer ${this.config.token}`, "content-type": "application/json" },
      body: JSON.stringify({ operationId, claimId: record.claimId, scope: record.scope, scopeFingerprint: record.scopeFingerprint,
        stepId: `${category}:${action}` }), signal: AbortSignal.timeout(10000),
    });
    requireFact(response.ok, "BUSINESS_PLAN_SCOPE_REVALIDATION_FAILED");
    const result = z.strictObject({ allowed: z.boolean() }).parse(await response.json());
    requireFact(result.allowed, "BUSINESS_PLAN_ACTION_NOT_AUTHORIZED");
    return result;
  }
  private async authorizePrepare(record: BridgeRecord, assistanceToken: string) {
    const session = this.assistance.session(assistanceToken);
    const binding = this.runtimeBinding(record);
    const assertLocalExecutionActive = () => {
      const hold = this.store.db.prepare("SELECT actor FROM device_holds WHERE device=?").get(binding.deviceId) as { actor: string } | undefined;
      requireFact(hold?.actor === record.operationId, "DEVICE_HOLD_NOT_OWNED");
      requireFact(this.assistance.supervision.get(session.id).state === "active", "AGENT_ACTIONS_FROZEN");
    };
    assertLocalExecutionActive();
    await this.authorizeAction(record.operationId, "prepare_media", "navigate");
    assertLocalExecutionActive();
    this.assistance.supervision.gate(session.id, { action: "prepare_media", category: "navigate" });
  }
}
