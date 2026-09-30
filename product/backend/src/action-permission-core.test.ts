import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { controlProtocolVersion, type PhoneActionRequest } from "@socialgrowth/product-contracts";
import {
  ActionPermissionError, beginPhoneCall, checkActionPermission, confirmPhoneStopped, recordPhoneCallResult, requestPhoneStop,
  type ActionAuthorityFacts, type PhoneControlRecord,
} from "./action-permission-core.js";

const now = "2026-09-30T10:00:00Z";
const at = (seconds: number) => new Date(Date.parse(now) + seconds * 1000).toISOString();
function fixture() {
  const deviceId = randomUUID(), holderId = randomUUID(), authorizationId = randomUUID(), taskAttemptId = randomUUID();
  const generation = "9007199254740993";
  const facts: ActionAuthorityFacts = {
    deviceId, controlVersion: 0, controlGeneration: generation, providerIntent: "active", projectPublicationPaused: false,
    networkAdmitted: true, adbAuthorized: true, targetVerified: true,
    holder: { holderId, kind: "executor", controlGeneration: generation, purpose: "business", taskAttemptId, authorizationId, leaseUntil: at(60) },
    localConfirmation: { controlGeneration: generation, intent: "active", checkedAt: now },
    task: { taskAttemptId, authorizationId, operation: "publish", authorized: true, currentVersions: true, validUntil: at(60),
      allowedKinds: ["read_screen", "navigate", "write_input", "submit_publication", "remove_content", "sign_out"],
      submission: "intent_recorded", materialVerified: true, explicitRemovalAuthorized: false },
  };
  const request: PhoneActionRequest = { protocolVersion: controlProtocolVersion, deviceId, holderId, controlGeneration: generation,
    authorizationId, taskAttemptId, actionId: randomUUID(), purpose: "business", kind: "read_screen" };
  const record: PhoneControlRecord = { deviceId, version: 0, controlGeneration: generation, holderId, disposition: "enabled", stopRequestId: null, calls: [], stopEvidenceId: null };
  return { facts, request, record };
}
function denies(operation: () => unknown, code: ActionPermissionError["code"] = "ACTION_DENIED") {
  assert.throws(operation, (error: unknown) => error instanceof ActionPermissionError && error.code === code && error.cause === undefined);
}
function stopEvidence(record: PhoneControlRecord) {
  return { deviceId: record.deviceId, holderId: record.holderId, stopRequestId: record.stopRequestId!, controlGeneration: record.controlGeneration,
    evidenceId: "trusted-stop-probe", checkedAt: at(2), allPathsFenced: true, controllerReleased: true, targetQuiescent: true };
}

test("every action including screen reads checks distinct network, ADB, actual target, current grant and local intent", () => {
  const { facts, request } = fixture();
  assert.deepEqual(checkActionPermission(facts, request, now), request);
  for (const patch of [{ networkAdmitted: false }, { adbAuthorized: false }, { targetVerified: false }]) {
    denies(() => checkActionPermission({ ...facts, ...patch }, request, now));
  }
  for (const intent of ["pause_requested", "paused", "restore_pending", "exit_pending", "exited"]) {
    denies(() => checkActionPermission({ ...facts, providerIntent: intent }, request, now));
  }
  denies(() => checkActionPermission({ ...facts, localConfirmation: { ...facts.localConfirmation, intent: "paused" } }, request, now));
  for (const patch of [{ authorized: false }, { currentVersions: false }, { allowedKinds: ["navigate"] }, { validUntil: now }]) {
    denies(() => checkActionPermission({ ...facts, task: { ...facts.task, ...patch } }, request, now));
  }
});

test("device, holder, generation, purpose, attempt and grant are independently pinned without lossy generation comparison", () => {
  const { facts, request } = fixture();
  for (const patch of [{ deviceId: randomUUID() }, { holderId: randomUUID() }, { controlGeneration: "9007199254740992" },
    { authorizationId: randomUUID() }, { taskAttemptId: randomUUID() }, { purpose: "operator_takeover" }]) {
    denies(() => checkActionPermission(facts, { ...request, ...patch }, now), "AUTHORITY_CHANGED");
  }
  denies(() => checkActionPermission({ ...facts, holder: { ...facts.holder, controlGeneration: "1" } }, request, now), "AUTHORITY_CHANGED");
  denies(() => checkActionPermission(facts, { ...request, shell: "secret-marker" }, now), "INVALID_BOUNDARY");
  denies(() => checkActionPermission({ ...facts, clientAllowed: true }, request, now), "INVALID_BOUNDARY");
});

