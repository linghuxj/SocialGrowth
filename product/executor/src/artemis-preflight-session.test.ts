import assert from "node:assert/strict";
import { test } from "node:test";
import { taskProtocolVersion } from "@socialgrowth/product-contracts";
import { ArtemisPreflightSession, ArtemisPreflightError, type ArtemisPreflightJournal, type ArtemisPreflightAssignment, type PreflightObservation } from "./artemis-preflight-session.js";
const id = (n: number) => `${n.toString().padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, sha = "a".repeat(64), trace = id(15);
const fixture = (): ArtemisPreflightAssignment => ({ serial: "SYNTHETIC_TEST_SERIAL", platformIdentity: "synthetic-page-identity", task: {
  protocolVersion: taskProtocolVersion, kind: "publish_content", taskId: id(1), taskRevision: 1, projectId: id(2), taskAttemptId: id(3), deviceId: id(4), identityId: id(5),
  platform: "facebook", form: "facebook_video", arrangementRevision: 1, projectVersion: 1, assignmentId: id(6), assignmentVersion: 1, approvalId: id(7), approvalVersion: 1,
  contentUnitId: id(8), variantId: id(9), materialRevision: 1, languageTag: "es", objects: [{ objectId: id(10), sha256: sha, bytes: 3, contentType: "video/mp4" }],
  title: "synthetic title", caption: "synthetic caption", scheduledAt: "2026-10-02T00:00:00Z", window: { startsAt: "2026-10-02T00:00:00Z", endsAt: "2026-10-03T00:00:00Z" },
  recovery: { roundId: id(11), maxAttempts: 2, maxElapsedMs: 300000 } }, media: [{ objectId: id(10), sha256: sha, path: `/sdcard/Movies/SocialGrowth/${sha}.mp4` }] });
// Synthetic journal proves orchestration ONLY, not PG persistence/current
// permissions, physical action fencing or actual Artemis/mobile acceptance.
function journal() {
  let saved: { hash: string; traceId: string | null } | null = null;
  const observations: PreflightObservation[] = [];
  const port: ArtemisPreflightJournal = {
    async claim(_a, hash) { if (!saved) { saved = { hash, traceId: null }; return { state: "new" }; } assert.equal(saved.hash, hash); return { state: "existing", traceId: saved.traceId }; },
    async read(_a, hash) { if (!saved) return null; assert.equal(saved.hash, hash); return { traceId: saved.traceId }; },
    async bindTrace(_id, hash, value) { assert.equal(saved?.hash, hash); saved!.traceId = value; },
    async record(_id, hash, o) { assert.equal(saved?.hash, hash); observations.push(structuredClone(o)); },
  }; return { port, observations };
}
const report = () => ({ taskAttemptId: id(3), observedIdentity: "synthetic-page-identity", identityKind: "facebook_page", stage: "ready_before_submit", finalSubmitClicked: false, publicationState: "not_submitted", evidenceIds: [id(16)] });
test("absent ports and invalid prepared files cannot issue any Artemis RPC", async () => {
  await assert.rejects(new ArtemisPreflightSession().start(fixture()), e => e instanceof ArtemisPreflightError && e.code === "ARTEMIS_CONFIGURATION_REQUIRED");
  let calls = 0; const j = journal(), s = new ArtemisPreflightSession({ async call() { calls++; return {}; } }, { async requireCurrentFencedPreflight() {} }, j.port);
  await assert.rejects(s.start({ ...fixture(), media: [{ ...fixture().media[0], path: "/sdcard/Movies/newest.mp4" }] }), ArtemisPreflightError); assert.equal(calls, 0);
});
test("committed launch intent is followed by a fresh guard; Pro receives exact serial/file and forbids final submission", async () => {
  const j = journal(), order: string[] = [], s = new ArtemisPreflightSession({ async call(name, args) { order.push(name); assert.equal(name, "mobile_run_task");
    assert.equal(args.device_serial, fixture().serial); assert.equal(args.model, "Pro"); assert.equal(args.verification_level, "strict"); assert.equal(args.locked_app_package, "com.facebook.katana");
    assert.match(String(args.task_desc), /visual recognition and autonomous decisions/); assert.match(String(args.task_desc), /NEVER Publish/); assert.ok(String(args.task_desc).includes(fixture().media[0]!.path));
    return { trace_id: trace, device_serial: fixture().serial, status: "running" }; } }, { async requireCurrentFencedPreflight() { order.push("guard"); } }, {
      ...j.port, async claim(a, h) { order.push("durable-intent"); return j.port.claim(a, h); } });
  assert.equal((await s.start(fixture())).state, "running"); assert.deepEqual(order, ["guard", "durable-intent", "guard", "mobile_run_task"]);
  assert.equal((await s.start(fixture())).traceId, trace); assert.equal(order.filter(v => v === "mobile_run_task").length, 1);
});
test("lost launch acknowledgement never relaunches the same original attempt", async () => {
  const j = journal(); let calls = 0; const s = new ArtemisPreflightSession({ async call() { calls++; throw new Error("synthetic-secret-rpc"); } }, { async requireCurrentFencedPreflight() {} }, j.port);
  assert.equal((await s.start(fixture())).state, "launch_unknown"); assert.equal((await s.start(fixture())).state, "launch_unknown"); assert.equal(calls, 1);
  assert.ok(!JSON.stringify(j.observations).includes("synthetic-secret"));
});
test("concurrent duplicate start claims issue exactly one autonomous launch", async () => {
  const j = journal(); let calls = 0; const s = new ArtemisPreflightSession({ async call() { calls++; return { trace_id: trace, device_serial: fixture().serial }; } }, { async requireCurrentFencedPreflight() {} }, j.port);
  const values = await Promise.all([s.start(fixture()), s.start(fixture())]); assert.equal(calls, 1); assert.ok(values.some(v => v.state === "running"));
  assert.equal((await s.start(fixture())).traceId, trace); assert.equal(calls, 1);
});
test("permission withdrawn after committed intent cannot launch and cannot be reset by another start", async () => {
  const j = journal(); let checks = 0, calls = 0;
  const s = new ArtemisPreflightSession({ async call() { calls++; return {}; } }, { async requireCurrentFencedPreflight() { if (++checks === 2) throw new Error("synthetic-revoked-after-intent"); } }, j.port);
  await assert.rejects(s.start(fixture()), ArtemisPreflightError); assert.equal((await s.start(fixture())).state, "launch_unknown"); assert.equal(calls, 0);
});
test("lost trace-binding acknowledgement is unknown now, but later original reconciliation only polls its bound trace", async () => {
  const j = journal(); let calls = 0; const s = new ArtemisPreflightSession({ async call(name) { calls++; return name === "mobile_run_task" ? { trace_id: trace, device_serial: fixture().serial } : { trace_id: trace, device_serial: fixture().serial, status: "running" }; } }, { async requireCurrentFencedPreflight() {} }, {
    ...j.port, async bindTrace(a, h, t) { await j.port.bindTrace(a, h, t); throw new Error("synthetic-bind-ack-loss"); } });
  assert.equal((await s.start(fixture())).state, "launch_unknown"); assert.equal((await s.start(fixture())).traceId, trace); assert.equal((await s.poll(fixture(), trace)).state, "running"); assert.equal(calls, 2);
});
test("reported ready needs actual corroboration; engine completed never becomes published or verified", async () => {
  const j = journal(), s = new ArtemisPreflightSession({ async call(name) { return name === "mobile_run_task" ? { trace_id: trace, device_serial: fixture().serial } : { trace_id: trace, device_serial: fixture().serial, status: "completed", result: JSON.stringify(report()) }; } }, { async requireCurrentFencedPreflight() {} }, j.port);
  await s.start(fixture()); const value = await s.poll(fixture(), trace); assert.equal(value.state, "reported_ready"); assert.equal(value.publicationState, "unverified"); assert.equal(value.publicationAllowed, false);
});
test("a forged caller trace cannot read/stop another task or create a new launch intent", async () => {
  const j = journal(); let calls = 0; const s = new ArtemisPreflightSession({ async call() { calls++; return { trace_id: trace, device_serial: fixture().serial }; } }, { async requireCurrentFencedPreflight() {} }, j.port);
  await assert.rejects(s.poll(fixture(), trace), ArtemisPreflightError); assert.equal(calls, 0); await s.start(fixture());
  await assert.rejects(s.poll(fixture(), id(17)), ArtemisPreflightError); assert.equal(calls, 1);
});
test("current permission loss requests stop but never pretends actions stopped or publication did not occur", async () => {
  const j = journal(), actions: unknown[] = []; let denied = false;
  const s = new ArtemisPreflightSession({ async call(name, args) { actions.push(args.action ?? name); return name === "mobile_run_task" ? { trace_id: trace, device_serial: fixture().serial } : { status: "cancelled" }; } }, { async requireCurrentFencedPreflight() { if (denied) throw new Error("synthetic-revoked"); } }, j.port);
  await s.start(fixture()); denied = true; const result = await s.poll(fixture(), trace); assert.equal(result.state, "stop_unconfirmed"); assert.equal(result.publicationState, "unverified"); assert.deepEqual(actions, ["mobile_run_task", "stop"]);
});
test("identity mismatch, submitted/forged/missing evidence, wrong serial and invalid result remain human/unknown", async () => {
  for (const result of [{ ...report(), observedIdentity: "other-page" }, { ...report(), identityKind: "youtube_channel" }, { ...report(), finalSubmitClicked: true },
    { ...report(), evidenceIds: [] }, { ...report(), taskAttemptId: id(18) }, { ...report(), evidenceIds: [id(16), id(16)] }, "not-json"]) {
    const j = journal(), s = new ArtemisPreflightSession({ async call(name) { return name === "mobile_run_task" ? { trace_id: trace, device_serial: fixture().serial } : { trace_id: trace, device_serial: fixture().serial, status: "completed", result }; } }, { async requireCurrentFencedPreflight() {} }, j.port);
    await s.start(fixture()); const o = await s.poll(fixture(), trace); assert.ok(["needs_human", "result_unknown"].includes(o.state)); assert.equal(o.publicationAllowed, false);
  }
  const j = journal(), s = new ArtemisPreflightSession({ async call() { return { trace_id: trace, device_serial: "other-serial" }; } }, { async requireCurrentFencedPreflight() {} }, j.port);
  assert.equal((await s.start(fixture())).state, "launch_unknown");
});
