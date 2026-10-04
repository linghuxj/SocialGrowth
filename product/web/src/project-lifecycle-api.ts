import {
  contractVersion,
  businessPlanCurrentChecksResponseSchema,
  projectLifecycleIntentViewSchema,
  updateProjectLifecycleIntentRequestSchema,
  updateProjectLifecycleIntentResponseSchema,
  uuidSchema,
  withdrawMaterialRequestSchema,
  withdrawMaterialResponseSchema,
} from "@socialgrowth/product-contracts";
import {
  captureOperatorWriteSession,
  OperatorWriteSessionChangedError,
  prepareOperatorPost,
  ProductApiError,
  readOperatorResource,
  newIdempotencyKey,
} from "./operator-api.js";

type ProjectLifecycleCommand = "pause" | "resume" | "end";
export type ProjectLifecycleIntentView = ReturnType<typeof projectLifecycleIntentViewSchema.parse>;
export type ProjectCurrentChecksView = ReturnType<typeof businessPlanCurrentChecksResponseSchema.parse>;
type UpdateProjectLifecycleIntentResponse = ReturnType<typeof updateProjectLifecycleIntentResponseSchema.parse>;
type WithdrawMaterialResponse = ReturnType<typeof withdrawMaterialResponseSchema.parse>;

export class ProjectLifecycleApiError extends Error {
  constructor(readonly code:
    | "LIFECYCLE_INPUT_INVALID"
    | "LIFECYCLE_RESPONSE_INVALID"
    | "LIFECYCLE_UNAVAILABLE") {
    super(code);
  }
}

function projectIdOf(value: unknown): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) throw new ProjectLifecycleApiError("LIFECYCLE_INPUT_INVALID");
  return parsed.data.toLowerCase();
}

function sameId(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function preserveApiError(error: unknown): never {
  if (error instanceof ProjectLifecycleApiError || error instanceof ProductApiError
    || error instanceof OperatorWriteSessionChangedError) throw error;
  throw new ProjectLifecycleApiError("LIFECYCLE_UNAVAILABLE");
}

export async function readProjectLifecycleIntent(rawProjectId: string): Promise<ProjectLifecycleIntentView> {
  const projectId = projectIdOf(rawProjectId);
  const checkSession = captureOperatorWriteSession();
  try {
    const view = await readOperatorResource(
      `/api/operator/projects/${projectId}/lifecycle-intents`,
      projectLifecycleIntentViewSchema,
    );
    checkSession();
    if (!sameId(view.projectId, projectId)) throw new ProjectLifecycleApiError("LIFECYCLE_RESPONSE_INVALID");
    return view;
  } catch (error) {
    return preserveApiError(error);
  }
}

export async function readProjectCurrentChecks(rawProjectId: string): Promise<ProjectCurrentChecksView> {
  const projectId = projectIdOf(rawProjectId);
  const checkSession = captureOperatorWriteSession();
  try {
    const view = await readOperatorResource(
      `/api/operator/projects/${projectId}/business-plan/current-checks`,
      businessPlanCurrentChecksResponseSchema,
    );
    checkSession();
    if (!sameId(view.projectId, projectId) || view.executionAllowed || view.publicationAllowed) {
      throw new ProjectLifecycleApiError("LIFECYCLE_RESPONSE_INVALID");
    }
    return view;
  } catch (error) {
    return preserveApiError(error);
  }
}

function commandMetadata() {
  return { contractVersion, requestId: crypto.randomUUID(), idempotencyKey: newIdempotencyKey() };
}

export class PreparedProjectLifecycleIntent {
  readonly projectId: string;
  readonly expectedLifecycleRevision: number;
  readonly intent: ProjectLifecycleCommand;
  readonly requestId: string;
  #send: () => Promise<UpdateProjectLifecycleIntentResponse>;
  #checkSession: () => void;

  constructor(rawProjectId: unknown, expectedLifecycleRevision: unknown, intent: unknown) {
    this.projectId = projectIdOf(rawProjectId);
    const command = updateProjectLifecycleIntentRequestSchema.safeParse({
      metadata: commandMetadata(), expectedLifecycleRevision, intent,
    });
    if (!command.success) throw new ProjectLifecycleApiError("LIFECYCLE_INPUT_INVALID");
    this.expectedLifecycleRevision = command.data.expectedLifecycleRevision;
    this.intent = command.data.intent;
    this.requestId = command.data.metadata.requestId;
    this.#checkSession = captureOperatorWriteSession();
    this.#send = prepareOperatorPost(
      `/api/operator/projects/${this.projectId}/lifecycle-intents`,
      JSON.stringify(command.data),
      updateProjectLifecycleIntentResponseSchema,
    );
  }

  async send(): Promise<UpdateProjectLifecycleIntentResponse> {
    try {
      this.#checkSession();
      const response = await this.#send();
      this.#checkSession();
      const expectedIntent = `${this.intent}_requested` as UpdateProjectLifecycleIntentResponse["intent"];
      if (!sameId(response.projectId, this.projectId) || response.intent !== expectedIntent
        || response.requestId !== this.requestId || response.lifecycleRevision < this.expectedLifecycleRevision
        || (response.changed && response.lifecycleRevision <= this.expectedLifecycleRevision)
        || (response.changed && response.replayed)) {
        throw new ProjectLifecycleApiError("LIFECYCLE_RESPONSE_INVALID");
      }
      return response;
    } catch (error) {
      return preserveApiError(error);
    }
  }
}

export class PreparedMaterialWithdrawal {
  readonly projectId: string;
  readonly variantId: string;
  readonly expectedMaterialRevision: number;
  readonly requestId: string;
  #send: () => Promise<WithdrawMaterialResponse>;
  #checkSession: () => void;

  constructor(rawProjectId: unknown, rawVariantId: unknown, expectedMaterialRevision: unknown) {
    this.projectId = projectIdOf(rawProjectId);
    this.variantId = projectIdOf(rawVariantId);
    const command = withdrawMaterialRequestSchema.safeParse({
      metadata: commandMetadata(), expectedMaterialRevision,
    });
    if (!command.success) throw new ProjectLifecycleApiError("LIFECYCLE_INPUT_INVALID");
    this.expectedMaterialRevision = command.data.expectedMaterialRevision;
    this.requestId = command.data.metadata.requestId;
    this.#checkSession = captureOperatorWriteSession();
    this.#send = prepareOperatorPost(
      `/api/operator/projects/${this.projectId}/materials/${this.variantId}/withdrawal`,
      JSON.stringify(command.data),
      withdrawMaterialResponseSchema,
    );
  }

  async send(): Promise<WithdrawMaterialResponse> {
    try {
      this.#checkSession();
      const response = await this.#send();
      this.#checkSession();
      if (!sameId(response.projectId, this.projectId) || !sameId(response.variantId, this.variantId)
        || response.materialRevision !== this.expectedMaterialRevision || response.requestId !== this.requestId
        || (response.changed && response.replayed)) {
        throw new ProjectLifecycleApiError("LIFECYCLE_RESPONSE_INVALID");
      }
      return response;
    } catch (error) {
      return preserveApiError(error);
    }
  }
}