test("expired leases and stale, future or old-generation local confirmation fail closed", () => {
  const { facts, request } = fixture();
  denies(() => checkActionPermission({ ...facts, holder: { ...facts.holder, leaseUntil: now } }, request, now));
  for (const checkedAt of [at(-10), at(1)]) {
    denies(() => checkActionPermission({ ...facts, localConfirmation: { ...facts.localConfirmation, checkedAt } }, request, now));
  }
  denies(() => checkActionPermission({ ...facts, localConfirmation: { ...facts.localConfirmation, controlGeneration: "1" } }, request, now));
});

test("provider pause blocks reads and collections while project publication pause does not ban authorized history collection", () => {
  const { facts, request } = fixture();
  const pausedProject = { ...facts, projectPublicationPaused: true };
  denies(() => checkActionPermission(pausedProject, request, now));
  for (const operation of ["collect", "verify_result"] as const) {
    const collect = { ...pausedProject, task: { ...facts.task, operation, submission: "unknown" as const } };
    assert.equal(checkActionPermission(collect, request, now).kind, "read_screen");
    denies(() => checkActionPermission({ ...collect, providerIntent: "paused" }, request, now));
  }
});

test("recovery checks need explicit pending recovery, cannot publish and do not clear a newer pause or exit", () => {
  const { facts, request } = fixture();
  const recovery: ActionAuthorityFacts = { ...facts, providerIntent: "restore_pending",
    holder: { ...facts.holder, kind: "recovery", purpose: "recovery_check" },
    localConfirmation: { ...facts.localConfirmation, intent: "recovery_check" }, task: { ...facts.task, operation: "recovery_check" } };
  const read = { ...request, purpose: "recovery_check" as const };
  assert.equal(checkActionPermission(recovery, read, now).kind, "read_screen");
  for (const kind of ["write_input", "submit_publication", "remove_content", "sign_out"] as const) denies(() => checkActionPermission(recovery, { ...read, kind }, now));
  for (const providerIntent of ["paused", "pause_requested", "exit_pending", "exited"] as const) denies(() => checkActionPermission({ ...recovery, providerIntent }, read, now));
});

test("publication needs a recorded original intent and verified material, unknown outcome can only be checked", () => {
  const { facts, request } = fixture();
  const submit = { ...request, kind: "submit_publication" as const };
  assert.equal(checkActionPermission(facts, submit, now).kind, "submit_publication");
  for (const submission of ["none", "unknown", "confirmed_success", "confirmed_not_published"] as const) {
    denies(() => checkActionPermission({ ...facts, task: { ...facts.task, submission } }, submit, now));
  }
  denies(() => checkActionPermission({ ...facts, task: { ...facts.task, materialVerified: false } }, submit, now));
  const verify = { ...facts, task: { ...facts.task, operation: "verify_result" as const, submission: "unknown" as const } };
  assert.equal(checkActionPermission(verify, request, now).kind, "read_screen");
  denies(() => checkActionPermission(verify, { ...request, kind: "write_input" }, now));
});

test("removal, cleanup and operator control cannot borrow business or recovery purpose", () => {
  const { facts, request } = fixture();
  denies(() => checkActionPermission(facts, { ...request, kind: "remove_content" }, now));
  const removal = { ...facts, task: { ...facts.task, operation: "withdraw" as const, explicitRemovalAuthorized: true } };
  assert.equal(checkActionPermission(removal, { ...request, kind: "remove_content" }, now).kind, "remove_content");
  denies(() => checkActionPermission(facts, { ...request, kind: "sign_out" }, now));
  const cleanup: ActionAuthorityFacts = { ...facts, providerIntent: "exited",
    holder: { ...facts.holder, kind: "cleanup", purpose: "exit_cleanup" },
    localConfirmation: { ...facts.localConfirmation, intent: "exit_cleanup" }, task: { ...facts.task, operation: "exit_cleanup" } };
  assert.equal(checkActionPermission(cleanup, { ...request, purpose: "exit_cleanup", kind: "sign_out" }, now).kind, "sign_out");
  denies(() => checkActionPermission(cleanup, { ...request, purpose: "exit_cleanup", kind: "submit_publication" }, now));
  const operator: ActionAuthorityFacts = { ...facts, holder: { ...facts.holder, kind: "operator", purpose: "operator_takeover" }, task: { ...facts.task, operation: "operator_takeover" } };
  assert.equal(checkActionPermission(operator, { ...request, purpose: "operator_takeover" }, now).purpose, "operator_takeover");
  denies(() => checkActionPermission({ ...operator, providerIntent: "paused" }, { ...request, purpose: "operator_takeover" }, now));
});

