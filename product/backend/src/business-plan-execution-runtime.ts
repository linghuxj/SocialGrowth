import { createHash, randomUUID } from "node:crypto";
import type { BusinessPlanWorkflowScope } from "@socialgrowth/product-contracts";
import type { BusinessPlanWorkflowPorts, WorkflowReadiness } from "./business-plan-workflow-store.js";

type ExecutionFacts = { canonicalIdentityRef: string; accountId: string; pageName: string; captionText: string };
type RuntimeResult = { operationId: string; claimId: string; scopeFingerprint: string; state: "running" | "completed" | "unknown" | "blocked";
  scope: BusinessPlanWorkflowScope; evidenceVerified?: boolean; identityMappingVerified?: boolean;
  receipt: null | { publishStatus: string; executionStatus: string; observedIdentity?: string; observedIdentityKind?: string; observedIdentityName?: string;
    observedIdentityId?: string; parentIdentity?: string; managementVerified?: boolean; evidenceRefs: string[] } };
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

/** Adapter for the one supported workflow slice: Facebook video preflight through
 * the existing supervised Artemis runtime. It never presses the final publish control. */
export class BusinessPlanExecutionRuntime {
  constructor(private readonly config: { url: string; token: string; bindingId: string; deviceId: string; serial: string; productDeviceId: string;
    productIdentityId: string; canonicalIdentityRef: string; accountId: string },
    private readonly facts: (scope: BusinessPlanWorkflowScope) => Promise<ExecutionFacts>,
    private readonly readiness: (scope: BusinessPlanWorkflowScope) => Promise<WorkflowReadiness>,
    private readonly authorize: (input: { scope: BusinessPlanWorkflowScope; operationId: string; stepId: string; scopeFingerprint: string }) => Promise<{ permitId: string; scopeFingerprint: string; expiresAt: string } | null>,
    private readonly bytes: (scope: BusinessPlanWorkflowScope, file: BusinessPlanWorkflowScope["expectedFiles"][number]) => Promise<Buffer>) {}

