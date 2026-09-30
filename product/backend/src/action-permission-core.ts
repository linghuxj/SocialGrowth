import { z } from "zod";
import {
  actionPurposeSchema, admissionGenerationSchema, compareTimestamps,
  phoneActionRequestSchema, timestampSchema, uuidSchema, type PhoneActionRequest,
} from "@socialgrowth/product-contracts";

export class ActionPermissionError extends Error {
  constructor(readonly code: "INVALID_BOUNDARY" | "AUTHORITY_CHANGED" | "ACTION_DENIED" | "BUSY" | "STOP_UNCONFIRMED" | "STALE_RECEIPT") {
    super(`Phone control rejected: ${code}`);
  }
}

// Internal authoritative facts, NEVER a client body. HTTP, persistent control
// arbitration and the Artemis/ADB wrappers are not wired in this stage.
const factsSchema = z.strictObject({
  deviceId: uuidSchema, controlVersion: z.int().min(0), controlGeneration: admissionGenerationSchema,
  providerIntent: z.enum(["active", "pause_requested", "paused", "restore_pending", "exit_pending", "exited"]),
  projectPublicationPaused: z.boolean(),
  networkAdmitted: z.boolean(), adbAuthorized: z.boolean(), targetVerified: z.boolean(),
  holder: z.strictObject({
    holderId: uuidSchema, kind: z.enum(["executor", "recovery", "operator", "cleanup"]),
    controlGeneration: admissionGenerationSchema, purpose: actionPurposeSchema,
    taskAttemptId: uuidSchema, authorizationId: uuidSchema, leaseUntil: timestampSchema,
  }),
  localConfirmation: z.strictObject({
    controlGeneration: admissionGenerationSchema,
    intent: z.enum(["active", "paused", "recovery_check", "exit_cleanup"]), checkedAt: timestampSchema,
  }),
  task: z.strictObject({
    taskAttemptId: uuidSchema, authorizationId: uuidSchema,
    operation: z.enum(["publish", "collect", "verify_result", "initialize", "withdraw", "recovery_check", "exit_cleanup", "operator_takeover"]),
    authorized: z.boolean(), currentVersions: z.boolean(), validUntil: timestampSchema,
    allowedKinds: z.array(z.enum(["read_screen", "navigate", "write_input", "submit_publication", "remove_content", "sign_out"])).min(1),
    submission: z.enum(["none", "intent_recorded", "unknown", "confirmed_success", "confirmed_not_published"]),
    materialVerified: z.boolean(), explicitRemovalAuthorized: z.boolean(),
  }),
});
export type ActionAuthorityFacts = z.infer<typeof factsSchema>;

function fail(code: ActionPermissionError["code"]): never { throw new ActionPermissionError(code); }
function before(left: string, right: string): boolean { return compareTimestamps(left, right) === -1; }
function fresh(value: string, now: string): boolean {
  try { return !before(now, value) && before(now, new Date(Date.parse(value) + 10_000).toISOString()); }
  catch { return false; }
}