test("single-phone reads and actions are mutually exclusive and an action ID cannot execute twice", () => {
  const f = fixture();
  const running = beginPhoneCall(f.record, f.facts, f.request, now);
  const currentFacts = { ...f.facts, controlVersion: running.version };
  denies(() => beginPhoneCall(running, currentFacts, { ...f.request, actionId: randomUUID() }, now), "BUSY");
  const ended = recordPhoneCallResult(running, { deviceId: f.record.deviceId, actionId: f.request.actionId, holderId: f.request.holderId,
    controlGeneration: f.request.controlGeneration, status: "ended" }, at(1));
  const nextFacts = { ...f.facts, controlVersion: ended.version };
  denies(() => beginPhoneCall(ended, nextFacts, f.request, at(1)), "AUTHORITY_CHANGED");
  assert.equal(beginPhoneCall(ended, nextFacts, { ...f.request, actionId: randomUUID() }, at(1)).calls.length, 2);
});

test("pause is accepted during an in-flight action and old control cannot start another read", () => {
  const f = fixture();
  const running = beginPhoneCall(f.record, f.facts, f.request, now);
  const stopped = requestPhoneStop(running, randomUUID());
  assert.equal(stopped.controlGeneration, "9007199254740994");
  assert.equal(stopped.disposition, "stop_requested");
  assert.equal(stopped.calls[0]?.status, "running");
  assert.equal(stopped.holderId, f.record.holderId);
  denies(() => beginPhoneCall(stopped, f.facts, f.request, now), "AUTHORITY_CHANGED");
  denies(() => confirmPhoneStopped(stopped, stopEvidence(stopped), at(2)), "STOP_UNCONFIRMED");
  assert.equal(requestPhoneStop(stopped, stopped.stopRequestId!), stopped);
});

test("late original call completion is historical only; fresh fencing and target stop are both required", () => {
  const f = fixture();
  const stopping = requestPhoneStop(beginPhoneCall(f.record, f.facts, f.request, now), randomUUID());
  const receipt = { deviceId: f.record.deviceId, actionId: f.request.actionId, holderId: f.request.holderId, controlGeneration: f.request.controlGeneration, status: "ended" as const };
  const ended = recordPhoneCallResult(stopping, receipt, at(1));
  assert.equal(ended.disposition, "stop_requested");
  for (const patch of [{ allPathsFenced: false }, { controllerReleased: false }, { targetQuiescent: false }, { checkedAt: at(-8) }]) {
    denies(() => confirmPhoneStopped(ended, { ...stopEvidence(ended), ...patch }, at(2)), "STOP_UNCONFIRMED");
  }
  const confirmed = confirmPhoneStopped(ended, stopEvidence(ended), at(2));
  assert.equal(confirmed.disposition, "stopped"); assert.equal(confirmed.holderId, null);
  assert.equal(recordPhoneCallResult(confirmed, receipt, at(3)), confirmed);
});

test("disconnect, unknown call result and stale receipt do not release phone exclusivity or imply stop", () => {
  const f = fixture();
  const running = beginPhoneCall(f.record, f.facts, f.request, now);
  const receipt = { deviceId: f.record.deviceId, actionId: f.request.actionId, holderId: f.request.holderId, controlGeneration: f.request.controlGeneration, status: "unknown" as const };
  const unknown = recordPhoneCallResult(running, receipt, at(1));
  denies(() => beginPhoneCall(unknown, { ...f.facts, controlVersion: unknown.version }, { ...f.request, actionId: randomUUID() }, at(1)), "BUSY");
  const stopping = requestPhoneStop(unknown, randomUUID());
  denies(() => confirmPhoneStopped(stopping, stopEvidence(stopping), at(2)), "STOP_UNCONFIRMED");
  denies(() => recordPhoneCallResult(stopping, { ...receipt, holderId: randomUUID() }, at(1)), "STALE_RECEIPT");
  denies(() => recordPhoneCallResult(stopping, { ...receipt, controlGeneration: stopping.controlGeneration }, at(1)), "STALE_RECEIPT");
});

