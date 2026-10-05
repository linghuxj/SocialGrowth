import { timestampSchema, uuidSchema } from "@socialgrowth/product-contracts";
import { z } from "zod";
import {
  TaskAssistanceRecheckStore, type TaskAssistanceRecheckClaim, type TaskAssistanceRecheckResult,
} from "./task-assistance-recheck-store.js";

const resultSchema = z.strictObject({
  status: z.enum(["verified_recovered", "still_blocked", "unknown"]),
  blockers: z.array(z.string().min(1).max(120)).max(32),
  checkedAt: timestampSchema,
}).superRefine((value, ctx) => {
  if (value.status === "verified_recovered" && value.blockers.length > 0) ctx.addIssue({ code: "custom", message: "Recovered result cannot carry blockers" });
  if (value.status !== "verified_recovered" && value.blockers.length === 0) ctx.addIssue({ code: "custom", message: "Non-success recheck needs an explicit blocker" });
});
const blocker = "trusted_recheck_unavailable";

// The only implementation allowed to return verified_recovered must be
// installed by the lead from trusted task/control/verifier and bounded
// same-attempt dispatcher ports. It must re-read current facts, honor pause or
// exit, reconcile the original publication before any retry, and use the
// existing two-attempt/five-minute budget. This interface is never HTTP input.
export interface TrustedDeviceAssistanceRecoveryPort {
  recheckAndContinueSameAttempt(claim: Readonly<TaskAssistanceRecheckClaim>): Promise<TaskAssistanceRecheckResult>;
  // Restart path: this method must only read/reconcile the original operation
  // identified by the unchanged claim token/idempotency key. It must never
  // dispatch/retry the recovery action.
  reconcileOriginalAttempt(claim: Readonly<TaskAssistanceRecheckClaim>): Promise<TaskAssistanceRecheckResult>;
}

export interface DeviceAssistanceRecheckRunResult {
  consumed: boolean;
  status: "verified_recovered" | "still_blocked" | "unknown" | null;
}

export class DeviceAssistanceRecheckConsumer {
  constructor(private readonly store: TaskAssistanceRecheckStore, private readonly trustedPort?: TrustedDeviceAssistanceRecoveryPort) {}

  async getRecoveryDisposition(taskId: string, taskAttemptId: string): Promise<RecoveryDisposition> {
    return getRecoveryDisposition(this.store, taskId, taskAttemptId);
  }

  async runOnce(): Promise<DeviceAssistanceRecheckRunResult> {
    const claim = await this.store.claimNext();
    if (!claim) return { consumed: false, status: null };
    let outcome: TaskAssistanceRecheckResult;
    if (!this.trustedPort) {
      outcome = { status: "unknown", blockers: [claim.reconcileOnly ? "original_recovery_reconciliation_unavailable" : blocker], checkedAt: new Date().toISOString() };
    } else {
      try {
        const candidate: unknown = claim.reconcileOnly
          ? await this.trustedPort.reconcileOriginalAttempt(claim)
          : await this.trustedPort.recheckAndContinueSameAttempt(claim);
        const parsed = resultSchema.safeParse(candidate);
        outcome = parsed.success ? parsed.data : { status: "unknown", blockers: [blocker], checkedAt: new Date().toISOString() };
      } catch {
        // The dispatcher/verifier may have accepted work before a transport
        // failed. Preserve an explicit unknown and require reconciliation by
        // the same idempotency key; never turn an exception into success.
        outcome = { status: "unknown", blockers: [claim.reconcileOnly ? "original_recovery_reconciliation_unavailable" : blocker], checkedAt: new Date().toISOString() };
      }
    }
    await this.store.complete(claim, outcome);
    return { consumed: true, status: outcome.status };
  }
}

export type RecoveryDispositionState = "not_required" | "eligible" | "blocked" | "in_progress" | "unknown";
export interface RecoveryDisposition { state: RecoveryDispositionState; blockers: string[] }

export async function getRecoveryDisposition(
  store: TaskAssistanceRecheckStore,
  taskId: string,
  taskAttemptId: string,
): Promise<RecoveryDisposition> {
  const task = uuidSchema.safeParse(taskId), attempt = uuidSchema.safeParse(taskAttemptId);
  if (!task.success || !attempt.success) return { state: "blocked", blockers: ["invalid_task_scope"] };
  const view = await store.readDisposition(task.data.toLowerCase(), attempt.data.toLowerCase());
  switch (view.status) {
    case "not_requested": return { state: "not_required", blockers: [] };
    case "verified_recovered": return { state: "eligible", blockers: [] };
    case "still_blocked": return { state: "blocked", blockers: view.blockers };
    case "pending":
    case "claimed": return { state: "in_progress", blockers: view.blockers };
    case "unknown": return { state: "unknown", blockers: view.blockers };
  }
}
