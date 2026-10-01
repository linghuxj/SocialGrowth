import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";
import { contractVersion, emptyProjectPlanningInputs } from "@socialgrowth/product-contracts";
import { PreparedPlanningDraft, readPlanningDraft, PlanningClientError, samePlanningInputs } from "./project-planning-api.js";
import { OperatorWriteSessionChangedError } from "./operator-api.js";
const project = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", csrf = "socialgrowth.operator.csrf";
const original = globalThis.fetch, storage = new Map<string, string>();
Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: (k: string) => storage.get(k) ?? null, removeItem: (k: string) => storage.delete(k) } });
beforeEach(() => { storage.set(csrf, "C".repeat(43)); }); afterEach(() => { globalThis.fetch = original; storage.clear(); });
const input = () => ({ metadata: { contractVersion, requestId: "synthetic-planning-client", idempotencyKey: "synthetic-planning-key-original" }, projectId: project,
  expectedProjectVersion: 0, expectedDraftVersion: 0, inputs: { ...emptyProjectPlanningInputs(), preOpeningGoal: "synthetic manually entered goal" } });
const draft = () => ({ projectId: project, projectFactVersion: 1, draftVersion: 1, inputs: input().inputs, status: "unapproved_draft", savedAt: "2026-10-02T00:00:00Z", savedByOperatorId: other });
const response = (v: unknown) => new Response(JSON.stringify({ draft: v }), { headers: { "content-type": "application/json" } });
test("unknown save retry preserves original body/key/session and carries no approval or dispatch", async () => {
  const raw = input(), expected = JSON.stringify(raw), prepared = new PreparedPlanningDraft(raw), bodies: unknown[] = [];
  raw.inputs.preOpeningGoal = "changed caller-owned input";
  globalThis.fetch = async (url, init) => { assert.equal(String(url), `/api/operator/projects/${project}/planning-draft`); assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("x-csrf-token"), "C".repeat(43)); bodies.push(init?.body); if (bodies.length === 1) throw new Error("synthetic-lost-ack"); return response(draft()); };
  await assert.rejects(prepared.send(), PlanningClientError); const saved = await prepared.send();
  assert.equal(saved.status, "unapproved_draft"); assert.deepEqual(bodies, [expected, expected]); assert.equal(JSON.stringify(prepared), "{}");
});
test("current original-key replay may have later input but cannot claim a different project or earlier version", async () => {
  const later = { ...draft(), projectFactVersion: 5, draftVersion: 4, inputs: { ...input().inputs, preOpeningGoal: "another operator current input" } };
  globalThis.fetch = async () => response(later); const saved = await new PreparedPlanningDraft(input()).send(); assert.equal(samePlanningInputs(saved.inputs, input().inputs), false);
  for (const v of [{ ...draft(), projectId: other }, { ...draft(), status: "approved" }, { ...draft(), publicationAllowed: true }]) {
    globalThis.fetch = async () => response(v); await assert.rejects(new PreparedPlanningDraft(input()).send(), PlanningClientError);
  }
  globalThis.fetch = async () => response(draft()); await assert.rejects(new PreparedPlanningDraft({ ...input(), expectedDraftVersion: 2 }).send(), PlanningClientError);
});
test("read correlates project and sends no mutation while treating failed response as unavailable, not empty", async () => {
  globalThis.fetch = async (url, init) => { assert.equal(String(url), `/api/operator/projects/${project}/planning-draft`); assert.equal(init?.method ?? "GET", "GET"); assert.equal(init?.body, undefined); return response(draft()); };
  assert.equal((await readPlanningDraft(project.toUpperCase())).draftVersion, 1);
  globalThis.fetch = async () => response({ ...draft(), projectId: other }); await assert.rejects(readPlanningDraft(project), PlanningClientError);
  globalThis.fetch = async () => { throw new Error("synthetic-sensitive-provider-path"); }; await assert.rejects(readPlanningDraft(project), e => e instanceof PlanningClientError && e.message === "PLANNING_UNAVAILABLE" && !("cause" in e));
});
test("late save/read cannot become facts under a new login", async () => {
  let release!: (v: Response) => void; globalThis.fetch = () => new Promise(r => { release = r; });
  const prepared = new PreparedPlanningDraft(input()), pending = prepared.send(); storage.set(csrf, "D".repeat(43)); release(response(draft()));
  await assert.rejects(pending, OperatorWriteSessionChangedError); await assert.rejects(prepared.send(), OperatorWriteSessionChangedError);
  const reading = readPlanningDraft(project); storage.set(csrf, "E".repeat(43)); release(response(draft())); await assert.rejects(reading, OperatorWriteSessionChangedError);
});
test("invalid project/body never reaches transport and set order does not imply changed inputs", async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; return response(draft()); };
  await assert.rejects(readPlanningDraft("../../private"), PlanningClientError); assert.throws(() => new PreparedPlanningDraft({ ...input(), inputs: { ...input().inputs, targetLanguages: ["es", "es"] } }), PlanningClientError); assert.equal(calls, 0);
  assert.ok(samePlanningInputs({ ...input().inputs, targetCountries: ["A", "B"] }, { ...input().inputs, targetCountries: ["B", "A"] }));
});
