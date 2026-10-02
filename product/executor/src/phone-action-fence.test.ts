import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { controlProtocolVersion, type PhoneActionRequest } from "@socialgrowth/product-contracts";
import { PhoneActionFence, PhoneFenceError, type LocalPhoneGrant, type PhoneFenceAuthority, type PhoneFenceTransport } from "./phone-action-fence.js";

// Unit/component checks only: authority/probe and transport below are explicit
// synthetic fixtures. No device, screenshot, SDK or platform outcome is faked.
const rejected = (code: PhoneFenceError["code"]) => (e: unknown) => e instanceof PhoneFenceError && e.code === code && e.cause === undefined;
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "sg-fence-component-")), path = join(dir, "fence.sqlite");
  const deviceId = randomUUID(), serial = "component-device";
  let clock = Date.parse("2026-10-02T03:00:00Z"), starts = 0, rejectAuthority = false, receiptLost = false;
  const outcomes: { request: PhoneActionRequest; status: string }[] = [];
  const request: PhoneActionRequest = { protocolVersion: controlProtocolVersion, deviceId, holderId: randomUUID(),
    taskAttemptId: randomUUID(), authorizationId: randomUUID(), controlGeneration: "1", purpose: "business", kind: "read_screen", actionId: randomUUID() };
  const { actionId: _action, kind: _kind, ...identity } = request;
  const grant: LocalPhoneGrant = { ...identity, serial, leaseUntil: new Date(clock + 60_000).toISOString(), allowedKinds: ["read_screen", "navigate"] };
  const authority: PhoneFenceAuthority = {
    async verifyHolder() { if (rejectAuthority) throw new Error("fixture-private"); },
    async beginAction(r) { if (rejectAuthority) throw new Error("fixture-private"); return { ...r, serial, checkedAt: new Date(clock).toISOString(), validUntil: grant.leaseUntil, replayed: false }; },
    async recordActionOutcome(r, status) { outcomes.push({ request: r, status }); if (receiptLost) throw new Error("fixture-private"); },
    async inspectOriginalAction() { throw new Error("No original evidence in fixture"); },
    async inspectStopped(s) { return { deviceId, serial, stopRequestId: s.stopRequestId, controlGeneration: s.controlGeneration,
      evidenceId: randomUUID(), checkedAt: new Date(clock).toISOString(), allPathsFenced: true, controllerReleased: true, targetQuiescent: true }; },
  };
  let run: () => Promise<string> = async () => "component-ended";
  const transport: PhoneFenceTransport<string> = { start() { starts++; return run(); } };
  const make = () => new PhoneActionFence(path, deviceId, serial, authority, transport, () => clock);
  const fence = make();
  return { dir, path, deviceId, serial, request, grant, authority, transport, make, fence, outcomes,
    get starts() { return starts; }, advance(ms: number) { clock += ms; }, setRun(fn: () => Promise<string>) { run = fn; },
    rejectAuthority() { rejectAuthority = true; }, loseReceipt() { receiptLost = true; },
    async ready() { await fence.confirmStopped(); await fence.installHolder(grant); },
    async cleanup() { fence.close(); await rm(dir, { recursive: true, force: true }); } };
}

test("first contact is fenced; confirmation and holder installation start no transport", async () => {
  const f = await fixture();
  try {
    assert.equal(f.fence.snapshot().disposition, "stop_requested");
    await assert.rejects(f.fence.execute(f.request), rejected("DENIED"));
    await assert.rejects(f.fence.installHolder(f.grant), rejected("DENIED"));
    await f.ready();
    assert.equal(f.starts, 0);
    assert.equal(f.fence.snapshot().disposition, "enabled");
    assert.equal(await f.fence.execute(f.request), "component-ended");
    assert.equal(f.starts, 1);
    assert.deepEqual(f.outcomes, [{ request: f.request, status: "ended" }]);
    await assert.rejects(f.fence.execute(f.request), rejected("DENIED"));
    assert.equal(f.starts, 1);
  } finally { await f.cleanup(); }
});

