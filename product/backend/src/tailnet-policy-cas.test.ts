import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash as createSha256 } from "node:crypto";
import test from "node:test";
import { buildRestrictedProposal } from "./tailnet-restricted-proposal.js";
import { createTailnetPolicyCas, readTailnetPolicyWriteConfiguration, type TailnetPolicySnapshot } from "./tailnet-policy-cas.js";

const configDocument = { tailnet: "-", clientId: "fixture-client", clientSecret: "fixture-secret-value-1234567890" };
const original = JSON.stringify({ grants: [{ src: ["*"], dst: ["*"], ip: ["*"] }] });
const scope = { pendingAddresses: ["100.100.0.2"], verifierAddresses: ["100.100.0.1"], preservedAddresses: ["100.100.0.1"], verifierPort: 9443 };
const hash = (text: string) => createSha256("sha256").update(text).digest("hex");
async function readFixtureConfiguration(directory: string) {
  const path = join(directory, "write.json"); await writeFile(path, JSON.stringify(configDocument), { mode: 0o600 });
  return readTailnetPolicyWriteConfiguration(path);
}
const snapshot = (text: string, etag: string): TailnetPolicySnapshot => ({ text, etag, sha256: hash(text) });
const grantedScopes = "policy_file devices:core:read devices:posture_attributes";
const token = () => Response.json({ access_token: "fixture-access-token-1234567890", token_type: "Bearer", expires_in: 3600, scope: grantedScopes });
const proposal = buildRestrictedProposal(original, scope);

function fixture(options: { staleBeforeWrite?: boolean; writeStatus?: number; loseWriteAck?: boolean; badReadback?: boolean } = {}) {
  let current = snapshot(original, '"before"'), writes = 0, validateCount = 0, conflict = options.staleBeforeWrite ?? false;
  const calls: { path: string; method: string; headers: Headers; body: string }[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? "GET", headers = new Headers(init?.headers), body = String(init?.body ?? "");
    calls.push({ path: url.pathname, method, headers, body });
    if (url.pathname.endsWith("/oauth/token")) {
      assert.equal(method, "POST");
      const form = new URLSearchParams(body); assert.equal(form.get("scope"), grantedScopes);
      return token();
    }
    if (url.pathname.endsWith("/acl/validate")) { validateCount++; assert.equal(method, "POST"); return Response.json({}); }
    if (url.pathname.endsWith("/acl") && method === "GET") {
      if (conflict && writes === 0 && calls.filter(v => v.path.endsWith("/acl") && v.method === "GET").length > 1) current = snapshot(original, '"concurrent"');
      return new Response(current.text, { headers: { etag: current.etag } });
    }
    if (url.pathname.endsWith("/acl") && method === "POST") {
      if (options.writeStatus !== undefined) return new Response("", { status: options.writeStatus });
      if (headers.get("If-Match") !== current.etag) return new Response("", { status: 412 });
      writes++;
      if (body === original) current = snapshot(body, '"restored"');
      else current = snapshot(options.badReadback ? original : body, '"after"');
      if (options.loseWriteAck) throw new Error("fixture network error after server apply");
      return new Response(body, { headers: { etag: current.etag } });
    }
    throw new Error(`unexpected ${method} ${url.pathname}`);
  };
  return { request, calls, current: () => current, writes: () => writes, validates: () => validateCount };
}

