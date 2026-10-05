import { arrangeBusinessPlanRequestSchema, arrangeBusinessPlanResponseSchema, readBusinessPlanResponseSchema, uuidSchema,
  createBusinessPlanTaskAttemptRequestSchema, createBusinessPlanTaskAttemptResponseSchema,
  businessPlanWorkflowResponseSchema, type BusinessPlanCurrentView, type BusinessPlanWorkflowResponse } from "@socialgrowth/product-contracts";
import { captureOperatorWriteSession, OperatorWriteSessionChangedError, ProductApiError, prepareOperatorPost, readOperatorResource } from "./operator-api.js";

export class BusinessPlanClientError extends Error {
  constructor(readonly code: "BUSINESS_PLAN_INPUT_INVALID" | "BUSINESS_PLAN_RESPONSE_INVALID" | "BUSINESS_PLAN_UNAVAILABLE") { super(code); }
}
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function path(id: string) { return `/api/operator/projects/${id.toLowerCase()}/business-plan`; }
export async function readBusinessPlan(rawProjectId: string): Promise<BusinessPlanCurrentView> {
  const parsed = uuidSchema.safeParse(rawProjectId); if (!parsed.success) throw new BusinessPlanClientError("BUSINESS_PLAN_INPUT_INVALID");
  const session = captureOperatorWriteSession(); session();
  try {
    const view = await readOperatorResource(path(parsed.data), readBusinessPlanResponseSchema);
    session(); if (!sameId(view.projectId, parsed.data)) throw new BusinessPlanClientError("BUSINESS_PLAN_RESPONSE_INVALID");
    return view;
  } catch (error) {
    if (error instanceof BusinessPlanClientError || error instanceof ProductApiError || error instanceof OperatorWriteSessionChangedError) throw error;
    throw new BusinessPlanClientError("BUSINESS_PLAN_UNAVAILABLE");
  }
}
export async function readBusinessPlanWorkflow(rawProjectId: string): Promise<BusinessPlanWorkflowResponse> {
  const project = uuidSchema.safeParse(rawProjectId); if (!project.success) throw new BusinessPlanClientError("BUSINESS_PLAN_INPUT_INVALID");
  const session = captureOperatorWriteSession(); session();
  const result = await readOperatorResource(`${path(project.data)}/workflow`, businessPlanWorkflowResponseSchema);
  session(); if (!sameId(result.projectId, project.data)) throw new BusinessPlanClientError("BUSINESS_PLAN_RESPONSE_INVALID");
  return result;
}
export async function queryBusinessPlanPreflight(projectId: string, taskId: string): Promise<BusinessPlanWorkflowResponse> {
  const project = uuidSchema.safeParse(projectId), task = uuidSchema.safeParse(taskId);
  if (!project.success || !task.success) throw new BusinessPlanClientError("BUSINESS_PLAN_INPUT_INVALID");
  const session = captureOperatorWriteSession(); session();
  const result = await readOperatorResource(`${path(project.data)}/tasks/${task.data}/preflight`, businessPlanWorkflowResponseSchema);
  session(); if (!sameId(result.projectId, project.data)) throw new BusinessPlanClientError("BUSINESS_PLAN_RESPONSE_INVALID");
  return result;
}
export function startBusinessPlanPreflight(projectId: string, taskId: string) {
  const project = uuidSchema.safeParse(projectId), task = uuidSchema.safeParse(taskId);
  if (!project.success || !task.success) throw new BusinessPlanClientError("BUSINESS_PLAN_INPUT_INVALID");
  const session = captureOperatorWriteSession();
  return prepareOperatorPost(`${path(project.data)}/tasks/${task.data}/preflight`, JSON.stringify({}), { parse(response: unknown) {
    session();
    if (!response || typeof response !== "object" || !("taskId" in response) || !sameId(String((response as { taskId: unknown }).taskId), task.data)
      || !("state" in response) || !["blocked","queued","claimed","running","submission_unknown","prepared","verified","not_published","failed"].includes(String((response as { state: unknown }).state))) {
      throw new BusinessPlanClientError("BUSINESS_PLAN_RESPONSE_INVALID");
    }
    return response as { taskId: string; state: string; operationId: string | null };
  } });
}
export function createBusinessPlanTaskAttempt(projectId: string, taskId: string, planRevision: number, taskRevision: number) {
  const project = uuidSchema.safeParse(projectId), task = uuidSchema.safeParse(taskId);
  if (!project.success || !task.success) throw new BusinessPlanClientError("BUSINESS_PLAN_INPUT_INVALID");
  const request = createBusinessPlanTaskAttemptRequestSchema.parse({ metadata: { contractVersion: "2026-09-29.identity-v1",
    requestId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() }, expectedPlanRevision: planRevision, expectedTaskRevision: taskRevision });
  const session = captureOperatorWriteSession();
  return prepareOperatorPost(`${path(project.data)}/tasks/${task.data}/attempts`, JSON.stringify(request), { parse(response: unknown) {
    session();
    const parsed = createBusinessPlanTaskAttemptResponseSchema.safeParse(response);
    if (!parsed.success || !sameId(parsed.data.projectId, project.data) || !sameId(parsed.data.taskId, task.data)) {
      throw new BusinessPlanClientError("BUSINESS_PLAN_RESPONSE_INVALID");
    }
    return parsed.data;
  } });
}
export class PreparedBusinessPlanArrange {
  readonly request: ReturnType<typeof arrangeBusinessPlanRequestSchema.parse>;
  readonly #send: () => Promise<ReturnType<typeof arrangeBusinessPlanResponseSchema.parse>>;
  constructor(rawProjectId: string, raw: unknown) {
    const project = uuidSchema.safeParse(rawProjectId);
    const request = arrangeBusinessPlanRequestSchema.safeParse(raw);
    if (!project.success || !request.success) throw new BusinessPlanClientError("BUSINESS_PLAN_INPUT_INVALID");
    this.request = request.data;
    this.#send = prepareOperatorPost(path(project.data), JSON.stringify(request.data), { parse(response: unknown) {
      const parsed = arrangeBusinessPlanResponseSchema.safeParse(response);
      if (!parsed.success || !sameId(parsed.data.projectId, project.data)
        || parsed.data.currentScope.projectVersion < request.data.expectedProjectVersion
        || (parsed.data.plan && parsed.data.plan.revision < Math.max(1, request.data.expectedPlanRevision))
        || parsed.data.requestId !== request.data.metadata.requestId) throw new BusinessPlanClientError("BUSINESS_PLAN_RESPONSE_INVALID");
      return parsed.data;
    } });
  }
  send() { return this.#send(); }
}
