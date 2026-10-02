import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { contractVersion, emptyProjectPlanningInputs, initialDirectionAutonomy } from "@socialgrowth/product-contracts";
import { PreparedDirectionRequest, readProjectDirection } from "./project-direction-api.js";
import { OperatorWriteSessionChangedError } from "./operator-api.js";
const project = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", proposalId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", csrf = "socialgrowth.operator.csrf";
const original = globalThis.fetch, storage = new Map<string, string>();
Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, removeItem: (key: string) => storage.delete(key) } });
beforeEach(() => { storage.set(csrf, "C".repeat(43)); }); afterEach(() => { globalThis.fetch = original; storage.clear(); });
const metadata = { contractVersion, requestId: "synthetic-direction-request", idempotencyKey: "synthetic-direction-original-key" };
const generation = () => ({ metadata: { ...metadata }, projectId: project, expectedProjectVersion: 1, expectedDraftVersion: 1, identities: [{ platform: "facebook", canonicalRef: "SYNTHETIC", declaredStage: "before_monetization" }] });
const view = () => ({ projectId: project, projectVersion: 1, proposal: null, approval: null, attempt: { attemptId: other, state: "unavailable", proposalId: null }, blockers: ["Synthetic only"], executionAllowed: false, publicationAllowed: false });
const reply = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
test("unknown direction response preserves original body, key and login for replay", async () => {
  const raw = generation(), expected = JSON.stringify(raw), request = new PreparedDirectionRequest("generate", raw), bodies: unknown[] = [];
  raw.identities[0]!.canonicalRef = "CHANGED";
  globalThis.fetch = async (url, init) => { assert.equal(String(url), `/api/operator/projects/${project}/direction/generate`); assert.equal(new Headers(init?.headers).get("x-csrf-token"), "C".repeat(43)); bodies.push(init?.body); if (bodies.length === 1) throw new Error("lost-response"); return reply(view()); };
  await assert.rejects(request.send()); assert.equal((await request.send()).attempt?.state, "unavailable"); assert.deepEqual(bodies, [expected, expected]);
});
test("direction transport cannot claim a different project, older facts or action permission", async () => {
  for (const body of [{ ...view(), projectId: other }, { ...view(), projectVersion: 0 }, { ...view(), executionAllowed: true }, { ...view(), attempt: { attemptId: other, state: "proposed", proposalId: null } }]) {
    globalThis.fetch = async () => reply(body); await assert.rejects(new PreparedDirectionRequest("generate", generation()).send());
  }
  globalThis.fetch = async () => reply({ ...view(), attempt: null }); await assert.rejects(new PreparedDirectionRequest("generate", generation()).send());
});
test("confirmation response must contain exactly the requested immutable proposal and digest", async () => {
  const inputs = { ...emptyProjectPlanningInputs(), preOpeningGoal: "Synthetic", postOpeningGoal: "Synthetic", postOpeningPriority: "balanced", targetCountries: ["CN"], targetLanguages: ["zh"], contentForms: ["facebook_image_text"], contentRules: "Synthetic only", businessTimeZone: "Asia/Shanghai", firstCycleStartsAt: "2090-01-01T00:00:00Z", reviewIntervalDays: 7, trafficMinimumPerCycle: 0, observationWindowHours: 24, tailObservationDays: 0, maxPublicationsPerDay: 1, publishingWindow: { startsAt: "2090-01-01T00:00:00Z", endsAt: "2090-02-01T00:00:00Z" } };
  const proposal = { proposalId, projectId: project, projectVersion: 1, draftVersion: 1, snapshotDigest: "a".repeat(64), scope: { inputs, identities: generation().identities, autonomy: initialDirectionAutonomy }, output: { direction: "Synthetic", rationale: "Supplemental only", limitations: [] }, generatedAt: "2026-10-02T00:00:00Z", providerKey: "fixture", modelKey: "fixture", responseId: other };
  const request = new PreparedDirectionRequest("confirm", { metadata, projectId: project, expectedProjectVersion: 1, proposalId, snapshotDigest: proposal.snapshotDigest });
  globalThis.fetch = async () => reply(view()); await assert.rejects(request.send());
  const approved = { ...view(), projectVersion: 2, attempt: null, proposal, approval: { approvalId: other, proposal, confirmedByOperatorId: other, confirmedByOperatorName: "合成测试运营", confirmedAt: "2026-10-02T00:00:01Z", status: "approved_waiting_readiness" } };
  globalThis.fetch = async () => reply(approved); assert.equal((await request.send()).approval?.proposal.proposalId, proposalId);
  const changed = { ...proposal, snapshotDigest: "b".repeat(64) }; globalThis.fetch = async () => reply({ ...approved, proposal: changed, approval: { ...approved.approval, proposal: changed } }); await assert.rejects(request.send());
});
test("late read and replay after login replacement are rejected, and reads perform no writes", async () => {
  let release!: (value: Response) => void; globalThis.fetch = async (_url, init) => { assert.equal(init?.method ?? "GET", "GET"); assert.equal(init?.body, undefined); return new Promise(resolve => { release = resolve; }); };
  const pending = readProjectDirection(project); storage.set(csrf, "D".repeat(43)); release(reply(view())); await assert.rejects(pending, OperatorWriteSessionChangedError);
  const request = new PreparedDirectionRequest("generate", generation()); storage.set(csrf, "E".repeat(43)); await assert.rejects(request.send(), OperatorWriteSessionChangedError);
});
