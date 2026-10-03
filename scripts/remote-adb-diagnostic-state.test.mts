import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DiagnosticEndpointState, DiagnosticObservationExpired, parseDiagnosticReport } from "./remote-adb-diagnostic-state.mts";
test("endpoint reports reject replay, stale epochs, incomplete snapshots and ambiguous ports", () => {
  const s = new DiagnosticEndpointState(), now = Date.now();
  const r = { protocolVersion: "remote-adb-diagnostic-v1", epoch: s.begin(randomUUID()), reportId: randomUUID(), sequence: 1,
    observedAt: new Date(now).toISOString(), connect: { status: "candidate", port: 38299 }, pairing: { status: "unknown", port: null } };
  const receipt = s.accept(r, now);
  assert.equal(s.snapshot(now + 9999).fresh, true);
  assert.deepEqual(s.accept(r, now + 11000), receipt);
  assert.equal(s.snapshot(now + 11000).fresh, false);
  assert.throws(() => s.accept({ ...r, connect: { status: "candidate", port: 39000 } }, now));
  assert.throws(() => s.accept({ ...r, reportId: randomUUID() }, now));
  for (const connect of [{ status: "conflict", port: 38299 }, { status: "candidate", port: null }])
    assert.throws(() => parseDiagnosticReport({ ...r, connect }));
  assert.throws(() => parseDiagnosticReport({ ...r, sourceIp: "100.118.89.89" }));
  s.begin(randomUUID()); assert.equal(s.snapshot().report, null);
  assert.throws(() => s.accept({ ...r, sequence: 2, reportId: randomUUID() }, now));
});
test("delayed observations can be replaced without refreshing duplicate receipts or accepting future evidence", () => {
  const s = new DiagnosticEndpointState(), now = Date.now(), epoch = s.begin(randomUUID());
  const r = { protocolVersion: "remote-adb-diagnostic-v1", epoch, reportId: randomUUID(), sequence: 1,
    observedAt: new Date(now).toISOString(), connect: { status: "candidate", port: 38299 }, pairing: { status: "unknown", port: null } };
  const receipt = s.accept(r, now);
  assert.deepEqual(s.accept(r, now + 20_000), receipt);
  assert.equal(s.snapshot(now + 20_000).fresh, false);
  assert.throws(() => s.accept({ ...r, sequence: 2, reportId: randomUUID() }, now + 20_000), DiagnosticObservationExpired);
  assert.equal(s.snapshot(now + 20_000).sequence, 1);
  const next = { ...r, sequence: 3, reportId: randomUUID(), observedAt: new Date(now + 20_000).toISOString() };
  s.accept(next, now + 20_000);
  assert.equal(s.snapshot(now + 20_000).fresh, true);
  assert.throws(() => s.accept({ ...next, sequence: 4, reportId: randomUUID(), observedAt: new Date(now + 23_000).toISOString() }, now + 20_000));
  assert.throws(() => s.accept({ ...r, epoch: randomUUID(), sequence: 5, reportId: randomUUID() }, now + 20_000), e => !(e instanceof DiagnosticObservationExpired));
});
test("loss and recovery replace full snapshots, pairing port never becomes connect port", () => {
  const s = new DiagnosticEndpointState(), now = Date.now(), epoch = s.begin(randomUUID());
  const base = { protocolVersion: "remote-adb-diagnostic-v1", epoch, observedAt: new Date(now).toISOString() };
  s.accept({ ...base, reportId: randomUUID(), sequence: 1, connect: { status: "lost", port: null }, pairing: { status: "candidate", port: 39111 } }, now);
  assert.equal(s.snapshot(now).report?.connect.port, null);
  s.accept({ ...base, reportId: randomUUID(), sequence: 2, connect: { status: "candidate", port: 40123 }, pairing: { status: "unknown", port: null } }, now);
  assert.equal(s.snapshot(now).report?.connect.port, 40123);
  assert.equal(s.snapshot(now).report?.pairing.port, null);
  assert.equal(s.snapshot(now).actionPermissionGranted, false);
});
