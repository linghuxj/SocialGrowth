import { batchMaterialDeclarationsRequestSchema, batchMaterialDeclarationsResponseSchema, saveMaterialDeclarationRequestSchema } from "@socialgrowth/product-contracts";
import { ProductApiError, OperatorWriteSessionChangedError, prepareOperatorPost } from "./operator-api.js";
import { materialSaveResponseMatches } from "./material-save-api.js";
export type MaterialBatchResult = ReturnType<typeof batchMaterialDeclarationsResponseSchema.parse>;
export const materialBatchHttpMaxBytes = 100 * 1024;
export class MaterialBatchError extends Error {
  constructor(readonly code: "MATERIAL_BATCH_INVALID" | "MATERIAL_BATCH_PROTOCOL_INVALID" | "MATERIAL_BATCH_UNAVAILABLE") { super(code); }
}
type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };
// Unknown items must survive unchanged for independent server validation.
// Never silently turn undefined/NaN into null or invoke an item's toJSON/getter.
function copyJson(raw: unknown, ancestors: Set<object>, budget: { nodes: number }): JsonValue {
  if (++budget.nodes > materialBatchHttpMaxBytes) throw new Error();
  if (raw === null || typeof raw === "string" || typeof raw === "boolean") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "object" || ancestors.has(raw)) throw new Error();
  const array = Array.isArray(raw);
  if (!array && Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null) throw new Error();
  const keys = Reflect.ownKeys(raw).filter(key => !array || key !== "length");
  if (keys.some(key => typeof key !== "string")) throw new Error();
  if (array && (raw.length > materialBatchHttpMaxBytes || keys.length !== raw.length
    || keys.some(key => !/^(?:0|[1-9][0-9]*)$/.test(String(key)) || Number(key) >= raw.length))) throw new Error();
  ancestors.add(raw);
  const entries = keys.map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new Error();
    const value: unknown = descriptor.value;
    return [String(key), copyJson(value, ancestors, budget)] as const;
  });
  ancestors.delete(raw);
  return array ? entries.map(([, value]) => value) : Object.fromEntries(entries);
}
// In-memory intent, not a batch transaction, durable draft or batch key.
// Every explicit send preserves all original per-item bodies/keys and order.
// A whole-request failure leaves every item unresolved (prior writes may exist).
export class PreparedMaterialBatch {
  #send: () => Promise<MaterialBatchResult>;
  constructor(raw: unknown) {
    let body: string, input: ReturnType<typeof batchMaterialDeclarationsRequestSchema.parse>;
    try {
      // Clone before schema access: unknown item fields are not Zod-deep-cloned.
      input = batchMaterialDeclarationsRequestSchema.parse(copyJson(raw, new Set(), { nodes: 0 }));
      body = JSON.stringify(input);
      if (new TextEncoder().encode(body).byteLength > materialBatchHttpMaxBytes) throw new Error();
    } catch { throw new MaterialBatchError("MATERIAL_BATCH_INVALID"); }
    const requests = input.items.map(item => saveMaterialDeclarationRequestSchema.safeParse(item));
    this.#send = prepareOperatorPost(`/api/operator/projects/${input.projectId.toLowerCase()}/materials/batch`, body, { parse(rawResponse: unknown) {
      try {
        const result = batchMaterialDeclarationsResponseSchema.parse(rawResponse);
        if (result.projectId.toLowerCase() !== input.projectId.toLowerCase() || result.results.length !== input.items.length) throw new Error();
        for (const row of result.results) {
          if (row.outcome !== "saved") continue;
          const request = requests[row.index];
          if (!request?.success || !materialSaveResponseMatches(request.data, row.material)) throw new Error();
        }
        return result;
      } catch { throw new MaterialBatchError("MATERIAL_BATCH_PROTOCOL_INVALID"); }
    } });
  }
  async send(): Promise<MaterialBatchResult> {
    try { return await this.#send(); }
    catch (error) {
      if (error instanceof ProductApiError || error instanceof OperatorWriteSessionChangedError || error instanceof MaterialBatchError) throw error;
      throw new MaterialBatchError("MATERIAL_BATCH_UNAVAILABLE");
    }
  }
}