test("two ledger connections share one in-flight slot; stop blocks reads without claiming quiescence", async () => {
  const f = await fixture(), other = f.make();
  try {
    await f.ready();
    let finish!: (value: string) => void;
    f.setRun(() => new Promise(resolve => { finish = resolve; }));
    const running = f.fence.execute(f.request);
    // execute yields at authority; wait until the transport has actually started.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.starts, 1);
    await assert.rejects(other.execute({ ...f.request, actionId: randomUUID() }), rejected("BUSY"));
    const stopped = other.requestStop(randomUUID());
    assert.equal(stopped.disposition, "stop_requested");
    assert.equal(stopped.grant?.holderId, f.request.holderId);
    await assert.rejects(other.execute({ ...f.request, actionId: randomUUID() }), rejected("DENIED"));
    await assert.rejects(other.confirmStopped(), rejected("DENIED"));
    f.advance(1); finish("component-ended"); await running;
    assert.equal(other.snapshot().disposition, "stop_requested");
    await other.confirmStopped();
    assert.equal(other.snapshot().disposition, "stopped");
    assert.equal(f.outcomes[0]?.request.controlGeneration, "1");
    assert.equal(f.starts, 1);
  } finally { other.close(); await f.cleanup(); }
});

test("pause arriving while central authorization waits prevents transport handoff", async () => {
  const f = await fixture(), other = f.make();
  try {
    await f.ready();
    const original = f.authority.beginAction;
    let resume!: () => void;
    f.authority.beginAction = async r => { await new Promise<void>(resolve => { resume = resolve; }); return original(r); };
    const waiting = f.fence.execute(f.request);
    other.requestStop(randomUUID()); resume();
    await assert.rejects(waiting, rejected("DENIED"));
    assert.equal(f.starts, 0);
  } finally { other.close(); await f.cleanup(); }
});

test("unknown transport outcome survives restart and is not cleared by stop, expiry or new holder", async () => {
  const f = await fixture();
  try {
    await f.ready(); f.setRun(async () => { throw new Error("fixture-private-output"); });
    await assert.rejects(f.fence.execute(f.request), rejected("UNKNOWN"));
    const restarted = f.make();
    try {
      await assert.rejects(restarted.execute({ ...f.request, actionId: randomUUID() }), rejected("BUSY"));
      restarted.requestStop(randomUUID()); f.advance(120_000);
      await assert.rejects(restarted.confirmStopped(), rejected("DENIED"));
      await assert.rejects(restarted.installHolder({ ...f.grant, holderId: randomUUID(), controlGeneration: "2" }), rejected("DENIED"));
      assert.equal(f.starts, 1);
      assert.equal(f.outcomes[0]?.status, "unknown");
    } finally { restarted.close(); }
  } finally { await f.cleanup(); }
});

test("lost receipt acknowledgement never repeats the physical action", async () => {
  const f = await fixture();
  try {
    await f.ready(); f.loseReceipt();
    await assert.rejects(f.fence.execute(f.request), rejected("UNKNOWN"));
    const restarted = f.make();
    try { await assert.rejects(restarted.execute(f.request), rejected("DENIED")); } finally { restarted.close(); }
    f.authority.recordActionOutcome = async (r, status) => { f.outcomes.push({ request: r, status }); };
    await f.fence.replayOriginalOutcome(f.request);
    assert.deepEqual(f.outcomes.map(o => o.status), ["ended", "ended"]);
    assert.equal(f.starts, 1);
  } finally { await f.cleanup(); }
});

test("scope, generation, forbidden kinds, extra fields, lease expiry and authority loss fail before transport", async () => {
  const f = await fixture();
  try {
    await f.ready();
    for (const patch of [{ deviceId: randomUUID() }, { holderId: randomUUID() }, { taskAttemptId: randomUUID() },
      { authorizationId: randomUUID() }, { controlGeneration: "2" }, { purpose: "operator_takeover" }, { kind: "submit_publication" }]) {
      await assert.rejects(f.fence.execute({ ...f.request, ...patch }), rejected("DENIED"));
    }
    await assert.rejects(f.fence.execute({ ...f.request, shell: "fixture-private" }), rejected("INVALID_BOUNDARY"));
    f.rejectAuthority();
    await assert.rejects(f.fence.execute(f.request), rejected("DENIED"));
    f.advance(60_000);
    await assert.rejects(f.fence.execute(f.request), rejected("DENIED"));
    assert.equal(f.starts, 0);
  } finally { await f.cleanup(); }
});

