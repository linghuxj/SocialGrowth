import {
  contractVersion,
  idempotencyKeySchema,
  projectCycleConfigurationCommandReadResponseSchema,
  projectCycleConfigurationReadResponseSchema,
  saveProjectCycleConfigurationReceiptSchema,
  saveProjectCycleConfigurationRequestSchema,
  uuidSchema,
} from "@socialgrowth/product-contracts";
import type {
  ProjectCycleConfigurationCommandReadResponse,
  ProjectCycleConfigurationReadResponse,
  SaveProjectCycleConfigurationReceipt,
} from "@socialgrowth/product-contracts";
import {
  captureOperatorWriteSession,
  currentOperatorSessionContext,
  OperatorWriteSessionChangedError,
  prepareOperatorPost,
  ProductApiError,
  readOperatorResource,
  newIdempotencyKey,
} from "./operator-api.js";

export class ProjectCycleConfigurationApiError extends Error {
  constructor(readonly code: "CYCLE_CONFIG_INPUT_INVALID" | "CYCLE_CONFIG_RESPONSE_INVALID" | "CYCLE_CONFIG_UNAVAILABLE") {
    super(code);
  }
}

function projectIdOf(value: unknown): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) throw new ProjectCycleConfigurationApiError("CYCLE_CONFIG_INPUT_INVALID");
  return parsed.data.toLowerCase();
}

function sameId(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function preserveApiError(error: unknown): never {
  if (error instanceof ProjectCycleConfigurationApiError || error instanceof ProductApiError
    || error instanceof OperatorWriteSessionChangedError) throw error;
  throw new ProjectCycleConfigurationApiError("CYCLE_CONFIG_UNAVAILABLE");
}

function validateRead(view: ProjectCycleConfigurationReadResponse, projectId: string): void {
  if (!sameId(view.projectId, projectId) || view.executionAllowed || view.publicationAllowed || view.nextCycle !== null) {
    throw new ProjectCycleConfigurationApiError("CYCLE_CONFIG_RESPONSE_INVALID");
  }
  if (view.nextConfiguration && (view.nextConfiguration.configurationRevision !== view.configurationRevision
    || (view.currentCycle && (!sameId(view.nextConfiguration.basedOnCycleId, view.currentCycle.cycleId)
      || Date.parse(view.nextConfiguration.effectiveStartsAt) !== Date.parse(view.currentCycle.endsAt))))) {
    throw new ProjectCycleConfigurationApiError("CYCLE_CONFIG_RESPONSE_INVALID");
  }
}

export async function readProjectCycleConfiguration(rawProjectId: unknown): Promise<ProjectCycleConfigurationReadResponse> {
  const projectId = projectIdOf(rawProjectId);
  const checkSession = captureOperatorWriteSession();
  try {
    const view = await readOperatorResource(
      `/api/operator/projects/${projectId}/review-cycle-config`,
      projectCycleConfigurationReadResponseSchema,
    );
    checkSession();
    validateRead(view, projectId);
    return view;
  } catch (error) {
    return preserveApiError(error);
  }
}

export async function readProjectCycleConfigurationCommand(
  rawProjectId: unknown,
  rawIdempotencyKey: unknown,
): Promise<ProjectCycleConfigurationCommandReadResponse> {
  const projectId = projectIdOf(rawProjectId);
  const key = idempotencyKeySchema.safeParse(rawIdempotencyKey);
  if (!key.success) throw new ProjectCycleConfigurationApiError("CYCLE_CONFIG_INPUT_INVALID");
  const checkSession = captureOperatorWriteSession();
  try {
    const view = await readOperatorResource(
      `/api/operator/projects/${projectId}/review-cycle-config/commands/${encodeURIComponent(key.data)}`,
      projectCycleConfigurationCommandReadResponseSchema,
    );
    checkSession();
    if (!sameId(view.projectId, projectId) || (view.receipt && !sameId(view.receipt.projectId, projectId))) {
      throw new ProjectCycleConfigurationApiError("CYCLE_CONFIG_RESPONSE_INVALID");
    }
    return view;
  } catch (error) {
    return preserveApiError(error);
  }
}

export class PreparedProjectCycleConfiguration {
  readonly projectId: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly body: string;
  readonly expectedConfigurationRevision: number;
  #send: () => Promise<SaveProjectCycleConfigurationReceipt>;
  #checkSession: () => void;

  constructor(rawProjectId: unknown, raw: unknown, frozenBody?: string) {
    this.projectId = projectIdOf(rawProjectId);
    const input = frozenBody === undefined
      ? { ...(raw && typeof raw === "object" ? raw : {}), metadata: { contractVersion, requestId: `request-${crypto.randomUUID()}`, idempotencyKey: newIdempotencyKey() } }
      : raw;
    const parsed = saveProjectCycleConfigurationRequestSchema.safeParse(input);
    if (!parsed.success) throw new ProjectCycleConfigurationApiError("CYCLE_CONFIG_INPUT_INVALID");
    const command = { ...parsed.data };
    this.requestId = command.metadata.requestId;
    this.idempotencyKey = command.metadata.idempotencyKey;
    this.body = frozenBody ?? JSON.stringify(command);
    this.expectedConfigurationRevision = command.expectedConfigurationRevision;
    this.#checkSession = captureOperatorWriteSession();
    this.#send = prepareOperatorPost(
      `/api/operator/projects/${this.projectId}/review-cycle-config`,
      this.body,
      saveProjectCycleConfigurationReceiptSchema,
    );
  }

  static fromFrozen(projectId: unknown, raw: unknown): PreparedProjectCycleConfiguration {
    if (typeof raw !== "string") throw new ProjectCycleConfigurationApiError("CYCLE_CONFIG_INPUT_INVALID");
    let body: unknown;
    try { body = JSON.parse(raw); } catch { throw new ProjectCycleConfigurationApiError("CYCLE_CONFIG_INPUT_INVALID"); }
    return new PreparedProjectCycleConfiguration(projectId, body, raw);
  }

  async send(): Promise<SaveProjectCycleConfigurationReceipt> {
    try {
      this.#checkSession();
      const receipt = await this.#send();
      this.#checkSession();
      if (!sameId(receipt.projectId, this.projectId) || receipt.requestId !== this.requestId
        || receipt.executionAllowed || receipt.publicationAllowed) {
        throw new ProjectCycleConfigurationApiError("CYCLE_CONFIG_RESPONSE_INVALID");
      }
      if (receipt.nextConfiguration
        && receipt.nextConfiguration.configurationRevision !== receipt.configurationRevision) {
        throw new ProjectCycleConfigurationApiError("CYCLE_CONFIG_RESPONSE_INVALID");
      }
      if (receipt.outcome === "confirmed" && (receipt.configurationRevision <= this.expectedConfigurationRevision
        || receipt.nextConfiguration?.requestId !== this.requestId
        || receipt.nextConfiguration.configurationRevision !== receipt.configurationRevision)) {
        throw new ProjectCycleConfigurationApiError("CYCLE_CONFIG_RESPONSE_INVALID");
      }
      if (receipt.outcome === "unchanged" && receipt.configurationRevision !== this.expectedConfigurationRevision) {
        throw new ProjectCycleConfigurationApiError("CYCLE_CONFIG_RESPONSE_INVALID");
      }
      return receipt;
    } catch (error) {
      return preserveApiError(error);
    }
  }
}

