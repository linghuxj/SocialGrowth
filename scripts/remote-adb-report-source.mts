import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseDiagnosticReport } from "./remote-adb-diagnostic-state.mts";

export async function diagnosticConnectPort(expected: { tailnetIp: string; nodeId?: string; deviceId: string }, now = Date.now()): Promise<number | null> {
  try {
    const path = resolve(".runtime/product-local-live/endpoint-report.json"), stat = await lstat(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 && stat.size <= 8192);
    const value = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    assert.equal(value.evidenceScope, "authenticated_diagnostic_not_formal_admission");
    assert.equal(value.sourceTailnetIp, expected.tailnetIp); assert.equal(value.deviceId, expected.deviceId);
    if (expected.nodeId) assert.equal(value.sourceNodeId, expected.nodeId);
    assert.equal(value.formalAdmission, false); assert.equal(value.actionPermissionGranted, false);
    const report = parseDiagnosticReport(value.report);
    assert.equal(value.epoch, report.epoch); assert.equal(value.sequence, report.sequence);
    const received = Date.parse(String(value.receivedAt)), observed = Date.parse(report.observedAt);
    assert.ok(received <= now && received > now - 10_000 && observed <= now + 2000 && observed > now - 10_000);
    return report.connect.status === "candidate" ? report.connect.port : null;
  } catch { return null; }
}
