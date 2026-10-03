import { arrangeBusinessPlanRequestSchema, arrangeBusinessPlanResponseSchema, readBusinessPlanResponseSchema, uuidSchema,
  type BusinessPlanCurrentView } from "@socialgrowth/product-contracts";
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
