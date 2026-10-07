import { centralPublicationTaskSchema, taskDispatchNoticeSchema, taskExecutionObservationSchema, taskProtocolVersion, type CentralPublicationTask } from "@socialgrowth/product-contracts";
export class TaskDispatchError extends Error {
  constructor(readonly code: "INPUT_INVALID" | "SCOPE_MISMATCH") { super(code); }
}
const scopeKeys = ["taskId", "projectId", "taskAttemptId", "deviceId", "identityId"] as const;
function sameScope(task: CentralPublicationTask, other: { taskRevision: number; taskId: string; projectId: string; taskAttemptId: string; deviceId: string; identityId: string }) {
  return task.taskRevision === other.taskRevision && scopeKeys.every(key => task[key].toLowerCase() === other[key].toLowerCase());
}
export function createTaskRecheckNotice(input: unknown, messageId: string) {
  const p = centralPublicationTaskSchema.safeParse(input); if (!p.success) throw new TaskDispatchError("INPUT_INVALID");
  const task = p.data, parsed = taskDispatchNoticeSchema.safeParse({ protocolVersion: taskProtocolVersion, messageId,
    taskId: task.taskId, taskRevision: task.taskRevision, projectId: task.projectId, taskAttemptId: task.taskAttemptId, deviceId: task.deviceId, identityId: task.identityId,
    purpose: "recheck_central_task", executionAllowed: false });
  if (!parsed.success) throw new TaskDispatchError("INPUT_INVALID"); return parsed.data;
}
// INTERNAL pure classification ONLY. Source authentication, receipt dedup,
// immutable history, current task/admission/control and real evidence resolution
// belong to the future atomic producer/consumer. Never issues an action permit.
export function classifyTaskObservation(taskInput: unknown, observationInput: unknown) {
  const task = centralPublicationTaskSchema.safeParse(taskInput), observation = taskExecutionObservationSchema.safeParse(observationInput);
  if (!task.success || !observation.success) throw new TaskDispatchError("INPUT_INVALID");
  if (!sameScope(task.data, observation.data)) throw new TaskDispatchError("SCOPE_MISMATCH");
  const state = observation.data.publicationState;
  return { taskId: task.data.taskId, taskRevision: task.data.taskRevision, taskAttemptId: task.data.taskAttemptId,
    sourceEventId: observation.data.sourceEventId, handling: state === "submission_unknown" ? "verify_original_submission" as const
      : state === "reported_published" || state === "reported_not_published" ? "verify_reported_evidence" as const : "recheck_current_task" as const,
    executionAllowed: false as const, publicationAllowed: false as const, quotaReleaseAllowed: false as const,
    pendingChecks: ["current_source_and_event_authority", "original_attempt_and_fact_dedup", "actual_platform_evidence", "current_admission_control_window_and_budget"] };
}
