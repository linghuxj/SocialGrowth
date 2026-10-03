import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

export interface EndpointObservation { status: "candidate" | "unknown" | "lost" | "conflict" | "stopped"; port: number | null }
export interface DiagnosticReport {
  protocolVersion: "remote-adb-diagnostic-v1";
  epoch: string; reportId: string; sequence: number; observedAt: string;
  connect: EndpointObservation; pairing: EndpointObservation;
}
export interface DiagnosticReceipt { epoch: string; reportId: string; sequence: number; acceptedAt: string }
/** A delayed observation is unusable, but does not invalidate installation auth. */
export class DiagnosticObservationExpired extends Error {
  constructor() { super("DIAGNOSTIC_OBSERVATION_EXPIRED"); this.name = "DiagnosticObservationExpired"; }
}
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
function object(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[]) {
  assert.deepEqual(Object.keys(value).sort(), expected.sort());
}
function observation(value: unknown): EndpointObservation {
  const v = object(value); keys(v, ["status", "port"]);
  assert.ok(["candidate", "unknown", "lost", "conflict", "stopped"].includes(String(v.status)));
  assert.ok(v.status === "candidate" ? Number.isInteger(v.port) && Number(v.port) >= 1024 && Number(v.port) <= 65535 : v.port === null);
  return { status: v.status as EndpointObservation["status"], port: v.port as number | null };
}
export function parseDiagnosticReport(value: unknown): DiagnosticReport {
  const v = object(value); keys(v, ["protocolVersion", "epoch", "reportId", "sequence", "observedAt", "connect", "pairing"]);
  assert.equal(v.protocolVersion, "remote-adb-diagnostic-v1");
  assert.ok(typeof v.epoch === "string" && uuid.test(v.epoch));
  assert.ok(typeof v.reportId === "string" && uuid.test(v.reportId));
  assert.ok(Number.isSafeInteger(v.sequence) && Number(v.sequence) > 0);
  assert.ok(typeof v.observedAt === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v.observedAt) && Number.isFinite(Date.parse(v.observedAt)));
  return { protocolVersion: "remote-adb-diagnostic-v1", epoch: v.epoch, reportId: v.reportId,
    sequence: Number(v.sequence), observedAt: v.observedAt, connect: observation(v.connect), pairing: observation(v.pairing) };
}

/** Temporary connectivity diagnostics only. Never creates formal admission or grants. */
export class DiagnosticEndpointState {
  private epochs = new Map<string, string>();
  private currentEpoch: string | null = null;
  private sequence = 0;
  private receipts = new Map<string, { digest: string; receipt: DiagnosticReceipt }>();
  private latest: { report: DiagnosticReport; receivedAt: number } | null = null;
  begin(requestId: string) {
    assert.match(requestId, uuid);
    const old = this.epochs.get(requestId);
    if (old) { assert.equal(old, this.currentEpoch); return old; }
    assert.ok(this.epochs.size < 32);
    const epoch = randomUUID(); this.epochs.set(requestId, epoch);
    this.currentEpoch = epoch; this.sequence = 0; this.latest = null; this.receipts.clear();
    return epoch;
  }
  accept(raw: unknown, now = Date.now()): DiagnosticReceipt {
    const report = parseDiagnosticReport(raw);
    assert.equal(report.epoch, this.currentEpoch);
    const digest = createHash("sha256").update(JSON.stringify(report)).digest("hex");
    const old = this.receipts.get(report.reportId);
    if (old) { assert.equal(old.digest, digest); return old.receipt; } // Lost ACK never refreshes freshness.
    assert.ok(report.sequence > this.sequence);
    const observed = Date.parse(report.observedAt);
    assert.ok(observed <= now + 2_000); // Future clock evidence remains a scope rejection.
    if (observed < now - 10_000) throw new DiagnosticObservationExpired();
    assert.ok(!this.latest || observed >= Date.parse(this.latest.report.observedAt));
    const receipt = { epoch: report.epoch, reportId: report.reportId, sequence: report.sequence, acceptedAt: new Date(now).toISOString() };
    this.sequence = report.sequence; this.latest = { report, receivedAt: now };
    this.receipts.set(report.reportId, { digest, receipt });
    if (this.receipts.size > 64) this.receipts.delete(this.receipts.keys().next().value!);
    return receipt;
  }
  snapshot(now = Date.now()) {
    const latest = this.latest;
    const fresh = !!latest && now >= latest.receivedAt && now - latest.receivedAt < 10_000 && now - Date.parse(latest.report.observedAt) < 10_000;
    return { protocolVersion: "remote-adb-diagnostic-v1", epoch: this.currentEpoch, sequence: this.sequence,
      fresh, report: latest?.report ?? null, receivedAt: latest ? new Date(latest.receivedAt).toISOString() : null,
      formalAdmission: false, actionPermissionGranted: false };
  }
}
