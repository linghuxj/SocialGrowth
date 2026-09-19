export type PlatformType = "facebook" | "instagram" | "youtube";
export type DeviceStatus = "idle" | "busy" | "offline" | "error";

export interface DeviceInfo {
  deviceId: string;
  deviceType: "physical";
  model: string;
  platformBound: PlatformType[];
  boundAccounts: string[];
  status: DeviceStatus;
  batteryLevel?: number;
  lastHeartbeat: string;
}

export interface AutomationStep {
  stepIndex: number;
  action: "open_app" | "navigate" | "click" | "input_text" | "select_media" | "scroll" | "wait";
  targetSelector?: string;
  coordinates?: { x: number; y: number };
  value?: string;
  timeoutMs?: number;
}

export interface PublishTaskDirective {
  schemaVersion: "design-v1";
  taskId: string;
  attemptId: string;
  projectId: string;
  strategyVersionId: string;
  approvalId: string;
  bindingId: string;
  deviceId: string;
  accountId: string;
  platform: PlatformType;
  targetAppPackage: string;
  contentIdentityId: string;
  sliceId: string;
  media: { url: string; sha256: string; expiresAt: string };
  captionText: string;
  destinationVersionId: string;
  shortLinkUrl?: string;
  scheduledAt: string;
  expiresAt: string;
  timeZone: string;
  steps: AutomationStep[];
  taskTimeoutMs: number;
}

export type ExecutionStatus = "accepted" | "running" | "blocked" | "completed" | "failed";
export type ReceiptPublishStatus =
  | "not_submitted"
  | "in_progress"
  | "unknown"
  | "confirmed_not_published"
  | "published";

export interface ExecutionReceipt {
  schemaVersion: "design-v1";
  eventId: string;
  taskId: string;
  attemptId: string;
  deviceId: string;
  accountId: string;
  occurredAt: string;
  executionStatus: ExecutionStatus;
  publishStatus: ReceiptPublishStatus;
  evidenceRefs: string[];
  publishedUrl?: string;
  publishedPostId?: string;
  failureCode?:
    | "EXECUTOR_NOT_CONFIGURED"
    | "DEVICE_UNAVAILABLE"
    | "IDENTITY_CHALLENGE"
    | "TECHNICAL_FAILURE"
    | "DEADLINE_EXPIRED"
    | "RECEIPT_CONFLICT";
  challengeType?: string;
  resourceStatus: "available" | "busy" | "offline" | "error";
}

export interface ExecutionAdapter {
  execute(task: PublishTaskDirective, device: DeviceInfo): Promise<ExecutionReceipt>;
}

export interface ReceiptStore {
  get(taskId: string, attemptId: string): ExecutionReceipt | undefined;
  save(receipt: ExecutionReceipt): void;
}

export interface ControllerAuditEntry {
  occurredAt: string;
  correlationId: string;
  action: string;
  taskId: string;
  attemptId: string;
  result: "accepted" | "rejected" | "waiting";
  reasonCode: string;
  facts: Record<string, string | number | boolean | null>;
}
