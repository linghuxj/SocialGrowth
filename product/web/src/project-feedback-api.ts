import {
  projectFeedbackResponseSchema,
  uuidSchema,
  type ProjectFeedbackResponse,
} from "@socialgrowth/product-contracts";
import {
  captureOperatorWriteSession,
  OperatorWriteSessionChangedError,
  ProductApiError,
  readOperatorResource,
} from "./operator-api.js";

export class ProjectFeedbackApiError extends Error {
  constructor(readonly code: "FEEDBACK_INPUT_INVALID" | "FEEDBACK_RESPONSE_INVALID" | "FEEDBACK_UNAVAILABLE") {
    super(code);
  }
}

export async function readProjectFeedback(rawProjectId: string): Promise<ProjectFeedbackResponse> {
  const parsed = uuidSchema.safeParse(rawProjectId);
  if (!parsed.success) throw new ProjectFeedbackApiError("FEEDBACK_INPUT_INVALID");
  const projectId = parsed.data.toLowerCase();
  const checkSession = captureOperatorWriteSession();
  try {
    const response = await readOperatorResource(
      `/api/operator/projects/${projectId}/feedback`,
      projectFeedbackResponseSchema,
    );
    checkSession();
    if (response.projectId.toLowerCase() !== projectId) throw new ProjectFeedbackApiError("FEEDBACK_RESPONSE_INVALID");
    return response;
  } catch (error) {
    if (error instanceof ProjectFeedbackApiError || error instanceof ProductApiError || error instanceof OperatorWriteSessionChangedError) throw error;
    throw new ProjectFeedbackApiError("FEEDBACK_UNAVAILABLE");
  }
}
