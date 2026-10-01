import { uuidSchema, prepareMaterialUploadRequestSchema, prepareMaterialUploadResponseSchema, materialUploadTicketViewSchema } from "@socialgrowth/product-contracts";
import { ProductApiError, OperatorWriteSessionChangedError, prepareOperatorPost, readOperatorResource } from "./operator-api.js";
export type MaterialUploadTicket = ReturnType<typeof materialUploadTicketViewSchema.parse>;
export type MaterialUploadPreparation = ReturnType<typeof prepareMaterialUploadResponseSchema.parse>;
// Existing backend HTTP transport guard, not the object's universal limit or
// proof of production browser capacity. The shared object schema allows 128MiB.
export const materialUploadHTTPMaxBytes = 16 * 1024 * 1024;
export class MaterialUploadClientError extends Error {
  constructor(readonly code: "MATERIAL_UPLOAD_CLIENT_INVALID" | "MATERIAL_UPLOAD_CLIENT_PROTOCOL_INVALID" | "MATERIAL_UPLOAD_CLIENT_UNAVAILABLE") { super(code); }
}
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function parse<T>(schema: { parse(value: unknown): T }, value: unknown, code: "MATERIAL_UPLOAD_CLIENT_INVALID" | "MATERIAL_UPLOAD_CLIENT_PROTOCOL_INVALID"): T {
  try { return schema.parse(value); } catch { throw new MaterialUploadClientError(code); }
}
async function safe<T>(call: () => Promise<T>): Promise<T> {
  try { return await call(); }
  catch (error) {
    if (error instanceof ProductApiError || error instanceof OperatorWriteSessionChangedError || error instanceof MaterialUploadClientError) throw error;
    throw new MaterialUploadClientError("MATERIAL_UPLOAD_CLIENT_UNAVAILABLE");
  }
}
export async function readProjectMaterialUpload(projectId: string, objectId: string): Promise<MaterialUploadTicket> {
  const project = parse(uuidSchema, projectId, "MATERIAL_UPLOAD_CLIENT_INVALID").toLowerCase(), object = parse(uuidSchema, objectId, "MATERIAL_UPLOAD_CLIENT_INVALID").toLowerCase();
  return safe(() => readOperatorResource(`/api/operator/projects/${project}/material-uploads/${object}`, { parse(raw: unknown) {
    const value = parse(materialUploadTicketViewSchema, raw, "MATERIAL_UPLOAD_CLIENT_PROTOCOL_INVALID");
    if (!sameId(project, value.projectId) || !sameId(object, value.objectId)) throw new MaterialUploadClientError("MATERIAL_UPLOAD_CLIENT_PROTOCOL_INVALID");
    return value;
  } }));
}
// Preparation only records a pending descriptor (or returns a prior ticket).
// It does not send bytes, certify physical existence, decode media or grant
// eligibility. Unknown results retain the original object/body/key/session.
export class PreparedMaterialUploadTicket {
  #send: () => Promise<MaterialUploadPreparation>;
  constructor(raw: unknown) {
    const input = parse(prepareMaterialUploadRequestSchema, raw, "MATERIAL_UPLOAD_CLIENT_INVALID");
    if (input.bytes > materialUploadHTTPMaxBytes) throw new MaterialUploadClientError("MATERIAL_UPLOAD_CLIENT_INVALID");
    this.#send = prepareOperatorPost(`/api/operator/projects/${input.projectId.toLowerCase()}/material-uploads`, JSON.stringify(input), { parse(rawResponse: unknown) {
      const value = parse(prepareMaterialUploadResponseSchema, rawResponse, "MATERIAL_UPLOAD_CLIENT_PROTOCOL_INVALID");
      if (!sameId(value.projectId, input.projectId) || !sameId(value.objectId, input.objectId) || value.sha256 !== input.sha256 || value.bytes !== input.bytes || value.contentType !== input.contentType
        || (value.changed && value.status !== "pending_bytes")) throw new MaterialUploadClientError("MATERIAL_UPLOAD_CLIENT_PROTOCOL_INVALID");
      return value;
    } });
  }
  async send(): Promise<MaterialUploadPreparation> { return safe(this.#send); }
}