test("a stale or false stop probe and an old-generation holder cannot reopen the fence", async () => {
  const f = await fixture();
  try {
    const original = f.authority.inspectStopped;
    f.authority.inspectStopped = async s => ({ ...await original(s) as object, allPathsFenced: false });
    await assert.rejects(f.fence.confirmStopped(), rejected("DENIED"));
    f.authority.inspectStopped = async s => { const proof = await original(s); f.advance(10_000); return proof; };
    await assert.rejects(f.fence.confirmStopped(), rejected("DENIED"));
    f.authority.inspectStopped = original; await f.ready();
    const stopId = randomUUID(); f.fence.requestStop(stopId);
    const version = f.fence.snapshot().version;
    assert.equal(f.fence.requestStop(stopId).version, version);
    await f.fence.confirmStopped();
    await assert.rejects(f.fence.installHolder(f.grant), rejected("DENIED"));
    await assert.rejects(f.fence.installHolder({ ...f.grant, controlGeneration: "2" }), rejected("DENIED"));
    await f.fence.installHolder({ ...f.grant, holderId: randomUUID(), controlGeneration: "2" });
    assert.equal(f.starts, 0);
  } finally { await f.cleanup(); }
});

test("one physical serial cannot be rebound to another logical device in the same ledger", async () => {
  const f = await fixture();
  try {
    assert.throws(() => new PhoneActionFence(f.path, randomUUID(), f.serial, f.authority, f.transport), rejected("INVALID_BOUNDARY"));
    assert.throws(() => new PhoneActionFence(f.path, f.deviceId, "another-device", f.authority, f.transport), rejected("INVALID_BOUNDARY"));
  } finally { await f.cleanup(); }
});


test("original unknown can be reconciled only by matching recovery evidence; control stays revoked", async () => {
  const f = await fixture();
  try {
    await f.ready(); f.setRun(async () => { throw new Error("fixture-interrupted"); });
    await assert.rejects(f.fence.execute(f.request), rejected("UNKNOWN"));
    f.fence.requestStop(randomUUID());
    await assert.rejects(f.fence.reconcileOriginalAction(f.request), rejected("DENIED"));
    const proof = async (r: PhoneActionRequest, s: Parameters<PhoneFenceAuthority["inspectOriginalAction"]>[1]) => ({
      ...r, serial: f.serial, stopRequestId: s.stopRequestId, stopGeneration: s.controlGeneration,
      checkedAt: "2026-10-02T03:00:00.000Z", evidenceId: randomUUID(), status: "ended",
    });
    f.authority.inspectOriginalAction = async (r, s) => ({ ...await proof(r, s), actionId: randomUUID() });
    await assert.rejects(f.fence.reconcileOriginalAction(f.request), rejected("DENIED"));
    f.authority.inspectOriginalAction = async (r, s) => ({ ...await proof(r, s), stopGeneration: "1" });
    await assert.rejects(f.fence.reconcileOriginalAction(f.request), rejected("DENIED"));
    f.authority.inspectOriginalAction = proof;
    await f.fence.reconcileOriginalAction(f.request);
    assert.equal(f.fence.snapshot().disposition, "stop_requested");
    await f.fence.confirmStopped();
    assert.equal(f.fence.snapshot().disposition, "stopped");
    assert.equal(f.starts, 1);
    assert.deepEqual(f.outcomes.map(o => o.status), ["unknown", "ended"]);
    await assert.rejects(f.fence.execute(f.request), rejected("DENIED"));
  } finally { await f.cleanup(); }
});