export function checkActionPermission(input: unknown, requestInput: unknown, now: string): PhoneActionRequest {
  const parsedFacts = factsSchema.safeParse(input), parsedRequest = phoneActionRequestSchema.safeParse(requestInput);
  if (!parsedFacts.success || !parsedRequest.success || !timestampSchema.safeParse(now).success) fail("INVALID_BOUNDARY");
  const f = parsedFacts.data, r = parsedRequest.data;
  if (f.deviceId !== r.deviceId || f.controlGeneration !== r.controlGeneration
    || f.holder.holderId !== r.holderId || f.holder.controlGeneration !== r.controlGeneration
    || f.holder.purpose !== r.purpose || f.holder.taskAttemptId !== r.taskAttemptId || f.holder.authorizationId !== r.authorizationId
    || f.task.taskAttemptId !== r.taskAttemptId || f.task.authorizationId !== r.authorizationId) fail("AUTHORITY_CHANGED");
  if (!f.networkAdmitted || !f.adbAuthorized || !f.targetVerified || !f.task.authorized || !f.task.currentVersions
    || !before(now, f.holder.leaseUntil) || !before(now, f.task.validUntil) || !f.task.allowedKinds.includes(r.kind)
    || f.localConfirmation.controlGeneration !== r.controlGeneration || !fresh(f.localConfirmation.checkedAt, now)) fail("ACTION_DENIED");
  switch (r.purpose) {
    case "business":
      if (f.providerIntent !== "active" || f.localConfirmation.intent !== "active" || f.holder.kind !== "executor"
        || !["publish", "collect", "verify_result", "initialize", "withdraw"].includes(f.task.operation)) fail("ACTION_DENIED");
      if (f.task.operation === "publish" && (f.projectPublicationPaused || ["unknown", "confirmed_success"].includes(f.task.submission))) fail("ACTION_DENIED");
      break;
    case "recovery_check":
      if (f.providerIntent !== "restore_pending" || f.localConfirmation.intent !== "recovery_check" || f.holder.kind !== "recovery"
        || f.task.operation !== "recovery_check" || !["read_screen", "navigate"].includes(r.kind)) fail("ACTION_DENIED");
      break;
    case "exit_cleanup":
      if (!["exit_pending", "exited"].includes(f.providerIntent) || f.localConfirmation.intent !== "exit_cleanup"
        || f.holder.kind !== "cleanup" || f.task.operation !== "exit_cleanup" || !["read_screen", "navigate", "sign_out"].includes(r.kind)) fail("ACTION_DENIED");
      break;
    case "operator_takeover":
      if (f.providerIntent !== "active" || f.localConfirmation.intent !== "active" || f.holder.kind !== "operator"
        || f.task.operation !== "operator_takeover") fail("ACTION_DENIED");
      break;
  }
  if (f.task.operation === "verify_result" && !["read_screen", "navigate"].includes(r.kind)) fail("ACTION_DENIED");
  // Even an allowed UI kind cannot expand the current task's approved purpose.
  if (r.kind === "submit_publication" && (r.purpose !== "business" || f.task.operation !== "publish"
    || f.task.submission !== "intent_recorded" || !f.task.materialVerified || f.projectPublicationPaused)) fail("ACTION_DENIED");
  if (r.kind === "remove_content" && (r.purpose !== "business" || f.task.operation !== "withdraw" || !f.task.explicitRemovalAuthorized)) fail("ACTION_DENIED");
  if (r.kind === "sign_out" && r.purpose !== "exit_cleanup") fail("ACTION_DENIED");
  return r;
}

export interface PhoneCall {
  actionId: string; holderId: string; controlGeneration: string;
  startedAt: string; endedAt: string | null; status: "running" | "ended" | "unknown";
}
export interface PhoneControlRecord {
  deviceId: string; version: number; controlGeneration: string; holderId: string | null;
  disposition: "enabled" | "stop_requested" | "stopped";
  stopRequestId: string | null; calls: readonly PhoneCall[]; stopEvidenceId: string | null;
}

const callSchema = z.strictObject({
  actionId: uuidSchema, holderId: uuidSchema, controlGeneration: admissionGenerationSchema,
  startedAt: timestampSchema, endedAt: timestampSchema.nullable(), status: z.enum(["running", "ended", "unknown"]),
});
const controlRecordSchema = z.strictObject({
  deviceId: uuidSchema, version: z.int().min(0), controlGeneration: admissionGenerationSchema,
  holderId: uuidSchema.nullable(), disposition: z.enum(["enabled", "stop_requested", "stopped"]),
  stopRequestId: uuidSchema.nullable(), calls: z.array(callSchema), stopEvidenceId: z.string().min(1).max(128).nullable(),
});
function validateRecord(record: PhoneControlRecord): void {
  const parsed = controlRecordSchema.safeParse(record);
  if (!parsed.success || new Set(record.calls.map(call => call.actionId)).size !== record.calls.length
    || (record.disposition === "enabled" && !record.holderId)
    || (record.disposition !== "enabled" && !record.stopRequestId)
    || (record.disposition === "stopped" && (record.holderId !== null || !record.stopEvidenceId))
    || (record.disposition === "stopped" && record.calls.some(call => call.status !== "ended"))
    || (record.disposition === "stop_requested" && record.stopEvidenceId !== null)
    || record.calls.some(call => (call.status === "ended") !== (call.endedAt !== null)
      || (call.endedAt !== null && before(call.endedAt, call.startedAt)))) fail("INVALID_BOUNDARY");
}

// Persisted JSON is untrusted too. Never propagate Zod issues containing input.
export function parsePhoneControlRecord(input: unknown): PhoneControlRecord {
  const parsed = controlRecordSchema.safeParse(input);
  if (!parsed.success) fail("INVALID_BOUNDARY");
  validateRecord(parsed.data);
  return parsed.data;
}

function nextVersion(record: PhoneControlRecord): number {
  if (!Number.isSafeInteger(record.version) || record.version < 0 || record.version >= Number.MAX_SAFE_INTEGER) fail("INVALID_BOUNDARY");
  return record.version + 1;
}

