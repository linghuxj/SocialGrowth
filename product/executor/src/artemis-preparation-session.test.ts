import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { executionLibraryVersion, artemisPreparationAssignmentSchema, type ArtemisPreparationAssignment, type ArtemisPreparationJournal } from "@socialgrowth/product-contracts";
import { ArtemisPreparationSession } from "./artemis-preparation-session.js";
function assignment(): ArtemisPreparationAssignment { return artemisPreparationAssignmentSchema.parse({ taskId: randomUUID(), taskVersion: 0, taskAttemptId: randomUUID(), serial: "SYNTHETIC_NOT_A_DEVICE", operationId: "inspect_app",
  input: { protocolVersion: executionLibraryVersion, projectId: randomUUID(), deviceId: randomUUID(), accountId: randomUUID(), mode: "check_only",
    target: { platform: "facebook", name: "Synthetic Page", expectedId: null, category: null, description: "" }, requestedScope: { scopeRef: "synthetic-scope", allowTrustedInstall: false, allowIdentityCreation: false },
    facts: { version: 1, currentScopeMatches: true, unresolvedDeviceTask: false, boundIdentityId: null, priorCreation: "none", app: { state: "unknown", evidenceRef: null }, login: { state: "unknown", evidenceRef: null }, identity: { state: "unknown", observedId: null, observedName: null, kind: null, managementVerified: false, evidenceRef: null } } } }); }
function fixture() {
  const a = assignment(), trace = randomUUID(), calls: { name: string; args: Record<string, unknown> }[] = [];
  let claimed = false, bound: string | null = null, failLaunch = false, denied = false, guardCalls = 0, status: unknown = { trace_id: trace, device_serial: a.serial, status: "running" };
  const journal: ArtemisPreparationJournal = { claim: async () => { if (claimed) return { state: "existing", traceId: bound }; claimed = true; return { state: "new" }; },
    read: async () => claimed ? { traceId: bound } : null, bindTrace: async (_attempt, _fp, value) => { bound = value; }, record: async () => {} };
  const guard = { requireCurrentFencedPreparation: async () => { guardCalls++; if (denied) throw new Error("denied"); } };
  const tools = { call: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); if (name === "mobile_run_task") { if (failLaunch) throw new Error("private-provider-error"); return { trace_id: trace, device_serial: a.serial }; } return status; } };
  const session = new ArtemisPreparationSession(tools, guard, journal);
  return { a, trace, calls, session, journal, tools, guard, guards: () => guardCalls,
    fail: () => { failLaunch = true; }, deny: () => { denied = true; }, status: (v: unknown) => { status = v; } };
}
test("default runtime and invalid next operation cannot call any Artemis tool", async () => {
  const f = fixture(); await assert.rejects(new ArtemisPreparationSession().start(f.a), /NOT_CONNECTED/);
  await assert.rejects(f.session.start({ ...f.a, operationId: "create_facebook_page" })); assert.equal(f.calls.length, 0);
});
test("one original attempt performs one scoped autonomous launch after two guard checks", async () => {
  const f = fixture(), first = await f.session.start(f.a); assert.equal(first.state, "running"); assert.equal(f.guards(), 2);
  assert.equal(f.calls[0]!.args.device_serial, f.a.serial); assert.equal(f.calls[0]!.args.locked_app_package, "com.facebook.katana");
  assert.match(String(f.calls[0]!.args.task_desc), /Stop after this one operation/);
  await f.session.start(f.a); assert.equal(f.calls.filter(c => c.name === "mobile_run_task").length, 1);
});
test("lost launch acknowledgement is unknown and another start cannot relaunch", async () => {
  const f = fixture(); f.fail(); const first = await f.session.start(f.a); assert.equal(first.state, "launch_unknown");
  assert.equal((await f.session.start(f.a)).state, "launch_unknown"); assert.equal(f.calls.length, 1);
});
test("guard denial after committed intent does not launch or reset the original attempt", async () => {
  const f = fixture(); let count = 0;
  const session = new ArtemisPreparationSession(f.tools, { requireCurrentFencedPreparation: async () => { if (++count > 1) throw new Error("scope-changed"); } }, f.journal);
  await assert.rejects(session.start(f.a)); assert.equal(f.calls.length, 0);
  assert.equal((await f.session.start(f.a)).state, "launch_unknown"); assert.equal(f.calls.length, 0);
});
test("forged trace is rejected; permission loss requests stop and remains unconfirmed", async () => {
  const f = fixture(); await f.session.start(f.a); await assert.rejects(f.session.poll(f.a, randomUUID()), /NOT_BOUND/); assert.equal(f.calls.length, 1);
  f.deny(); const result = await f.session.poll(f.a, f.trace); assert.equal(result.state, "stop_unconfirmed"); assert.equal(f.calls[1]!.args.action, "stop");
});
test("completed reports need scoped evidence and never establish verified identity or permission", async () => {
  const f = fixture(); await f.session.start(f.a);
  const report = { taskAttemptId: f.a.taskAttemptId, operationId: "inspect_app", status: "reported", evidenceIds: [randomUUID()], noPublication: true };
  f.status({ trace_id: f.trace, device_serial: f.a.serial, status: "completed", result: report });
  const result = await f.session.poll(f.a, f.trace); assert.equal(result.state, "reported"); assert.equal(result.identityVerified, false); assert.equal(result.publicationAllowed, false);
  f.status({ trace_id: f.trace, device_serial: f.a.serial, status: "completed", result: { ...report, operationId: "create_facebook_page" } });
  assert.equal((await f.session.poll(f.a, f.trace)).state, "result_unknown");
});
