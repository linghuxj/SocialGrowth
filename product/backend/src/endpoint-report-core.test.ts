import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import test from "node:test";
import {
  acceptEndpointReport, beginEndpointSourceEpoch, createEndpointReportState,
  EndpointReportError, endpointReportSigningBytes, parseEndpointReportState,
  readEndpointCandidates, type EndpointAuthority, type EndpointReport, type EndpointReportState,
} from "./endpoint-report-core.js";

const now = "2026-09-30T12:00:00Z";
const later = "2026-09-30T12:00:01Z";
const newest = "2026-09-30T12:00:02Z";
const clone = <T>(v: T): T => structuredClone(v);
function rejects(fn: () => unknown, code: EndpointReportError["code"]) {
  assert.throws(fn, (e: unknown) => e instanceof EndpointReportError && e.code === code && e.message === code);
}
function fixture() {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const authority: EndpointAuthority = {
    scope: { enrollmentId: randomUUID(), deviceId: randomUUID(), installationId: randomUUID(),
      installationGeneration: "9007199254740993", enrollmentGeneration: "1", ownershipVersion: "0",
      node: { nodeId: "node-fixture", nodeKey: "key-fixture", networkRevision: 1 } },
    mayReport: true, publicKeySpki: keys.publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
    pairingSessionId: randomUUID(), pairingExpiresAt: newest,
  };
  const initial = createEndpointReportState(authority), epochId = randomUUID();
  const state = beginEndpointSourceEpoch(initial, authority, 0, epochId, now);
  const report = (patch: Partial<EndpointReport> = {}): EndpointReport => ({
    protocol: "2026-09-30.endpoint-v1", reportId: randomUUID(), scope: clone(authority.scope),
    sourceEpoch: epochId, sequence: "1", endpoints: [
      { purpose: "connect", status: "candidate", port: 37000, pairingSessionId: null },
      { purpose: "pairing", status: "unknown", port: null, pairingSessionId: null },
    ], observedAt: now, reason: "initial_discovery", ...patch,
  });
  const signed = (r: EndpointReport) => ({ report: r, signature: sign("sha256", endpointReportSigningBytes(r), { key: keys.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url") });
  const accept = (s: EndpointReportState, r: EndpointReport, t = now, a = authority) => acceptEndpointReport(s, a, signed(r), t);
  return { keys, authority, initial, state, epochId, report, signed, accept };
}

test("initial/epoch/report projections remain independent unverified purpose snapshots, no grants", () => {
  const f = fixture(), before = clone(f.state), r = f.report(), original = clone(r);
  assert.equal(f.initial.endpointRevision, 0); assert.equal(f.state.endpointRevision, 1);
  assert.ok(readEndpointCandidates(f.state, f.authority, now, 1000).every(e => e.status === "unknown"));
  const result = f.accept(f.state, r);
  assert.equal(result.disposition, "accepted"); assert.equal(result.state.endpointRevision, 2);
  assert.deepEqual(result.state.endpoints, r.endpoints);
  assert.deepEqual(Object.keys(result), ["state", "disposition", "receipt"]);
  assert.deepEqual(f.state, before); assert.deepEqual(r, original);
  assert.equal(result.receipt.receivedAt, now);
});

test("signing canonicalizes UUID/copy/property order/purpose order but retains timestamp spelling", () => {
  const f = fixture(), r = f.report();
  const reversed = { ...r, reportId: r.reportId.toUpperCase(), sourceEpoch: r.sourceEpoch.toUpperCase(),
    scope: { ...r.scope, installationId: r.scope.installationId.toUpperCase() }, endpoints: [...r.endpoints].reverse() };
  assert.deepEqual(endpointReportSigningBytes(r), endpointReportSigningBytes(reversed));
  assert.notDeepEqual(endpointReportSigningBytes(r), endpointReportSigningBytes({ ...r, observedAt: "2026-09-30T12:00:00.000Z" }));
  assert.match(endpointReportSigningBytes(r).toString(), /^socialgrowth-endpoint-report\n/);
  assert.equal(f.accept(f.state, reversed).state.lastReportId, r.reportId);
});

test("actual P256 proof rejects altered signed port/time/domain, wrong key and noncanonical signature", () => {
  const f = fixture(), r = f.report(), proof = f.signed(r);
  for (const changed of [{ ...r, observedAt: later }, { ...r, endpoints: [{ ...r.endpoints[0]!, port: 37001 }, r.endpoints[1]!] }]) {
    rejects(() => acceptEndpointReport(f.state, f.authority, { ...proof, report: changed }, now), "INVALID_PROOF");
  }
  const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const different = sign("sha256", endpointReportSigningBytes(r), { key: other.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  rejects(() => acceptEndpointReport(f.state, f.authority, { report: r, signature: different }, now), "INVALID_PROOF");
  const domain = sign("sha256", Buffer.from(endpointReportSigningBytes(r).toString().replace("socialgrowth-endpoint-report", "network_node_binding")), { key: f.keys.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  rejects(() => acceptEndpointReport(f.state, f.authority, { report: r, signature: domain }, now), "INVALID_PROOF");
  rejects(() => acceptEndpointReport(f.state, f.authority, { report: r, signature: `${proof.signature}=` }, now), "INPUT_INVALID");
});

test("strict complete snapshot refuses duplicates/missing/extra fields, unsafe ports and fake pairing scope", () => {
  const f = fixture(), r = f.report();
  const invalid: unknown[] = [
    { ...r, address: "192.0.2.1" }, { ...r, sequence: "01" }, { ...r, sequence: 1 },
    { ...r, endpoints: [r.endpoints[0]] }, { ...r, endpoints: [r.endpoints[0], r.endpoints[0]] },
    ...[0, 65536, 1.5, null].map(port => ({ ...r, endpoints: [{ ...r.endpoints[0], port }, r.endpoints[1]] })),
    { ...r, endpoints: [{ ...r.endpoints[0], status: "withdrawn" }, r.endpoints[1]] },
    { ...r, endpoints: [{ ...r.endpoints[0], pairingSessionId: randomUUID() }, r.endpoints[1]] },
    { ...r, endpoints: [r.endpoints[0], { ...r.endpoints[1], status: "candidate", port: 39000 }] },
  ];
  for (const input of invalid) rejects(() => endpointReportSigningBytes(input), "INPUT_INVALID");
  rejects(() => acceptEndpointReport(f.state, f.authority, { ...f.signed(r), authorization: "yes" }, now), "INPUT_INVALID");
});

test("current authority binds installation/ownership/enrollment/node/key and cannot be replaced by claims", () => {
  const f = fixture(), r = f.report();
  const changed: EndpointAuthority[] = [
    { ...f.authority, mayReport: false }, { ...f.authority, publicKeySpki: fixture().authority.publicKeySpki },
    ...["deviceId", "installationId", "enrollmentId"].map(field => ({ ...f.authority, scope: { ...f.authority.scope, [field]: randomUUID() } })),
    ...["ownershipVersion", "installationGeneration", "enrollmentGeneration"].map(field => ({ ...f.authority, scope: { ...f.authority.scope, [field]: "2" } })),
    { ...f.authority, scope: { ...f.authority.scope, node: { ...f.authority.scope.node, networkRevision: 2 } } },
  ];
  for (const a of changed) {
    rejects(() => f.accept(f.state, r, now, a), "AUTHORITY_CHANGED");
    rejects(() => readEndpointCandidates(f.state, a, now, 1000), "AUTHORITY_CHANGED");
  }
  rejects(() => f.accept(f.state, { ...r, scope: { ...r.scope, installationId: randomUUID() } }), "AUTHORITY_CHANGED");
  rejects(() => createEndpointReportState({ ...f.authority, mayReport: false }), "AUTHORITY_CHANGED");
});

test("sequence uses decimal BigInt, rejects lower/equal IDs but recovers exact lost receipt", () => {
  const f = fixture(), r = f.report({ sequence: "9007199254740993" }), first = f.accept(f.state, r);
  for (const sequence of ["9007199254740992", "9007199254740993"]) rejects(() => f.accept(first.state, f.report({ sequence }), later), "STALE_SEQUENCE");
  const recovered = f.accept(first.state, r, later);
  assert.equal(recovered.disposition, "duplicate"); assert.deepEqual(recovered.receipt, first.receipt);
  assert.equal(recovered.state.lastReceivedAt, now); assert.equal(recovered.state.receipts.length, 1);
  const next = f.accept(first.state, f.report({ sequence: "9007199254740994" }), later);
  assert.equal(next.state.sequence, "9007199254740994");
  rejects(() => f.accept(next.state, { ...r, reason: "changed" }, newest), "REPORT_ID_REUSED");
});

test("old report ID returns latest state/original receipt without resurrecting port or refreshing age", () => {
  const f = fixture(), r = f.report(), first = f.accept(f.state, r);
  const loss = f.report({ sequence: "2", observedAt: later, endpoints: first.state.endpoints.map(e => ({ ...e, status: "withdrawn", port: null, pairingSessionId: null })), reason: "service_lost" });
  const second = f.accept(first.state, loss, later), retry = f.accept(second.state, r, newest);
  assert.equal(retry.disposition, "duplicate"); assert.deepEqual(retry.state, second.state);
  assert.deepEqual(retry.receipt, first.receipt); assert.equal(retry.state.sequence, "2");
  assert.ok(readEndpointCandidates(retry.state, f.authority, newest, 1000).every(e => e.status === "unknown"));
});

test("cached heartbeat advances report sequence but cannot refresh actual observation age", () => {
  const f = fixture(), first = f.accept(f.state, f.report());
  const second = f.accept(first.state, f.report({ sequence: "2" }), later);
  assert.equal(second.state.endpointRevision, first.state.endpointRevision);
  assert.equal(second.state.lastReceivedAt, later);
  assert.equal(second.state.lastObservationReceivedAt, now);
  assert.equal(readEndpointCandidates(second.state, f.authority, later, 1000)[0]!.status, "unknown");
  rejects(() => f.accept(second.state, f.report({ sequence: "3", observedAt: "2026-09-29T12:00:00Z" }), newest), "STALE_OBSERVATION");
  rejects(() => f.accept(second.state, f.report({ sequence: "3", endpoints: [{ ...f.report().endpoints[0]!, port: 37001 }, f.report().endpoints[1]!] }), newest), "STALE_OBSERVATION");
  const renewed = f.accept(second.state, f.report({ sequence: "3", observedAt: later }), later);
  assert.equal(renewed.state.lastObservationReceivedAt, later);
  assert.equal(readEndpointCandidates(renewed.state, f.authority, "2026-09-30T12:00:01.999999999Z", 1000)[0]!.status, "candidate");
  assert.equal(readEndpointCandidates(second.state, f.authority, newest, 1000)[0]!.status, "unknown");
});

test("new source epoch invalidates before discovery, retires old signed reports and cannot revive old ID", () => {
  const f = fixture(), r = f.report(), accepted = f.accept(f.state, r), nextEpoch = randomUUID();
  const restarted = beginEndpointSourceEpoch(accepted.state, f.authority, accepted.state.endpointRevision, nextEpoch, later);
  assert.equal(restarted.sequence, null); assert.equal(restarted.endpointRevision, 3);
  assert.ok(restarted.endpoints.every(e => e.port === null));
  rejects(() => f.accept(restarted, r, newest), "STALE_EPOCH");
  rejects(() => beginEndpointSourceEpoch(restarted, f.authority, 3, f.epochId, newest), "STALE_EPOCH");
  rejects(() => beginEndpointSourceEpoch(restarted, f.authority, 1, randomUUID(), newest), "STALE_VERSION");
  assert.deepEqual(beginEndpointSourceEpoch(restarted, f.authority, 0, nextEpoch, newest), restarted);
  const next = f.accept(restarted, f.report({ sourceEpoch: nextEpoch }), newest);
  assert.equal(next.state.sequence, "1"); assert.equal(next.state.endpointRevision, 4);
});

test("pairing candidate binds exact current session/expiry and never poisons connect candidate", () => {
  const f = fixture(), r = f.report();
  r.endpoints[1] = { purpose: "pairing", status: "candidate", port: 39000, pairingSessionId: f.authority.pairingSessionId };
  const result = f.accept(f.state, r, later);
  assert.equal(result.state.endpoints[1]!.port, 39000);
  rejects(() => f.accept(f.state, r, newest), "PAIRING_SESSION_STALE");
  rejects(() => f.accept(f.state, r, later, { ...f.authority, pairingSessionId: randomUUID() }), "PAIRING_SESSION_STALE");
  assert.deepEqual(f.accept(result.state, r, newest).receipt, result.receipt);
  const candidates = readEndpointCandidates(result.state, f.authority, newest, 5000);
  assert.equal(candidates[0]!.port, 37000); assert.equal(candidates[1]!.port, null);
  assert.equal(readEndpointCandidates(result.state, { ...f.authority, pairingSessionId: null, pairingExpiresAt: null }, later, 5000)[1]!.status, "unknown");
});

test("receipt TTL preserves arbitrary fractions/offsets/year 0099 and left-closed right-open boundary", () => {
  const f = fixture(), instant = "0099-01-01T00:00:00.000000001Z";
  const initial = createEndpointReportState(f.authority), epoch = beginEndpointSourceEpoch(initial, f.authority, 0, f.epochId, instant);
  const result = f.accept(epoch, f.report(), instant);
  for (const t of ["0099-01-01T00:00:00.001Z", "0099-01-01T01:00:00.001+01:00", instant]) {
    assert.equal(readEndpointCandidates(result.state, f.authority, t, 1)[0]!.status, "candidate");
  }
  assert.equal(readEndpointCandidates(result.state, f.authority, "0099-01-01T00:00:00.001000001Z", 1)[0]!.status, "unknown");
  assert.equal(readEndpointCandidates(result.state, f.authority, "0099-01-01T00:00:00.001000002Z", 1)[0]!.status, "unknown");
});

test("regressing center clock is rejected at submillisecond precision for reads/reports/epoch rotation", () => {
  const f = fixture(), result = f.accept(f.state, f.report(), "2026-09-30T12:00:00.000000002Z");
  const before = "2026-09-30T12:00:00.000000001Z";
  rejects(() => readEndpointCandidates(result.state, f.authority, before, 1000), "CLOCK_ORDER");
  rejects(() => f.accept(result.state, f.report({ sequence: "2" }), before), "CLOCK_ORDER");
  rejects(() => beginEndpointSourceEpoch(result.state, f.authority, 2, randomUUID(), before), "CLOCK_ORDER");
});

test("state hydration reconstructs actual signed snapshots, revisions, ordered epochs and receipts", () => {
  const f = fixture(), first = f.accept(f.state, f.report()), second = f.accept(first.state, f.report({ sequence: "2" }), later);
  const final = beginEndpointSourceEpoch(second.state, f.authority, 2, randomUUID(), newest);
  const mutations: ((s: EndpointReportState) => void)[] = [
    s => { s.endpoints[0]!.port = 37001; s.endpoints[0]!.status = "candidate"; },
    s => { s.endpointRevision++; }, s => { s.epochs[1]!.endpointRevision++; },
    s => { s.epochs[1]!.generation = "1"; }, s => { s.epochs[1]!.startedAt = now; },
    s => { s.sequence = "2"; }, s => { s.lastReportId = randomUUID(); },
    s => { s.receipts[0]!.payloadDigest = "a".repeat(64); },
    s => { s.receipts[0]!.endpointRevision++; }, s => { s.receipts[0]!.reportId = randomUUID(); },
    s => { s.receipts[0]!.signed.signature = "A".repeat(86); },
    s => { s.receipts[0]!.signed.report.endpoints[0]!.port = 37001; },
    s => { s.receipts.reverse(); }, s => { s.receipts.push(clone(s.receipts[0]!)); },
    s => { s.receipts[0]!.sourceEpoch = s.epochs[1]!.epochId; },
  ];
  for (const mutate of mutations) { const changed = clone(final); mutate(changed); rejects(() => parseEndpointReportState(changed), "CORRUPT_STATE"); }
  assert.deepEqual(parseEndpointReportState(final), final);
  const corrupt = clone(first.state); corrupt.endpoints[0]!.port = 37001;
  rejects(() => parseEndpointReportState(corrupt), "CORRUPT_STATE");
});

test("key validation refuses DER trailing data/other curves, returns safe error without raw key", () => {
  const f = fixture(), raw = Buffer.from(f.authority.publicKeySpki, "base64url");
  const bad = Buffer.concat([raw, Buffer.from([0])]).toString("base64url");
  rejects(() => createEndpointReportState({ ...f.authority, publicKeySpki: bad }), "INVALID_PROOF");
  const other = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
  rejects(() => createEndpointReportState({ ...f.authority, publicKeySpki: other.publicKey.export({ type: "spki", format: "der" }).toString("base64url") }), "INVALID_PROOF");
  const state = clone(f.state); state.publicKeySpki = bad;
  rejects(() => parseEndpointReportState(state), "CORRUPT_STATE");
});

test("copied returns and strict policies reject attempts to mutate prior accepted state", () => {
  const f = fixture(), first = f.accept(f.state, f.report()), saved = clone(first.state);
  const projection = readEndpointCandidates(first.state, f.authority, now, 1000);
  projection[0]!.port = 37001; assert.deepEqual(first.state, saved);
  for (const age of [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity]) rejects(() => readEndpointCandidates(first.state, f.authority, now, age), "INPUT_INVALID");
  for (const revision of [-1, 0.5, Infinity]) rejects(() => beginEndpointSourceEpoch(first.state, f.authority, revision, randomUUID(), later), "INPUT_INVALID");
  rejects(() => createEndpointReportState({ ...f.authority, expectedPermission: true }), "AUTHORITY_CHANGED");
  assert.equal(createHash("sha256").update(endpointReportSigningBytes(first.receipt.signed.report)).digest("hex"), first.receipt.payloadDigest);
});
