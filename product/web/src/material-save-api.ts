import { saveMaterialDeclarationRequestSchema, saveMaterialDeclarationResponseSchema } from "@socialgrowth/product-contracts";
import { ProductApiError, OperatorWriteSessionChangedError, prepareOperatorPost } from "./operator-api.js";
export type MaterialSaveResult = ReturnType<typeof saveMaterialDeclarationResponseSchema.parse>;
type SaveInput = ReturnType<typeof saveMaterialDeclarationRequestSchema.parse>;
export class MaterialWriteError extends Error {
  constructor(readonly code: "MATERIAL_WRITE_INVALID" | "MATERIAL_WRITE_PROTOCOL_INVALID" | "MATERIAL_WRITE_UNAVAILABLE") { super(code); }
}
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function identityMatches(input: SaveInput, value: MaterialSaveResult): boolean {
  return sameId(input.projectId, value.projectId) && sameId(input.contentUnitId, value.contentUnitId)
    && sameId(input.sourceId, value.sourceId) && sameId(input.sourceRecordId, value.sourceRecordId) && sameId(input.variantId, value.variantId)
    && input.languageTag.toLowerCase() === value.languageTag && input.identity.mediaKind === value.identity.mediaKind && input.identity.businessKind === value.identity.businessKind
    && sameId(input.identity.businessEntityId, value.identity.businessEntityId) && input.identity.episodeNumber === value.identity.episodeNumber
    && (input.identity.seriesId === null ? value.identity.seriesId === null : value.identity.seriesId !== null && sameId(input.identity.seriesId, value.identity.seriesId));
}
function currentMatches(input: SaveInput, value: MaterialSaveResult): boolean {
  const declaration = { ...input.declaration, sourceEvidenceIds: input.declaration.sourceEvidenceIds.map(s => s.toLowerCase()).sort() };
  const returned = { ...value.declaration, sourceEvidenceIds: value.declaration.sourceEvidenceIds.map(s => s.toLowerCase()).sort() };
  return value.currentRevision === input.expectedCurrentRevision + (value.changed ? 1 : 0)
    && JSON.stringify(declaration) === JSON.stringify(returned)
    && value.objects.length === input.objectIds.length && value.objects.every((o, i) => sameId(o.objectId, input.objectIds[i]!));
}
// Shared correlation only; callers still parse the strict response schema.
export function materialSaveResponseMatches(input: SaveInput, result: MaterialSaveResult): boolean {
  return identityMatches(input, result) && (result.replayed ? result.currentRevision >= Math.max(1, input.expectedCurrentRevision) : currentMatches(input, result));
}
// Runtime-private prepared request, held in memory only. Every explicit send
// uses identical body/key. No automatic retries, key rotation, batch or UI.
// All errors leave it unresolved: caller must not treat a retryable flag or
// HTTP status as proof of no commit, or create new unit/variant to hide it.
export class PreparedMaterialDeclaration {
  #send: () => Promise<MaterialSaveResult>;
  constructor(raw: unknown) {
    let input: SaveInput;
    try { input = saveMaterialDeclarationRequestSchema.parse(raw); }
    catch { throw new MaterialWriteError("MATERIAL_WRITE_INVALID"); }
    const body = JSON.stringify(input);
    this.#send = prepareOperatorPost(`/api/operator/projects/${input.projectId.toLowerCase()}/materials`, body, { parse(rawResponse: unknown) {
      try {
        const result = saveMaterialDeclarationResponseSchema.parse(rawResponse);
        // Original-key replay returns today's current revision, which may have
        // later declarations/objects. It does not claim this body is current.
        if (!materialSaveResponseMatches(input, result)) throw new Error();
        return result;
      } catch { throw new MaterialWriteError("MATERIAL_WRITE_PROTOCOL_INVALID"); }
    } });
  }
  async send(): Promise<MaterialSaveResult> {
    try { return await this.#send(); }
    catch (error) {
      if (error instanceof ProductApiError || error instanceof OperatorWriteSessionChangedError || error instanceof MaterialWriteError) throw error;
      throw new MaterialWriteError("MATERIAL_WRITE_UNAVAILABLE");
    }
  }
}