test("write configuration is separate, private, and missing config fails closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sg-tailnet-cas-")), path = join(dir, "write.json");
  try {
    await assert.rejects(readTailnetPolicyWriteConfiguration(path), { code: "CONFIGURATION_UNAVAILABLE" });
    assert.throws(() => createTailnetPolicyCas(configDocument), { code: "CONFIGURATION_UNAVAILABLE" });
    await writeFile(path, JSON.stringify(configDocument), { mode: 0o600 });
    assert.deepEqual(await readTailnetPolicyWriteConfiguration(path), configDocument);
    assert.equal((await stat(path)).mode & 0o077, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("read-only policy credentials cannot open a write session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sg-tailnet-cas-")), configuration = await readFixtureConfiguration(dir);
  let calls = 0;
  try {
    const readonly: typeof fetch = async () => { calls++; return Response.json({ access_token: "fixture-access-token-1234567890",
      token_type: "Bearer", expires_in: 3600, scope: "policy_file:read devices:core:read devices:posture_attributes:read" }); };
    await assert.rejects(createTailnetPolicyCas(configuration, readonly).readCurrent(), { code: "OAUTH_UNAVAILABLE" });
    assert.equal(calls, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("policy apply recomputes the narrow candidate, validates it, saves recovery, uses If-Match and reads back", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sg-tailnet-cas-")), f = fixture(), configuration = await readFixtureConfiguration(dir);
  try {
    const result = await createTailnetPolicyCas(configuration, f.request).applyReviewedProposal({ expectedCurrentEtag: '"before"',
      expectedCurrentSha256: hash(original), reviewedCandidateSha256: proposal.summary.candidateSha256, recoveryFile: join(dir, "recovery.json"), scope });
    assert.equal(result.status, "applied_and_read_back"); assert.equal(result.candidateSha256, proposal.summary.candidateSha256);
    assert.equal(result.isolationVerified, false); assert.equal(result.networkAdmissionGranted, false); assert.equal(result.actionPermissionGranted, false);
    const write = f.calls.find(v => v.method === "POST" && v.path.endsWith("/acl"));
    assert.equal(write?.headers.get("If-Match"), '"before"'); assert.equal(write?.body, proposal.text);
    assert.equal(f.validates(), 1); assert.equal((await stat(join(dir, "recovery.json"))).mode & 0o077, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("stale current ETag and changed reviewed proposal stop before policy mutation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sg-tailnet-cas-")), stale = fixture({ staleBeforeWrite: true }), mismatched = fixture(), configuration = await readFixtureConfiguration(dir);
  try {
    const cas = createTailnetPolicyCas(configuration, stale.request);
    await assert.rejects(cas.applyReviewedProposal({ expectedCurrentEtag: '"before"', expectedCurrentSha256: hash(original),
      reviewedCandidateSha256: proposal.summary.candidateSha256, recoveryFile: join(dir, "stale.json"), scope }), { code: "CURRENT_POLICY_STALE" });
    assert.equal(stale.writes(), 0);
    await assert.rejects(createTailnetPolicyCas(configuration, mismatched.request).applyReviewedProposal({ expectedCurrentEtag: '"before"',
      expectedCurrentSha256: hash(original), reviewedCandidateSha256: "0".repeat(64), recoveryFile: join(dir, "mismatch.json"), scope }),
      { code: "REVIEWED_CANDIDATE_MISMATCH" });
    assert.equal(mismatched.writes(), 0); assert.equal(mismatched.validates(), 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("HTTP ETag conflict and post-write mismatch never become an applied result", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sg-tailnet-cas-")), configuration = await readFixtureConfiguration(dir), conflict = fixture({ writeStatus: 412 }), mismatch = fixture({ badReadback: true });
  try {
    const input = { expectedCurrentEtag: '"before"', expectedCurrentSha256: hash(original), reviewedCandidateSha256: proposal.summary.candidateSha256, scope };
    await assert.rejects(createTailnetPolicyCas(configuration, conflict.request).applyReviewedProposal({ ...input, recoveryFile: join(dir, "conflict.json") }), { code: "CURRENT_POLICY_STALE" });
    assert.equal(conflict.calls.find(v => v.method === "POST" && v.path.endsWith("/acl"))?.headers.get("If-Match"), '"before"');
    assert.equal(conflict.writes(), 0);
    await assert.rejects(createTailnetPolicyCas(configuration, mismatch.request).applyReviewedProposal({ ...input, recoveryFile: join(dir, "mismatch-readback.json") }),
      { code: "POLICY_READBACK_MISMATCH" });
    assert.equal(mismatch.writes(), 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("policy test failure, broad/unsupported policy, and missing private recovery path never write", async () => {
  const f = fixture(), directory = await mkdtemp(join(tmpdir(), "sg-tailnet-cas-")), configuration = await readFixtureConfiguration(directory);
  try {
    const failValidation: typeof fetch = async (input, init) => String(input).endsWith("/acl/validate") ? Response.json({ errors: ["failed"] }) : f.request(input, init);
    await assert.rejects(createTailnetPolicyCas(configuration, failValidation).applyReviewedProposal({ expectedCurrentEtag: '"before"', expectedCurrentSha256: hash(original),
      reviewedCandidateSha256: proposal.summary.candidateSha256, recoveryFile: join(directory, "validation.json"), scope }), { code: "POLICY_REJECTED" });
    assert.equal(f.writes(), 0);
    const f2 = fixture(), unsupportedText = JSON.stringify({ acls: [{ action: "accept", src: ["*"], dst: ["*:*"] }] });
    const unsupported: typeof fetch = async (input, init) => {
      if (String(input).endsWith("/acl") && (init?.method ?? "GET") === "GET") return new Response(unsupportedText, { headers: { etag: '"before"' } });
      return f2.request(input, init);
    };
    await assert.rejects(createTailnetPolicyCas(configuration, unsupported).applyReviewedProposal({ expectedCurrentEtag: '"before"', expectedCurrentSha256: hash(unsupportedText),
      reviewedCandidateSha256: proposal.summary.candidateSha256, recoveryFile: join(directory, "unsupported.json"), scope }), { code: "POLICY_REJECTED" });
    assert.equal(f2.writes(), 0);
    const f3 = fixture();
    await assert.rejects(createTailnetPolicyCas(configuration, f3.request).applyReviewedProposal({ expectedCurrentEtag: '"before"', expectedCurrentSha256: hash(original),
      reviewedCandidateSha256: proposal.summary.candidateSha256, recoveryFile: join(directory, "missing-dir/recovery.json"), scope }), { code: "RECOVERY_UNAVAILABLE" });
    assert.equal(f3.writes(), 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("lost policy-write acknowledgment stays unknown and is not retried", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sg-tailnet-cas-")), f = fixture({ loseWriteAck: true }), configuration = await readFixtureConfiguration(dir);
  try {
    await assert.rejects(createTailnetPolicyCas(configuration, f.request).applyReviewedProposal({ expectedCurrentEtag: '"before"', expectedCurrentSha256: hash(original),
      reviewedCandidateSha256: proposal.summary.candidateSha256, recoveryFile: join(dir, "recovery.json"), scope }), { code: "POLICY_WRITE_UNKNOWN" });
    assert.equal(f.writes(), 1);
    assert.equal((await createTailnetPolicyCas(configuration, f.request).readCurrent()).sha256, proposal.summary.candidateSha256);
    assert.equal(f.writes(), 1); assert.ok(f.calls.some(v => v.path.endsWith("/acl") && v.method === "GET"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("rollback requires the exact post-write ETag and verifies the restored bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sg-tailnet-cas-")), f = fixture(), configuration = await readFixtureConfiguration(dir);
  try {
    const cas = createTailnetPolicyCas(configuration, f.request), recovery = join(dir, "recovery.json");
    const applied = await cas.applyReviewedProposal({ expectedCurrentEtag: '"before"', expectedCurrentSha256: hash(original),
      reviewedCandidateSha256: proposal.summary.candidateSha256, recoveryFile: recovery, scope });
    await assert.rejects(cas.restoreRecovery(recovery, '"stale"', applied.currentSha256), { code: "RECOVERY_ETAG_STALE" });
    assert.equal(f.writes(), 1);
    assert.deepEqual(await cas.restoreRecovery(recovery, applied.currentEtag, applied.currentSha256), { restored: true, policyMutationPerformed: true });
    assert.equal(f.current().sha256, hash(original)); assert.equal(f.writes(), 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
