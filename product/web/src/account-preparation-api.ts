import { accountPreparationWorkspaceSchema, requestAccountPreparationSchema, recheckAccountPreparationSchema,
  uuidSchema, type AccountPreparationWorkspace } from "@socialgrowth/product-contracts";
import { captureOperatorWriteSession, prepareOperatorPost, readOperatorResource } from "./operator-api.js";
const belongs = (v: AccountPreparationWorkspace, id: string) => {
  if (v.projectId.toLowerCase() !== id.toLowerCase() || v.tasks.some(t => t.projectId.toLowerCase() !== id.toLowerCase())) throw new Error("PREPARATION_RESPONSE_INVALID");
  return v;
};
export async function readAccountPreparation(id: string) {
  uuidSchema.parse(id); const check = captureOperatorWriteSession(); check();
  const value = await readOperatorResource(`/api/operator/projects/${id.toLowerCase()}/account-preparation`, accountPreparationWorkspaceSchema);
  check(); return belongs(value, id);
}
export class PreparedAccountPreparation {
  private readonly sendOriginal: () => Promise<AccountPreparationWorkspace>;
  constructor(kind: "request" | "recheck", raw: unknown) {
    const r = kind === "request" ? requestAccountPreparationSchema.parse(raw) : recheckAccountPreparationSchema.parse(raw);
    this.sendOriginal = prepareOperatorPost(`/api/operator/projects/${r.projectId.toLowerCase()}/account-preparation/${kind}`, JSON.stringify(r), {
      parse: rawResponse => {
        const value = belongs(accountPreparationWorkspaceSchema.parse(rawResponse), r.projectId);
        const task = "intent" in r ? value.tasks.find(t => JSON.stringify(t.intent) === JSON.stringify(r.intent)) : value.tasks.find(t => t.taskId.toLowerCase() === r.taskId.toLowerCase() && t.taskVersion > r.expectedTaskVersion);
        if (!task) throw new Error("PREPARATION_RESPONSE_INVALID"); return value;
      },
    });
  }
  send() { return this.sendOriginal(); }
}