export type PersistedProjectCycleConfiguration = {
  projectId: string;
  operatorId: string;
  sessionId: string;
  idempotencyKey: string;
  body: string;
};
export type ProjectCycleConfigurationPendingRead =
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "valid"; value: PersistedProjectCycleConfiguration };

function pendingStorageKey(projectId: string): string {
  return `socialgrowth.project-cycle-config.pending.${projectId.toLowerCase()}`;
}

export function persistProjectCycleConfigurationPending(
  command: PreparedProjectCycleConfiguration,
  context: ReturnType<typeof currentOperatorSessionContext>,
): boolean {
  if (!context) return false;
  try {
    const stored = {
      version: 1,
      projectId: command.projectId,
      operatorId: context.operatorId,
      sessionId: context.sessionId,
      idempotencyKey: command.idempotencyKey,
      body: command.body,
    };
    sessionStorage.setItem(pendingStorageKey(command.projectId), JSON.stringify(stored));
    const check = readProjectCycleConfigurationPending(command.projectId);
    return check.status === "valid" && check.value.body === command.body
      && check.value.idempotencyKey === command.idempotencyKey && sameId(check.value.operatorId, context.operatorId)
      && sameId(check.value.sessionId, context.sessionId);
  } catch { return false; }
}

export function readProjectCycleConfigurationPending(rawProjectId: unknown): ProjectCycleConfigurationPendingRead {
  const projectId = projectIdOf(rawProjectId);
  let raw: string | null;
  try { raw = sessionStorage.getItem(pendingStorageKey(projectId)); } catch { return { status: "invalid" }; }
  if (raw === null) return { status: "missing" };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { status: "invalid" };
    const record = value as Record<string, unknown>;
    if (Object.keys(record).sort().join(",") !== "body,idempotencyKey,operatorId,projectId,sessionId,version" || record.version !== 1
      || typeof record.body !== "string" || typeof record.idempotencyKey !== "string") return { status: "invalid" };
    const parsedProject = uuidSchema.safeParse(record.projectId), operatorId = uuidSchema.safeParse(record.operatorId), sessionId = uuidSchema.safeParse(record.sessionId);
    if (!parsedProject.success || !operatorId.success || !sessionId.success || !sameId(parsedProject.data, projectId)) return { status: "invalid" };
    const parsedKey = idempotencyKeySchema.safeParse(record.idempotencyKey);
    const body: unknown = JSON.parse(record.body);
    const parsedBody = saveProjectCycleConfigurationRequestSchema.safeParse(body);
    if (!parsedKey.success || !parsedBody.success || parsedBody.data.metadata.idempotencyKey !== parsedKey.data) return { status: "invalid" };
    return { status: "valid", value: {
      projectId: parsedProject.data.toLowerCase(), operatorId: operatorId.data.toLowerCase(), sessionId: sessionId.data.toLowerCase(),
      idempotencyKey: parsedKey.data, body: record.body,
    } };
  } catch { return { status: "invalid" }; }
}

export function clearProjectCycleConfigurationPending(projectId: unknown, idempotencyKey: unknown): boolean {
  const normalizedProject = projectIdOf(projectId);
  const key = idempotencyKeySchema.safeParse(idempotencyKey);
  if (!key.success) return false;
  const current = readProjectCycleConfigurationPending(normalizedProject);
  if (current.status === "missing") return true;
  if (current.status !== "valid" || current.value.idempotencyKey !== key.data) return false;
  try { sessionStorage.removeItem(pendingStorageKey(normalizedProject)); return sessionStorage.getItem(pendingStorageKey(normalizedProject)) === null; }
  catch { return false; }
}
