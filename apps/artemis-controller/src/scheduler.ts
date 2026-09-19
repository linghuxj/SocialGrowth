import type {
  ControllerAuditEntry,
  ExecutionAdapter,
  ExecutionReceipt,
  PublishTaskDirective,
  ReceiptStore,
} from "./types.js";
import type { DevicePool } from "./device-pool.js";

export interface SchedulerDependencies {
  now?: () => string;
  nextId?: () => string;
  auditSink?: (entry: ControllerAuditEntry) => void;
  validateTask?: (task: PublishTaskDirective) => { ok: boolean; reasonCode?: string };
}

export class TaskScheduler {
  private queue: PublishTaskDirective[] = [];
  private readonly queuedAttempts = new Set<string>();
  private readonly pausedBindings = new Map<string, string>();
  private readonly auditEntries: ControllerAuditEntry[] = [];
  private readonly now: () => string;
  private readonly nextId: () => string;

  constructor(
    private readonly devicePool: DevicePool,
    private readonly executor: ExecutionAdapter,
    private readonly receiptStore: ReceiptStore,
    private readonly dependencies: SchedulerDependencies = {},
  ) {
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.nextId = dependencies.nextId ?? (() => crypto.randomUUID());
  }

  public enqueueTask(task: PublishTaskDirective): boolean {
    const attemptKey = this.attemptKey(task.taskId, task.attemptId);
    if (this.receiptStore.get(task.taskId, task.attemptId) || this.queuedAttempts.has(attemptKey)) {
      this.audit(task, "task.enqueue", "rejected", "DUPLICATE_ATTEMPT", {});
      return false;
    }
    if (this.pausedBindings.has(task.bindingId)) {
      this.audit(task, "task.enqueue", "rejected", "BINDING_PAUSED", {
        reason: this.pausedBindings.get(task.bindingId) ?? null,
      });
      return false;
    }
    this.queue.push(structuredClone(task));
    this.queuedAttempts.add(attemptKey);
    this.audit(task, "task.enqueue", "accepted", "OK", { queueDepth: this.queue.length });
    return true;
  }

  public getPendingCount(): number {
    return this.queue.length;
  }
  public getReceipt(taskId: string, attemptId: string): ExecutionReceipt | undefined {
    return this.receiptStore.get(taskId, attemptId);
  }
  public listAuditEntries(): ControllerAuditEntry[] {
    return structuredClone(this.auditEntries);
  }

  public async dispatchNext(): Promise<ExecutionReceipt | null> {
    const task = this.queue[0];
    if (!task) return null;
    if (task.expiresAt <= this.now()) {
      this.removeHead(task);
      const receipt = this.createReceipt(
        task,
        task.deviceId,
        "failed",
        "not_submitted",
        "available",
        "DEADLINE_EXPIRED",
      );
      this.receiptStore.save(receipt);
      this.audit(task, "task.dispatch", "rejected", "DEADLINE_EXPIRED", {});
      return receipt;
    }
    const qualification = this.dependencies.validateTask?.(structuredClone(task));
    if (qualification && !qualification.ok) {
      this.removeHead(task);
      const receipt = this.createReceipt(
        task,
        task.deviceId,
        "blocked",
        "not_submitted",
        "available",
      );
      this.receiptStore.save(receipt);
      this.audit(
        task,
        "task.dispatch",
        "rejected",
        qualification.reasonCode ?? "QUALIFICATION_REJECTED",
        {},
      );
      return receipt;
    }
    const device = this.devicePool.getAvailableBoundDevice(
      task.platform,
      task.accountId,
      task.deviceId,
    );
    if (!device) {
      this.audit(task, "task.dispatch", "waiting", "EXACT_BOUND_DEVICE_UNAVAILABLE", {
        requiredDeviceId: task.deviceId,
        accountId: task.accountId,
      });
      return null;
    }
    this.removeHead(task);
    this.devicePool.updateStatus(device.deviceId, "busy");
    let receipt: ExecutionReceipt;
    try {
      receipt = await this.executor.execute(structuredClone(task), device);
    } catch {
      receipt = this.createReceipt(
        task,
        device.deviceId,
        "failed",
        "unknown",
        "error",
        "TECHNICAL_FAILURE",
      );
    }
    if (
      receipt.taskId !== task.taskId ||
      receipt.attemptId !== task.attemptId ||
      receipt.deviceId !== device.deviceId ||
      receipt.accountId !== task.accountId
    ) {
      receipt = this.createReceipt(
        task,
        device.deviceId,
        "failed",
        "unknown",
        "error",
        "RECEIPT_CONFLICT",
      );
    }
    this.receiptStore.save(receipt);
    if (receipt.failureCode === "IDENTITY_CHALLENGE")
      this.pausedBindings.set(task.bindingId, "IDENTITY_CHALLENGE");
    this.devicePool.updateStatus(
      device.deviceId,
      receipt.resourceStatus === "available" ? "idle" : receipt.resourceStatus,
    );
    this.audit(task, "task.receipt", "accepted", receipt.failureCode ?? "OK", {
      executionStatus: receipt.executionStatus,
      publishStatus: receipt.publishStatus,
    });
    return structuredClone(receipt);
  }