export function beginPhoneCall(record: PhoneControlRecord, facts: ActionAuthorityFacts, request: PhoneActionRequest, now: string): PhoneControlRecord {
  validateRecord(record);
  const r = checkActionPermission(facts, request, now);
  if (record.version !== facts.controlVersion || record.controlGeneration !== facts.controlGeneration
    || record.deviceId !== facts.deviceId || record.holderId !== facts.holder.holderId) fail("AUTHORITY_CHANGED");
  if (record.disposition !== "enabled") fail("ACTION_DENIED");
  if (record.calls.some(call => call.status !== "ended")) fail("BUSY");
  if (record.calls.some(call => call.actionId === r.actionId)) fail("AUTHORITY_CHANGED");
  // Persistent caller must lock/CAS and commit this BEFORE the actual ADB read
  // or action. This pure function alone does not close the physical start race.
  return { ...record, version: nextVersion(record), calls: [...record.calls, {
    actionId: r.actionId, holderId: r.holderId, controlGeneration: r.controlGeneration,
    startedAt: now, endedAt: null, status: "running",
  }] };
}

export function requestPhoneStop(record: PhoneControlRecord, requestId: string): PhoneControlRecord {
  validateRecord(record);
  if (!uuidSchema.safeParse(requestId).success || !admissionGenerationSchema.safeParse(record.controlGeneration).success) fail("INVALID_BOUNDARY");
  if (record.stopRequestId === requestId) return record;
  const generation = BigInt(record.controlGeneration) + 1n;
  if (!admissionGenerationSchema.safeParse(generation.toString()).success) fail("INVALID_BOUNDARY");
  // Accept even while a call is running. Keep holder/calls; never infer that
  // cancelled, disconnected or lease-expired means the phone is now stopped.
  return { ...record, version: nextVersion(record), controlGeneration: generation.toString(),
    disposition: "stop_requested", stopRequestId: requestId, stopEvidenceId: null };
}

export function recordPhoneCallResult(record: PhoneControlRecord, receipt: {
  deviceId: string; actionId: string; holderId: string; controlGeneration: string; status: "ended" | "unknown";
}, now: string): PhoneControlRecord {
  validateRecord(record);
  if (!z.strictObject({ deviceId: uuidSchema, actionId: uuidSchema, holderId: uuidSchema, controlGeneration: admissionGenerationSchema,
    status: z.enum(["ended", "unknown"]), }).safeParse(receipt).success) fail("INVALID_BOUNDARY");
  if (!timestampSchema.safeParse(now).success) fail("INVALID_BOUNDARY");
  // Identity must be captured by the trusted adapter at dispatch, never filled
  // in from the receiving route. A holder/action tuple alone is not device scope.
  if (receipt.deviceId !== record.deviceId) fail("STALE_RECEIPT");
  const call = record.calls.find(item => item.actionId === receipt.actionId);
  if (!call || call.holderId !== receipt.holderId || call.controlGeneration !== receipt.controlGeneration
    || before(now, call.startedAt)) fail("STALE_RECEIPT");
  if (call.status === "ended") return record;
  return { ...record, version: nextVersion(record), calls: record.calls.map(item => item !== call ? item : {
    ...item, status: receipt.status, endedAt: receipt.status === "ended" ? now : null,
  }) };
}

export function confirmPhoneStopped(record: PhoneControlRecord, evidence: {
  deviceId: string; holderId: string | null; stopRequestId: string; controlGeneration: string;
  evidenceId: string; checkedAt: string; allPathsFenced: boolean; controllerReleased: boolean; targetQuiescent: boolean;
}, now: string): PhoneControlRecord {
  validateRecord(record);
  if (!z.strictObject({ deviceId: uuidSchema, holderId: uuidSchema.nullable(), stopRequestId: uuidSchema,
    controlGeneration: admissionGenerationSchema, evidenceId: z.string().min(1).max(128), checkedAt: timestampSchema,
    allPathsFenced: z.boolean(), controllerReleased: z.boolean(), targetQuiescent: z.boolean(),
  }).safeParse(evidence).success) fail("INVALID_BOUNDARY");
  if (!timestampSchema.safeParse(now).success || !timestampSchema.safeParse(evidence.checkedAt).success) fail("INVALID_BOUNDARY");
  if (record.disposition !== "stop_requested" || evidence.deviceId !== record.deviceId || evidence.holderId !== record.holderId
    || evidence.stopRequestId !== record.stopRequestId || evidence.controlGeneration !== record.controlGeneration) fail("STALE_RECEIPT");
  if (!evidence.evidenceId || !evidence.allPathsFenced || !evidence.controllerReleased || !evidence.targetQuiescent
    || !fresh(evidence.checkedAt, now) || record.calls.some(call => call.status !== "ended"
      || (call.endedAt !== null && before(evidence.checkedAt, call.endedAt)))) fail("STOP_UNCONFIRMED");
  return { ...record, version: nextVersion(record), disposition: "stopped", holderId: null, stopEvidenceId: evidence.evidenceId };
}