test("independent OS workers share the local call fence and observe pause while a call is running", { timeout: 20_000 }, async () => {
  const f = await fixture();
  let child: ReturnType<typeof spawn> | undefined;
  try {
    await f.ready();
    const script = String.raw`import {PhoneActionFence,PhoneFenceError} from './src/phone-action-fence.ts';
      const f=JSON.parse(process.env.SG_FENCE_COMPONENT);
      const authority={verifyHolder:async()=>{},beginAction:async r=>({...r,serial:f.serial,checkedAt:'2026-10-02T03:00:00Z',validUntil:f.grant.leaseUntil,replayed:false}),
        recordActionOutcome:async()=>{},inspectStopped:async()=>{throw Error('not implemented');},inspectOriginalAction:async()=>{throw Error('not implemented');}};
      const transport={start(){process.stdout.write('started\n');return new Promise(resolve=>process.stdin.once('data',()=>resolve('ended')));}};
      const fence=new PhoneActionFence(f.path,f.deviceId,f.serial,authority,transport,()=>Date.parse('2026-10-02T03:00:00Z'));
      try{await fence.execute(f.request);process.stdout.write('ended\n');}
      catch(e){process.stdout.write((e instanceof PhoneFenceError?e.code:'UNEXPECTED')+'\n');}
      finally{fence.close();}`;
    const cwd = fileURLToPath(new URL("../", import.meta.url));
    const environment = (request: PhoneActionRequest) => ({ ...process.env, SG_FENCE_COMPONENT: JSON.stringify({ path: f.path, deviceId: f.deviceId, serial: f.serial, grant: f.grant, request }) });
    child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd, env: environment(f.request), stdio: ["pipe", "pipe", "pipe"] });
    const exited = new Promise<void>(resolve => child!.once("exit", () => resolve()));
    const lines = createInterface({ input: child.stdout! })[Symbol.asyncIterator]();
    assert.equal((await lines.next()).value, "started");
    const contender = await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script],
      { cwd, env: environment({ ...f.request, actionId: randomUUID() }), timeout: 5000 });
    assert.equal(contender.stdout.trim(), "BUSY");
    f.fence.requestStop(randomUUID());
    await assert.rejects(f.fence.confirmStopped(), rejected("DENIED"));
    child.stdin!.end("finish");
    assert.equal((await lines.next()).value, "ended");
    await lines.return?.(); await exited;
    assert.equal(f.fence.snapshot().disposition, "stop_requested");
    await f.fence.confirmStopped();
    assert.equal(f.fence.snapshot().disposition, "stopped");
  } finally { child?.kill(); await f.cleanup(); }
});

test("a probe taken before the last call ended cannot confirm stop", async () => {
  const f = await fixture();
  try {
    await f.ready();
    let finish!: (value: string) => void;
    f.setRun(() => new Promise(resolve => { finish = resolve; }));
    const running = f.fence.execute(f.request);
    await new Promise(resolve => setImmediate(resolve));
    f.fence.requestStop(randomUUID());
    const original = f.authority.inspectStopped;
    const old = await original(f.fence.snapshot());
    f.advance(1); finish("component-ended"); await running;
    f.authority.inspectStopped = async () => old;
    await assert.rejects(f.fence.confirmStopped(), rejected("DENIED"));
    f.authority.inspectStopped = original; await f.fence.confirmStopped();
    assert.equal(f.fence.snapshot().disposition, "stopped");
  } finally { await f.cleanup(); }
});


test("replayed central begin, future ticket, expired ticket and wrong physical serial never grant handoff", async () => {
  const f = await fixture();
  try {
    await f.ready(); const original = f.authority.beginAction;
    for (const patch of [{ replayed: true }, { checkedAt: "2026-10-02T03:00:00.001Z" },
      { validUntil: "2026-10-02T03:00:00Z" }, { serial: "another-physical-device" }]) {
      f.authority.beginAction = async r => ({ ...await original(r) as object, ...patch });
      await assert.rejects(f.fence.execute({ ...f.request, actionId: randomUUID() }), rejected("DENIED"));
    }
    assert.equal(f.starts, 0);
  } finally { await f.cleanup(); }
});