  public recordLateReceipt(
    task: PublishTaskDirective,
    incoming: ExecutionReceipt,
  ): ExecutionReceipt {
    const existing = this.receiptStore.get(task.taskId, task.attemptId);
    let retained = incoming;
    if (existing?.publishStatus === "published") retained = existing;
    else if (existing && incoming.publishStatus === "published" && incoming.evidenceRefs.length > 0)
      retained = incoming;
    else if (existing && existing.publishStatus !== incoming.publishStatus) {
      retained = this.createReceipt(
        task,
        task.deviceId,
        "blocked",
        "unknown",
        "available",
        "RECEIPT_CONFLICT",
        [...existing.evidenceRefs, ...incoming.evidenceRefs],
      );
    }
    this.receiptStore.save(retained);
    this.audit(
      task,
      "task.late_receipt",
      "accepted",
      retained.failureCode ?? "LATE_EVIDENCE_RECORDED",
      {
        publishStatus: retained.publishStatus,
      },
    );
    return structuredClone(retained);
  }

  public resumeBinding(
    bindingId: string,
    checks: {
      challengeResolved: boolean;
      authorizationValid: boolean;
      scheduleStillValid: boolean;
    },
  ): boolean {
    if (!checks.challengeResolved || !checks.authorizationValid || !checks.scheduleStillValid)
      return false;
    return this.pausedBindings.delete(bindingId);
  }

  private createReceipt(
    task: PublishTaskDirective,
    deviceId: string,
    executionStatus: ExecutionReceipt["executionStatus"],
    publishStatus: ExecutionReceipt["publishStatus"],
    resourceStatus: ExecutionReceipt["resourceStatus"],
    failureCode?: ExecutionReceipt["failureCode"],
    evidenceRefs: string[] = [],
  ): ExecutionReceipt {
    return {
      schemaVersion: "design-v1",
      eventId: this.nextId(),
      taskId: task.taskId,
      attemptId: task.attemptId,
      deviceId,
      accountId: task.accountId,
      occurredAt: this.now(),
      executionStatus,
      publishStatus,
      evidenceRefs: [...new Set(evidenceRefs)],
      failureCode,
      resourceStatus,
    };
  }

  private removeHead(task: PublishTaskDirective): void {
    this.queue.shift();
    this.queuedAttempts.delete(this.attemptKey(task.taskId, task.attemptId));
  }
  private attemptKey(taskId: string, attemptId: string): string {
    return `${taskId}:${attemptId}`;
  }
  private audit(
    task: PublishTaskDirective,
    action: string,
    result: ControllerAuditEntry["result"],
    reasonCode: string,
    facts: ControllerAuditEntry["facts"],
  ): void {
    const entry: ControllerAuditEntry = {
      occurredAt: this.now(),
      correlationId: `${task.taskId}:${task.attemptId}`,
      action,
      taskId: task.taskId,
      attemptId: task.attemptId,
      result,
      reasonCode,
      facts,
    };
    this.auditEntries.push(entry);
    this.dependencies.auditSink?.(structuredClone(entry));
  }
}
