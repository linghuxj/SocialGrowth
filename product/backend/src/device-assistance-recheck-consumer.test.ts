import assert from "node:assert/strict";
import test from "node:test";
import { DeviceAssistanceRecheckConsumer, getRecoveryDisposition } from "./device-assistance-recheck-consumer.js";
import type { TaskAssistanceRecheckClaim, TaskAssistanceRecheckResult, TaskAssistanceRecheckStore } from "./task-assistance-recheck-store.js";

const uuid = "00000000-0000-4000-8000-00000000000a";
const claim: TaskAssistanceRecheckClaim = { taskAttemptId: uuid, taskId: uuid, todoId: uuid, deviceId: uuid, noteId: uuid,
  version: 1, claimToken: uuid, idempotencyKey: `assistance_recheck_${uuid.replaceAll("-", "")}_1`, reconcileOnly: false };
const checkedAt = "2026-10-05T00:00:00Z";
function fixture(status: "not_requested" | "pending" | "claimed" | "verified_recovered" | "still_blocked" | "unknown" = "pending", claimToReturn: TaskAssistanceRecheckClaim = claim) {
  let saved: TaskAssistanceRecheckResult | null = null;
  const fake = {
    claimNext: async () => claimToReturn,
    complete: async (_claim: TaskAssistanceRecheckClaim, result: unknown) => { saved = result as TaskAssistanceRecheckResult; },
    readDisposition: async () => ({ status, blockers: status === "still_blocked" ? ["device_paused"] : [] }),
  } as unknown as TaskAssistanceRecheckStore;
  return { fake, saved: () => saved };
}

test("missing trusted bridge preserves unknown and cannot convert an operator report to success", async () => {
  const f = fixture(), result = await new DeviceAssistanceRecheckConsumer(f.fake).runOnce();
  assert.deepEqual(result, { consumed: true, status: "unknown" });
  assert.equal(f.saved()?.status, "unknown");
  assert.deepEqual(f.saved()?.blockers, ["trusted_recheck_unavailable"]);
});

test("only a configured trusted adapter can report recovered, and malformed or failed replies remain unknown", async () => {
  const recovered = fixture(), port = { recheckAndContinueSameAttempt: async () => ({ status: "verified_recovered" as const, blockers: [], checkedAt }), reconcileOriginalAttempt: async () => ({ status: "unknown" as const, blockers: ["unresolved"], checkedAt }) };
  assert.deepEqual(await new DeviceAssistanceRecheckConsumer(recovered.fake, port).runOnce(), { consumed: true, status: "verified_recovered" });
  assert.equal(recovered.saved()?.status, "verified_recovered");

  const malformed = fixture(), invalidPort = { recheckAndContinueSameAttempt: async () => ({ status: "verified_recovered" as const, blockers: ["device_paused"], checkedAt }), reconcileOriginalAttempt: async () => ({ status: "unknown" as const, blockers: ["unresolved"], checkedAt }) };
  assert.deepEqual(await new DeviceAssistanceRecheckConsumer(malformed.fake, invalidPort).runOnce(), { consumed: true, status: "unknown" });
  assert.equal(malformed.saved()?.status, "unknown");

  const rejected = fixture(), throwingPort = { recheckAndContinueSameAttempt: async () => { throw new Error("private bridge detail"); }, reconcileOriginalAttempt: async () => ({ status: "unknown" as const, blockers: ["unresolved"], checkedAt }) };
  assert.deepEqual(await new DeviceAssistanceRecheckConsumer(rejected.fake, throwingPort).runOnce(), { consumed: true, status: "unknown" });
  assert.equal(rejected.saved()?.status, "unknown");
});

test("expired claimed work only reconciles its original operation and never invokes recovery again", async () => {
  const reconcileOnly = { ...claim, reconcileOnly: true }, f = fixture("pending", reconcileOnly);
  let dispatches = 0, reconciliations = 0;
  const port = {
    recheckAndContinueSameAttempt: async () => { dispatches++; return { status: "verified_recovered" as const, blockers: [], checkedAt }; },
    reconcileOriginalAttempt: async (value: TaskAssistanceRecheckClaim) => {
      reconciliations++;
      assert.equal(value.claimToken, claim.claimToken);
      assert.equal(value.idempotencyKey, claim.idempotencyKey);
      return { status: "unknown" as const, blockers: ["operation_still_unknown"], checkedAt };
    },
  };
  assert.deepEqual(await new DeviceAssistanceRecheckConsumer(f.fake, port).runOnce(), { consumed: true, status: "unknown" });
  assert.equal(dispatches, 0);
  assert.equal(reconciliations, 1);
  assert.equal(f.saved()?.status, "unknown");

  const unavailable = fixture("pending", reconcileOnly);
  assert.deepEqual(await new DeviceAssistanceRecheckConsumer(unavailable.fake, undefined).runOnce(), { consumed: true, status: "unknown" });
  assert.deepEqual(unavailable.saved()?.blockers, ["original_recovery_reconciliation_unavailable"]);
});

test("disposition treats the same linked attempt as in progress/eligible/blocked and preserves unknown", async () => {
  for (const [status, expected] of [["not_requested", "not_required"], ["pending", "in_progress"], ["claimed", "in_progress"],
    ["verified_recovered", "eligible"], ["still_blocked", "blocked"], ["unknown", "unknown"]] as const) {
    const f = fixture(status);
    const value = await getRecoveryDisposition(f.fake, uuid, uuid);
    assert.equal(value.state, expected);
    if (status === "still_blocked") assert.deepEqual(value.blockers, ["device_paused"]);
  }
  const invalid = fixture();
  assert.deepEqual(await getRecoveryDisposition(invalid.fake, "not-a-uuid", uuid), { state: "blocked", blockers: ["invalid_task_scope"] });
});