test("new pause invalidates old stop proof and no lease expiry or browser disconnect method grants a new holder", () => {
  const f = fixture();
  const first = requestPhoneStop(f.record, randomUUID());
  const second = requestPhoneStop(first, randomUUID());
  denies(() => confirmPhoneStopped(second, stopEvidence(first), at(2)), "STALE_RECEIPT");
  assert.equal(second.holderId, first.holderId);
  const other = fixture();
  denies(() => confirmPhoneStopped(second, { ...stopEvidence(second), deviceId: other.record.deviceId }, at(2)), "STALE_RECEIPT");
  denies(() => beginPhoneCall({ ...f.record, version: Number.MAX_SAFE_INTEGER }, { ...f.facts, controlVersion: Number.MAX_SAFE_INTEGER }, f.request, now), "INVALID_BOUNDARY");
});

test("malformed stored control and untrusted stop or completion flags fail without leaking input", () => {
  const f = fixture();
  denies(() => requestPhoneStop({ ...f.record, controlGeneration: "secret-marker" }, randomUUID()), "INVALID_BOUNDARY");
  const running = beginPhoneCall(f.record, f.facts, f.request, now);
  const stopping = requestPhoneStop(running, randomUUID());
  denies(() => confirmPhoneStopped({ ...stopping, disposition: "stopped", holderId: null, stopEvidenceId: "old" }, stopEvidence(stopping), at(2)), "INVALID_BOUNDARY");
  const invalidFlag: unknown = { ...stopEvidence(stopping), allPathsFenced: "true" };
  // JSON-like external values may only enter after this same runtime boundary.
  denies(() => confirmPhoneStopped(stopping, invalidFlag as Parameters<typeof confirmPhoneStopped>[1], at(2)), "INVALID_BOUNDARY");
  const invalidReceipt: unknown = { deviceId: f.record.deviceId, actionId: f.request.actionId, holderId: f.request.holderId, controlGeneration: f.request.controlGeneration, status: "cancelled", secret: "marker" };
  denies(() => recordPhoneCallResult(stopping, invalidReceipt as Parameters<typeof recordPhoneCallResult>[1], at(1)), "INVALID_BOUNDARY");
});

test("cross-device completion cannot release a call even when holder, action and generation are reused", () => {
  const f = fixture(), deviceB = randomUUID();
  const first = beginPhoneCall(f.record, f.facts, f.request, now);
  const secondFacts = { ...f.facts, deviceId: deviceB };
  const second = beginPhoneCall({ ...f.record, deviceId: deviceB }, secondFacts, { ...f.request, deviceId: deviceB }, now);
  const receiptA = { deviceId: first.deviceId, actionId: f.request.actionId, holderId: f.request.holderId,
    controlGeneration: f.request.controlGeneration, status: "ended" as const };
  for (const status of ["ended", "unknown"] as const) {
    denies(() => recordPhoneCallResult(second, { ...receiptA, status }, at(1)), "STALE_RECEIPT");
  }
  const missingDevice: unknown = { actionId: f.request.actionId, holderId: f.request.holderId, controlGeneration: f.request.controlGeneration, status: "ended" };
  denies(() => recordPhoneCallResult(second, missingDevice as Parameters<typeof recordPhoneCallResult>[1], at(1)), "INVALID_BOUNDARY");
  denies(() => beginPhoneCall(second, { ...secondFacts, controlVersion: second.version }, { ...f.request, deviceId: deviceB, actionId: randomUUID() }, at(1)), "BUSY");
  assert.equal(second.calls[0]?.status, "running");
  assert.equal(recordPhoneCallResult(second, { ...receiptA, deviceId: deviceB }, at(1)).calls[0]?.status, "ended");
});
