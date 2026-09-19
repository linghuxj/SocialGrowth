import type {
  DeviceInfo,
  ExecutionAdapter,
  ExecutionReceipt,
  PublishTaskDirective,
} from "./types.js";

export class UnconfiguredExecutionAdapter implements ExecutionAdapter {
  public async execute(task: PublishTaskDirective, device: DeviceInfo): Promise<ExecutionReceipt> {
    return {
      schemaVersion: "design-v1",
      eventId: crypto.randomUUID(),
      taskId: task.taskId,
      attemptId: task.attemptId,
      deviceId: device.deviceId,
      accountId: task.accountId,
      occurredAt: new Date().toISOString(),
      executionStatus: "blocked",
      publishStatus: "not_submitted",
      evidenceRefs: [],
      failureCode: "EXECUTOR_NOT_CONFIGURED",
      resourceStatus: "available",
    };
  }
}
