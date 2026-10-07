import {
  businessPlanWorkflowResponseSchema,
  operatorAssistanceTodoDetailResponseSchema,
  uuidSchema,
  type BusinessPlanWorkflowResponse,
  type OperatorAssistanceTodoDetailResponse,
} from "@socialgrowth/product-contracts";
import {
  captureOperatorWriteSession,
  hasCsrfToken,
  OperatorWriteSessionChangedError,
  ProductApiError,
  readOperatorResource,
} from "./operator-api.js";

export class WorkflowApiError extends Error {
  constructor(readonly code: "WORKFLOW_INPUT_INVALID" | "WORKFLOW_RESPONSE_INVALID" | "WORKFLOW_UNAVAILABLE") {
    super(code);
  }
}

const sameId = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

export async function readProjectWorkflow(rawProjectId: string): Promise<BusinessPlanWorkflowResponse> {
  const parsed = uuidSchema.safeParse(rawProjectId);
  if (!parsed.success) throw new WorkflowApiError("WORKFLOW_INPUT_INVALID");
  const projectId = parsed.data.toLowerCase();
  const sameSession = captureOperatorWriteSession();
  try {
    sameSession();
    const response = await readOperatorResource(
      `/api/operator/projects/${projectId}/business-plan/workflow`,
      businessPlanWorkflowResponseSchema,
    );
    sameSession();
    if (!sameId(response.projectId, projectId)) throw new WorkflowApiError("WORKFLOW_RESPONSE_INVALID");
    return response;
  } catch (error) {
    if (error instanceof ProductApiError && error.status === 401) {
      try { sameSession(); } catch { if (hasCsrfToken()) throw new OperatorWriteSessionChangedError(); }
      throw error;
    }
    try { sameSession(); } catch { throw new OperatorWriteSessionChangedError(); }
    if (error instanceof WorkflowApiError || error instanceof ProductApiError || error instanceof OperatorWriteSessionChangedError) throw error;
    throw new WorkflowApiError("WORKFLOW_UNAVAILABLE");
  }
}

export async function readAssistanceTodoDetail(rawTodoId: string): Promise<OperatorAssistanceTodoDetailResponse> {
  const parsed = uuidSchema.safeParse(rawTodoId);
  if (!parsed.success) throw new WorkflowApiError("WORKFLOW_INPUT_INVALID");
  const todoId = parsed.data.toLowerCase();
  const sameSession = captureOperatorWriteSession();
  try {
    sameSession();
    const response = await readOperatorResource(
      `/api/operator/assistance-todos/${todoId}`,
      operatorAssistanceTodoDetailResponseSchema,
    );
    sameSession();
    if (!sameId(response.todo.todoId, todoId)) throw new WorkflowApiError("WORKFLOW_RESPONSE_INVALID");
    return response;
  } catch (error) {
    if (error instanceof ProductApiError && error.status === 401) {
      try { sameSession(); } catch { if (hasCsrfToken()) throw new OperatorWriteSessionChangedError(); }
      throw error;
    }
    try { sameSession(); } catch { throw new OperatorWriteSessionChangedError(); }
    if (error instanceof WorkflowApiError || error instanceof ProductApiError || error instanceof OperatorWriteSessionChangedError) throw error;
    throw new WorkflowApiError("WORKFLOW_UNAVAILABLE");
  }
}
