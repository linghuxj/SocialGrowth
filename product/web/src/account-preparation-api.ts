import { accountPreparationWorkspaceSchema, requestAccountPreparationSchema, recheckAccountPreparationSchema,
  reviewAccountPreparationExecutionSchema,
  uuidSchema, type AccountPreparationWorkspace } from "@socialgrowth/product-contracts";
import { captureOperatorWriteSession, prepareOperatorPost, readOperatorResource } from "./operator-api.js";
const belongs = (v: AccountPreparationWorkspace, id: string) => {
  const taskIds = new Set(v.tasks.map(t => t.taskId.toLowerCase()));
  if (v.projectId.toLowerCase() !== id.toLowerCase() || v.tasks.some(t => t.projectId.toLowerCase() !== id.toLowerCase())
    || v.executionReviews.some(r => r.projectId.toLowerCase() !== id.toLowerCase() || !taskIds.has(r.taskId.toLowerCase()))
    || v.originalOperations.some(o => !taskIds.has(o.taskId.toLowerCase()))) throw new Error("PREPARATION_RESPONSE_INVALID");
  return v;
};
export async function readAccountPreparation(id: string) {
  uuidSchema.parse(id); const check = captureOperatorWriteSession(); check();
  const value = await readOperatorResource(`/api/operator/projects/${id.toLowerCase()}/account-preparation`, accountPreparationWorkspaceSchema);
  check(); return belongs(value, id);
}
export class PreparedAccountPreparation {
  private readonly sendOriginal: () => Promise<AccountPreparationWorkspace>;
  constructor(kind: "request" | "recheck" | "execution-review", raw: unknown) {
    const r = kind === "request" ? requestAccountPreparationSchema.parse(raw)
      : kind === "recheck" ? recheckAccountPreparationSchema.parse(raw) : reviewAccountPreparationExecutionSchema.parse(raw);
    this.sendOriginal = prepareOperatorPost(`/api/operator/projects/${r.projectId.toLowerCase()}/account-preparation/${kind}`, JSON.stringify(r), {
      parse: rawResponse => {
        const value = belongs(accountPreparationWorkspaceSchema.parse(rawResponse), r.projectId);
        const task = "intent" in r ? value.tasks.find(t => JSON.stringify(t.intent) === JSON.stringify(r.intent))
          : kind === "execution-review" ? value.executionReviews.find(v => v.taskId.toLowerCase() === r.taskId.toLowerCase() && v.taskVersion >= r.expectedTaskVersion)
            : value.tasks.find(t => t.taskId.toLowerCase() === r.taskId.toLowerCase() && t.taskVersion > r.expectedTaskVersion);
        if (!task) throw new Error("PREPARATION_RESPONSE_INVALID"); return value;
      },
    });
  }
  send() { return this.sendOriginal(); }
}
