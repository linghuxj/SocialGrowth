import { projectPlanningResponseSchema, saveProjectPlanningRequestSchema, uuidSchema, type ProjectPlanningDraftView, type ProjectPlanningInputs } from "@socialgrowth/product-contracts";
import { captureOperatorWriteSession, OperatorWriteSessionChangedError, ProductApiError, prepareOperatorPost, readOperatorResource } from "./operator-api.js";
export class PlanningClientError extends Error {
  constructor(readonly code: "PLANNING_INPUT_INVALID" | "PLANNING_RESPONSE_INVALID" | "PLANNING_UNAVAILABLE") { super(code); }
}
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export async function readPlanningDraft(rawProjectId: string): Promise<ProjectPlanningDraftView> {
  const parsed = uuidSchema.safeParse(rawProjectId); if (!parsed.success) throw new PlanningClientError("PLANNING_INPUT_INVALID");
  const check = captureOperatorWriteSession(); check();
  try {
    const value = await readOperatorResource(`/api/operator/projects/${parsed.data.toLowerCase()}/planning-draft`, projectPlanningResponseSchema);
    check(); if (!sameId(value.draft.projectId, parsed.data)) throw new PlanningClientError("PLANNING_RESPONSE_INVALID");
    return value.draft;
  } catch (e) {
    if (e instanceof PlanningClientError || e instanceof ProductApiError || e instanceof OperatorWriteSessionChangedError) throw e;
    throw new PlanningClientError("PLANNING_UNAVAILABLE");
  }
}
export class PreparedPlanningDraft {
  #send: () => Promise<ProjectPlanningDraftView>;
  constructor(raw: unknown) {
    const p = saveProjectPlanningRequestSchema.safeParse(raw); if (!p.success) throw new PlanningClientError("PLANNING_INPUT_INVALID");
    const r = p.data;
    this.#send = prepareOperatorPost(`/api/operator/projects/${r.projectId.toLowerCase()}/planning-draft`, JSON.stringify(r), { parse(rawResponse: unknown) {
      const response = projectPlanningResponseSchema.safeParse(rawResponse);
      if (!response.success || !sameId(response.data.draft.projectId, r.projectId)
        || response.data.draft.projectFactVersion < r.expectedProjectVersion || response.data.draft.draftVersion < Math.max(1, r.expectedDraftVersion)) throw new PlanningClientError("PLANNING_RESPONSE_INVALID");
      // Backend original-key replay returns CURRENT draft, not an immutable
      // receipt of the original inputs. UI must compare before replacing input.
      return response.data.draft;
    } });
  }
  async send(): Promise<ProjectPlanningDraftView> {
    try { return await this.#send(); }
    catch (e) {
      if (e instanceof PlanningClientError || e instanceof ProductApiError || e instanceof OperatorWriteSessionChangedError) throw e;
      throw new PlanningClientError("PLANNING_UNAVAILABLE");
    }
  }
}
export function samePlanningInputs(a: ProjectPlanningInputs, b: ProjectPlanningInputs): boolean {
  const canonical = (v: ProjectPlanningInputs) => JSON.stringify({ ...v, targetCountries: [...v.targetCountries].sort(), targetLanguages: [...v.targetLanguages].sort(), contentForms: [...v.contentForms].sort() });
  return canonical(a) === canonical(b);
}
