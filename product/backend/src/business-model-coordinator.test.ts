import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { BusinessModelCoordinator, type BusinessModelFactsReader, type BusinessModelPort } from "./business-model-coordinator.js";
import type { BusinessSuggestionContext } from "./business-suggestion-core.js";
const now = "2026-10-01T00:00:00.000001Z";
const policy = { providerKey: "synthetic_provider", modelKey: "synthetic_model_version", timeoutMs: 1000 };
function fixture() {
  const projectId = randomUUID(), factId = randomUUID();
  const context: BusinessSuggestionContext = { projectId, factSetId: randomUUID(), factSetVersion: 1, observedAt: now, purpose: "advisory", projectState: "active",
    approval: { approvalId: randomUUID(), projectVersion: 1, proposalId: randomUUID() },
    approvedWindow: { startsAt: now, endsAt: "2026-10-02T00:00:00Z" }, maxPublicationsPerDay: 1, businessTimeZone: "Asia/Shanghai", approvedForms: ["facebook_video"], approvedLanguages: ["en"],
    facts: [{ factId, version: 1, kind: "approval", availability: "available" }], materials: [], tasks: [], quota: { units: [], variants: [], identities: [], slots: [], seriesBindings: [] } };
  const input = { context, descriptions: [{ factId, version: 1, text: "Synthetic authorized business text, NOT real model input evidence" }] };
  const suggestion = { suggestionId: randomUUID(), projectId, factSetId: context.factSetId, factSetVersion: 1, approval: context.approval,
    basis: [{ factId, version: 1 }], explanation: "Synthetic maintain suggestion, NOT actual AI decision", limitations: ["Fixture"], decision: "maintain", taskIds: [] };
  let reads = 0, calls = 0, signal: AbortSignal | undefined;
  const facts: BusinessModelFactsReader = { read: async (_project, s) => { reads++; signal = s; return input; } };
  const model: BusinessModelPort = { generate: async (_request, s) => { calls++; signal = s; return { responseId: "synthetic-response-1", outputText: JSON.stringify(suggestion) }; } };
  return { projectId, context, input, suggestion, facts, model, counts: () => ({ reads, calls }), signal: () => signal };
}
test("default/invalid configuration closes before facts/model and never synthesizes a decision", async () => {
  const f = fixture();
  for (const coordinator of [new BusinessModelCoordinator(), new BusinessModelCoordinator(f.facts), new BusinessModelCoordinator(f.facts, f.model),
    new BusinessModelCoordinator(f.facts, f.model, { ...policy, apiKey: "synthetic-non-secret" }), new BusinessModelCoordinator(f.facts, f.model, { ...policy, timeoutMs: 0 })]) {
    assert.deepEqual(await coordinator.run(f.projectId), { status: "unavailable", reason: "configuration_missing", provenance: null });
  }
  assert.deepEqual(f.counts(), { reads: 0, calls: 0 });
});
test("only configured port is called with sanitized explicit facts, returned suggestion remains advisory", async () => {
  const f = fixture(), result = await new BusinessModelCoordinator(f.facts, f.model, policy, () => now).run(f.projectId);
  assert.equal(result.status, "checked_advisory"); assert.deepEqual(f.counts(), { reads: 2, calls: 1 }); assert.equal(f.signal()!.aborted, true);
  if (result.status === "checked_advisory") {
    assert.equal(result.provenance.providerKey, policy.providerKey); assert.equal(result.provenance.modelKey, policy.modelKey);
    assert.equal(result.provenance.modelRequested, true); assert.equal(result.checked.stage, "checked_advisory_only");
    assert.equal(result.responseId, "synthetic-response-1"); assert.equal("executed" in result, false); assert.ok(result.checked.pendingChecks.includes("atomic_task_revision"));
  }
});
test("model cannot mutate private snapshot and caller's input remains unchanged", async () => {
  const f = fixture(), before = structuredClone(f.input);
  const model: BusinessModelPort = { generate: async request => {
    request.input.context.factSetVersion = 99; request.input.descriptions[0]!.text = "Changed by injected fixture";
    return { responseId: "synthetic-response", outputText: JSON.stringify(f.suggestion) };
  } };
  assert.equal((await new BusinessModelCoordinator(f.facts, model, policy, () => now).run(f.projectId)).status, "checked_advisory"); assert.deepEqual(f.input, before);
});
test("provider exception never leaks its cause, input or old successful proposal", async () => {
  const f = fixture(), coordinator = new BusinessModelCoordinator(f.facts, { generate: async () => { throw new Error("synthetic-private-marker", { cause: f.input }); } }, policy, () => now);
  const result = await coordinator.run(f.projectId); assert.equal(result.status, "unavailable");
  assert.equal(JSON.stringify(result).includes("synthetic-private-marker"), false); assert.equal("cause" in result, false);
  if (result.status === "unavailable") assert.equal(result.reason, "model_unavailable");
});
test("unavailable or invalid fact reader causes no model request and no template fallback", async () => {
  const f = fixture();
  for (const read of [async () => { throw new Error("synthetic-reader-private-marker"); }, async () => null, async () => ({ ...f.input, secret: "synthetic-non-secret" }),
    async () => ({ ...f.input, context: { ...f.context, projectId: randomUUID() } }), async () => ({ ...f.input, context: { ...f.context, quota: {} } })]) {
    const result = await new BusinessModelCoordinator({ read }, f.model, policy, () => now).run(f.projectId);
    assert.equal(result.status, "unavailable"); if (result.status === "unavailable") assert.equal(result.reason, "facts_unavailable");
    assert.equal(JSON.stringify(result).includes("private-marker"), false);
  }
  assert.equal(f.counts().calls, 0);
});
test("bad/foreign/duplicate fact descriptions refuse even before invoking model", async () => {
  const f = fixture();
  for (const descriptions of [[], [...f.input.descriptions, ...f.input.descriptions], [{ ...f.input.descriptions[0]!, version: 2 }], [{ ...f.input.descriptions[0]!, factId: randomUUID() }]]) {
    const result = await new BusinessModelCoordinator({ read: async () => ({ ...f.input, descriptions }) }, f.model, policy, () => now).run(f.projectId);
    assert.equal(result.status, "unavailable");
  }
  assert.equal(f.counts().calls, 0);
});
test("invalid JSON/non-string/envelope extras and oversized UTF8 never echo raw response", async () => {
  const f = fixture();
  for (const returned of [{ responseId: "r", outputText: "synthetic-raw-secret-not-json" }, { responseId: "r", outputText: f.suggestion },
    { responseId: "r", outputText: JSON.stringify(f.suggestion), approved: true }, { responseId: "r", outputText: "a".repeat(262_145) },
    { responseId: "r", outputText: "汉".repeat(100_000) }]) {
    const result = await new BusinessModelCoordinator(f.facts, { generate: async () => returned }, policy, () => now).run(f.projectId);
    assert.equal(result.status, "rejected"); if (result.status === "rejected") assert.equal(result.reason, "response_invalid");
    assert.equal(JSON.stringify(result).includes("synthetic-raw-secret"), false);
  }
});
test("well-formed model output cannot claim success/permit or replace approval and facts", async () => {
  const f = fixture();
  for (const [patch, reason] of [[{ publicationSucceeded: true }, "INPUT_INVALID"], [{ pause: false }, "INPUT_INVALID"], [{ factSetVersion: 2 }, "FACTS_STALE"],
    [{ approval: { ...f.context.approval!, proposalId: randomUUID() } }, "FACTS_STALE"]] as const) {
    const result = await new BusinessModelCoordinator(f.facts, { generate: async () => ({ responseId: "r", outputText: JSON.stringify({ ...f.suggestion, ...patch }) }) }, policy, () => now).run(f.projectId);
    assert.equal(result.status, "rejected"); if (result.status === "rejected") assert.equal(result.reason, reason);
  }
});
test("current versions, project pause, task/material or business text changes reject old model response", async () => {
  for (const mutate of [(f: ReturnType<typeof fixture>) => { f.context.factSetVersion++; }, (f: ReturnType<typeof fixture>) => { f.context.projectState = "paused"; },
    (f: ReturnType<typeof fixture>) => { f.context.approval!.projectVersion++; }, (f: ReturnType<typeof fixture>) => { f.input.descriptions[0]!.text = "Corrected fact"; }]) {
    const f = fixture(), outputText = JSON.stringify(f.suggestion);
    const result = await new BusinessModelCoordinator(f.facts, { generate: async () => { mutate(f); return { responseId: "r", outputText }; } }, policy, () => now).run(f.projectId);
    assert.equal(result.status, "rejected"); if (result.status === "rejected") assert.equal(result.reason, "facts_changed");
  }
});
test("fresh read time alone is allowed, while backward observations are refused", async () => {
  for (const observedAt of ["2026-10-01T00:00:01Z", "2026-10-01T00:00:00Z"]) {
    const f = fixture(), outputText = JSON.stringify(f.suggestion);
    const model: BusinessModelPort = { generate: async () => { f.context.observedAt = observedAt; return { responseId: "r", outputText }; } };
    let clocks = 0; const result = await new BusinessModelCoordinator(f.facts, model, policy, () => clocks++ < 2 ? now : "2026-10-01T00:00:02Z").run(f.projectId);
    assert.equal(result.status, observedAt.endsWith("01Z") ? "checked_advisory" : "rejected");
  }
});
test("timeout in first facts read aborts request and never invokes model", async () => {
  const f = fixture(); let signal: AbortSignal | undefined;
  const result = await new BusinessModelCoordinator({ read: async (_p, s) => { signal = s; return new Promise(() => {}); } }, f.model, { ...policy, timeoutMs: 15 }, () => now).run(f.projectId);
  assert.equal(result.status, "unavailable"); if (result.status === "unavailable") { assert.equal(result.reason, "deadline_exceeded"); assert.equal(result.provenance!.modelRequested, false); }
  assert.equal(signal!.aborted, true); assert.equal(f.counts().calls, 0);
});
test("ignored cancellation and late model output cannot promote timed-out attempt or trigger final read", async () => {
  const f = fixture(); let release: (value: unknown) => void = () => {}; let signal: AbortSignal | undefined;
  const model: BusinessModelPort = { generate: async (_r, s) => { signal = s; return new Promise(resolve => { release = resolve; }); } };
  const result = await new BusinessModelCoordinator(f.facts, model, { ...policy, timeoutMs: 15 }, () => now).run(f.projectId);
  assert.equal(result.status, "unavailable"); if (result.status === "unavailable") assert.equal(result.reason, "deadline_exceeded");
  assert.equal(signal!.aborted, true); release({ responseId: "late", outputText: JSON.stringify(f.suggestion) }); await Promise.resolve();
  assert.equal(f.counts().reads, 1); assert.equal(result.status, "unavailable");
});
test("timeout/current-facts failure after model does not retain advisory as fallback", async () => {
  for (const block of [true, false]) {
    const f = fixture(); let reads = 0;
    const facts: BusinessModelFactsReader = { read: async () => { if (++reads === 1) return f.input; if (block) return new Promise(() => {}); throw new Error("synthetic-final-facts-error"); } };
    const result = await new BusinessModelCoordinator(facts, f.model, { ...policy, timeoutMs: 15 }, () => now).run(f.projectId);
    assert.equal(result.status, "unavailable"); if (result.status === "unavailable") assert.equal(result.reason, block ? "deadline_exceeded" : "facts_unavailable");
    assert.equal("checked" in result, false);
  }
});
test("invalid or reversed server clock and input return safe errors", async () => {
  const f = fixture();
  for (const clock of [() => "invalid-synthetic-clock", () => { throw new Error("synthetic-clock-private"); }]) {
    assert.equal((await new BusinessModelCoordinator(f.facts, f.model, policy, clock).run(f.projectId)).status, "unavailable");
  }
  assert.deepEqual(f.counts(), { reads: 0, calls: 0 });
  const invalidProject = await new BusinessModelCoordinator(f.facts, f.model, policy, () => now).run("synthetic-invalid-id");
  assert.equal(invalidProject.status, "unavailable");
  let clocks = 0; const reverse = await new BusinessModelCoordinator(f.facts, f.model, policy, () => clocks++ ? "2026-10-01T00:00:00Z" : now).run(f.projectId);
  assert.equal(reverse.status, "unavailable"); if (reverse.status === "unavailable") assert.equal(reverse.reason, "clock_invalid");
});
test("no model result caching: failed second request never copies preceding valid response", async () => {
  const f = fixture(); let attempts = 0;
  const model: BusinessModelPort = { generate: async () => { if (++attempts === 2) throw new Error("second-request-failed"); return { responseId: "first", outputText: JSON.stringify(f.suggestion) }; } };
  const coordinator = new BusinessModelCoordinator(f.facts, model, policy, () => now), first = await coordinator.run(f.projectId), second = await coordinator.run(f.projectId);
  assert.equal(first.status, "checked_advisory"); assert.equal(second.status, "unavailable"); assert.equal("checked" in second, false);
  assert.notEqual(first.provenance!.attemptId, second.provenance!.attemptId);
});
test("final task-window check uses server clock AFTER the last awaited fact read", async () => {
  const f = fixture(), contentUnitId = randomUUID(), variantId = randomUUID(), identityId = randomUUID();
  f.context.approvedWindow!.endsAt = "2026-10-01T00:00:01Z";
  f.context.quota = { units: [{ contentUnitId, projectId: f.projectId, mediaKind: "video", seriesId: null, episodeNumber: null }], variants: [{ variantId, contentUnitId }],
    identities: [{ identityId, projectId: f.projectId, platform: "facebook" }], slots: [], seriesBindings: [] };
  f.context.materials = [{ contentUnitId, variantId, materialVersion: 1, language: "en", state: "candidate" }];
  const { decision: _decision, taskIds: _taskIds, ...common } = f.suggestion;
  const proposal = { ...common, decision: "adjust", changes: [{ kind: "schedule", publication: { taskId: randomUUID(), contentUnitId, variantId, identityId,
    form: "facebook_video", scheduledAt: "2026-10-01T00:00:00.9Z", title: "Synthetic title", caption: "Synthetic caption" } }] };
  let currentClock = now, reads = 0;
  const facts: BusinessModelFactsReader = { read: async () => { if (++reads === 2) currentClock = "2026-10-01T00:00:02Z"; return f.input; } };
  const result = await new BusinessModelCoordinator(facts, { generate: async () => ({ responseId: "r", outputText: JSON.stringify(proposal) }) }, policy, () => currentClock).run(f.projectId);
  assert.equal(result.status, "rejected"); if (result.status === "rejected") assert.equal(result.reason, "OUT_OF_SCOPE");
});
test("clock cannot reverse after initial facts while still being later than attempt start", async () => {
  const f = fixture(), clocks = [now, "2026-10-01T00:00:02Z", "2026-10-01T00:00:01Z"]; let i = 0;
  const result = await new BusinessModelCoordinator(f.facts, f.model, policy, () => clocks[i++]!).run(f.projectId);
  assert.equal(result.status, "unavailable"); if (result.status === "unavailable") assert.equal(result.reason, "clock_invalid");
});
test("blocked event-loop or immediately resolved late port cannot beat technical deadline", async () => {
  const f = fixture();
  const model: BusinessModelPort = { generate: async () => {
    const until = performance.now() + 30; while (performance.now() < until) { /* bounded synthetic CPU delay, no action/network */ }
    return { responseId: "late", outputText: JSON.stringify(f.suggestion) };
  } };
  const result = await new BusinessModelCoordinator(f.facts, model, { ...policy, timeoutMs: 15 }, () => now).run(f.projectId);
  assert.equal(result.status, "unavailable"); if (result.status === "unavailable") assert.equal(result.reason, "deadline_exceeded");
  assert.equal(f.counts().reads, 1);
});
