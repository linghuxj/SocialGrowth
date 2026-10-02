import { confirmProjectDirectionRequestSchema, generateProjectDirectionRequestSchema, projectDirectionResponseSchema, uuidSchema, type ProjectDirectionView } from "@socialgrowth/product-contracts";
import { captureOperatorWriteSession, prepareOperatorPost, readOperatorResource } from "./operator-api.js";
const belongs = (value: ProjectDirectionView, id: string) => {
  if (value.projectId.toLowerCase() !== id.toLowerCase()) throw new Error("DIRECTION_RESPONSE_INVALID");
  return value;
};
export async function readProjectDirection(id: string) {
  uuidSchema.parse(id); const session = captureOperatorWriteSession(); session();
  const value = await readOperatorResource(`/api/operator/projects/${id.toLowerCase()}/direction`, projectDirectionResponseSchema);
  session(); return belongs(value, id);
}
export class PreparedDirectionRequest {
  private readonly sendOriginal: () => Promise<ProjectDirectionView>;
  constructor(kind: "generate" | "confirm", raw: unknown) {
    const value = kind === "generate" ? generateProjectDirectionRequestSchema.parse(raw) : confirmProjectDirectionRequestSchema.parse(raw);
    this.sendOriginal = prepareOperatorPost(`/api/operator/projects/${value.projectId.toLowerCase()}/direction/${kind}`, JSON.stringify(value), {
      parse: response => {
        const result = belongs(projectDirectionResponseSchema.parse(response), value.projectId);
        if (result.projectVersion < value.expectedProjectVersion || (kind === "generate" && !result.attempt)) throw new Error("DIRECTION_RESPONSE_INVALID");
        if ("proposalId" in value && (!result.approval || result.approval.proposal.proposalId.toLowerCase() !== value.proposalId.toLowerCase()
          || result.approval.proposal.snapshotDigest !== value.snapshotDigest)) throw new Error("DIRECTION_RESPONSE_INVALID");
        return result;
      },
    });
  }
  send() { return this.sendOriginal(); }
}