  ports(): BusinessPlanWorkflowPorts {
    const request = async (path: string, init?: RequestInit) => {
      const response = await fetch(new URL(path, this.config.url), { ...init,
        headers: { authorization: `Bearer ${this.config.token}`, ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`EXECUTION_RUNTIME_${response.status}`);
      return response.json() as Promise<unknown>;
    };
    const assess = async (scope: BusinessPlanWorkflowScope, ownOperationId?: string): Promise<WorkflowReadiness> => {
      const business = await this.readiness(scope);
      const localPreflightExceptions = new Set(["network_not_admitted", "stop_unconfirmed", "action_inspector_unavailable"]);
      const businessBlockers = business.blockers.filter(blocker => !localPreflightExceptions.has(blocker));
      if (businessBlockers.length || (business.businessState !== "ready" && !(business.businessState === "blocked" && business.blockers.length > 0))) {
        return business;
      }
      try {
        const [statusRaw, deviceRaw] = await Promise.all([request("/api/runtime/status"), request("/api/runtime/devices/states")]);
        const status = statusRaw as { bindings?: Array<{ id: string; deviceId: string; serial: string; platform: string; validUntil: string }>;
          tasks?: Array<{ status: string; task?: { binding?: { deviceId?: string } } }>;
          deviceHolds?: Array<{ device: string; actor?: string }>;
          supervision?: { controls?: Array<{ deviceId: string; taskId: string; state: string }>;
            requests?: Array<{ deviceId: string; taskId: string; status: string }> };
          pauses?: Array<{ scope: string; reason: string }> };
        const devices = deviceRaw as { devices?: Array<{ serial: string; adbStatus: string; status: string }> };
        const binding = status.bindings?.find(item => item.id === this.config.bindingId && item.deviceId === this.config.deviceId
          && item.serial === this.config.serial && item.platform === "facebook" && Date.parse(item.validUntil) > Date.now());
        const device = devices.devices?.find(item => item.serial === this.config.serial && item.adbStatus === "device");
        const activeTask = status.tasks?.some(item => ["queued", "running"].includes(item.status) && item.task?.binding?.deviceId === this.config.deviceId);
        const deviceHolds = status.deviceHolds?.filter(item => item.device === this.config.deviceId || item.device === this.config.serial) ?? [];
        const ownHoldConfirmed = Boolean(ownOperationId && deviceHolds.some(item => item.actor === ownOperationId));
        const held = deviceHolds.some(item => item.actor !== ownOperationId);
        const activeControl = status.supervision?.controls?.some(item => item.deviceId === this.config.deviceId && item.taskId !== ownOperationId && ["active", "waiting", "revalidate"].includes(item.state));
        const activeRequest = status.supervision?.requests?.some(item => item.deviceId === this.config.deviceId && item.taskId !== ownOperationId && ["waiting", "claimed"].includes(item.status));
        const paused = status.pauses?.some(item => item.scope === `device:${this.config.deviceId}` || item.scope === `device:${this.config.serial}`);
        const localInspectorReady = Boolean(binding && device && !activeTask && !held && !activeControl && !activeRequest);
        const nonLocalBlockers = businessBlockers;
        const blockers = [...nonLocalBlockers, ...(!binding ? ["runtime_binding_unavailable"] : []), ...(!device ? ["physical_device_offline"] : []),
          ...(activeTask ? ["runtime_device_task_active"] : []), ...(held ? ["runtime_device_held"] : []),
          ...(activeControl ? ["runtime_supervision_active"] : []), ...(activeRequest ? ["runtime_assistance_request_active"] : []),
          ...(paused ? ["runtime_device_paused"] : []),
          ...(ownOperationId && !ownHoldConfirmed ? ["runtime_operation_hold_missing"] : []),
          ...(!localInspectorReady ? ["local_device_preflight_unconfirmed"] : [])];
        return { ...business, adapterState: "connected", businessState: blockers.length ? "blocked" : "ready", blockers };
      } catch {
        return { ...business, adapterState: "unconnected", businessState: "unknown", blockers: ["runtime_device_inspector_unavailable"] };
      }
    };
    return {
      readiness: { assess },
      actionGate: { authorizeAction: async input => {
        if (!/^(read|navigate|login_submit|recovery):/.test(input.stepId)) return null;
        const state = await assess(input.scope, input.operationId);
        if (state.adapterState !== "connected" || state.businessState !== "ready" || state.blockers.length || state.scopeFingerprint !== input.scopeFingerprint) return null;
        return this.authorize(input);
      } },
      executor: { execute: async ({ scope, operationId, claimId }) => {
        if (scope.platform !== "facebook" || scope.form !== "facebook_video" || scope.expectedFiles.length !== 1) throw new Error("UNSUPPORTED_EXECUTION_SCOPE");
        const file = scope.expectedFiles[0]!, facts = await this.facts(scope), content = await this.bytes(scope, file);
        if (scope.identityId !== this.config.productIdentityId || facts.canonicalIdentityRef !== this.config.canonicalIdentityRef
          || facts.accountId !== this.config.accountId || !facts.pageName.trim()) throw new Error("EXECUTION_IDENTITY_CONFIGURATION_MISMATCH");
        if (content.length !== file.bytes || createHash("sha256").update(content).digest("hex") !== file.sha256) throw new Error("VERIFIED_ASSET_MISMATCH");
        await request("/api/runtime/assets", { method: "POST", headers: { "content-type": "application/octet-stream", "x-content-sha256": file.sha256 }, body: new Uint8Array(content) });
        const scopeFingerprint = createHash("sha256").update(canonicalJson(scope)).digest("hex");
        // The workflow store uses canonical sorted JSON. Its action callback rejects
        // a fingerprint mismatch; caller supplies the same value on execution below.
        const started = await request("/api/runtime/business-plan-executions", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ operationId, claimId, scopeFingerprint, scope, ...facts, assetSha256: file.sha256 }) }) as RuntimeResult;
        const deadline = Date.now() + 16 * 60_000;
        let result = started;
        while (result.state === "running" && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 1500));
          result = await request(`/api/runtime/business-plan-executions/${operationId}`) as RuntimeResult;
        }
        return { sourceEventId: randomUUID(), payloadDigest: createHash("sha256").update(JSON.stringify(result)).digest("hex"),
          reportedState: result.state === "completed" && result.receipt?.publishStatus === "not_submitted" ? "not_submitted" : result.state === "blocked" ? "failed" : "unknown" };
      } },
      proofVerifier: { verifyOriginal: async ({ scope, operationId }) => {
        const result = await request(`/api/runtime/business-plan-executions/${operationId}`) as RuntimeResult;
        const facts = await this.facts(scope);
        const identityValid = result.identityMappingVerified === true && result.receipt?.observedIdentityKind === "facebook_page"
          && Boolean(result.receipt.observedIdentity && result.receipt.observedIdentityId && result.receipt.parentIdentity)
          && result.receipt.managementVerified === true && result.receipt.observedIdentityName === facts.pageName
          && result.receipt.publishStatus === "not_submitted";
        const expectedFingerprint = createHash("sha256").update(canonicalJson(scope)).digest("hex");
        const sameOperation = result.operationId === operationId && result.scopeFingerprint === expectedFingerprint && canonicalJson(result.scope) === canonicalJson(scope);
        const prepared = sameOperation && result.evidenceVerified === true && result.state === "completed"
          && result.receipt?.executionStatus === "completed" && result.receipt.evidenceRefs.length > 0 && identityValid;
        return { verificationEventId: randomUUID(), payloadDigest: createHash("sha256").update(JSON.stringify(result)).digest("hex"),
          decision: prepared ? "prepared" : result.state === "blocked" ? "unknown" : "unknown",
          resultId: prepared ? operationId : null, verifiedAt: prepared ? new Date().toISOString() : null };
      } },
      originalAttemptReconciler: { reconcileOriginalAttempt: async ({ scope, claimId, scopeFingerprint }) => {
        const jobs = await request("/api/runtime/business-plan-executions") as RuntimeResult[];
        const match = jobs.find(item => item.operationId && item.claimId === claimId && item.scopeFingerprint === scopeFingerprint);
        return match ? { outcome: "found" as const, operationId: match.operationId,
          observation: { sourceEventId: randomUUID(), payloadDigest: createHash("sha256").update(JSON.stringify(match)).digest("hex"),
            reportedState: match.state === "completed" ? "not_submitted" as const : match.state === "blocked" ? "failed" as const : "unknown" as const } } : { outcome: "not_found" as const };
      } },
    };
  }
}
