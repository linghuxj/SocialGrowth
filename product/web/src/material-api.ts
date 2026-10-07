import {
  uuidSchema, materialLibraryQuerySchema, materialLibraryResponseSchema, materialCurrentViewSchema,
  materialHistoryQuerySchema, materialHistoryResponseSchema, materialUploadInventoryQuerySchema, materialUploadInventoryResponseSchema,
} from "@socialgrowth/product-contracts";
import { ProductApiError, readOperatorResource } from "./operator-api.js";
export type MaterialCurrentView = ReturnType<typeof materialCurrentViewSchema.parse>;
export type MaterialLibraryPage = ReturnType<typeof materialLibraryResponseSchema.parse>;
export type MaterialHistoryPage = ReturnType<typeof materialHistoryResponseSchema.parse>;
export type MaterialUploadPage = ReturnType<typeof materialUploadInventoryResponseSchema.parse>;
export class MaterialReadError extends Error {
  constructor(readonly code: "MATERIAL_READ_INVALID" | "MATERIAL_READ_PROTOCOL_INVALID" | "MATERIAL_READ_UNAVAILABLE") { super(code); }
}
function input<T>(schema: { parse(v: unknown): T }, value: unknown): T {
  try { return schema.parse(value); } catch { throw new MaterialReadError("MATERIAL_READ_INVALID"); }
}
const id = (value: unknown) => input(uuidSchema, value).toLowerCase();
const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
async function read<T>(path: string, schema: { parse(v: unknown): T }, valid: (value: T) => boolean): Promise<T> {
  try {
    return await readOperatorResource(path, { parse(raw: unknown) {
      try { const value = schema.parse(raw); if (!valid(value)) throw new Error(); return value; }
      catch { throw new MaterialReadError("MATERIAL_READ_PROTOCOL_INVALID"); }
    } });
  } catch (error) {
    if (error instanceof ProductApiError || error instanceof MaterialReadError) throw error;
    throw new MaterialReadError("MATERIAL_READ_UNAVAILABLE");
  }
}
function query(cursor: string | null, field: string, pageSize: number): string {
  const values = new URLSearchParams({ pageSize: String(pageSize) }); if (cursor !== null) values.set(field, cursor.toLowerCase()); return values.toString();
}
// Actual same-origin GET methods, no local rows/cache, auto retry, actor token,
// storage URL, upload/write/eligibility/publish permission or guessed filename.
export async function listProjectMaterials(projectId: string, afterVariantId: string | null = null, pageSize = 20): Promise<MaterialLibraryPage> {
  const project = id(projectId), q = input(materialLibraryQuerySchema, { afterVariantId, pageSize });
  return read(`/api/operator/projects/${project}/materials?${query(q.afterVariantId, "afterVariantId", q.pageSize)}`, materialLibraryResponseSchema,
    v => same(v.projectId, project) && v.materials.length <= q.pageSize && v.materials.every(m => !q.afterVariantId || m.variantId.toLowerCase() > q.afterVariantId.toLowerCase()));
}
export async function readProjectMaterial(projectId: string, variantId: string): Promise<MaterialCurrentView> {
  const project = id(projectId), variant = id(variantId);
  return read(`/api/operator/projects/${project}/materials/${variant}`, materialCurrentViewSchema, v => same(v.projectId, project) && same(v.variantId, variant));
}
export async function readProjectMaterialHistory(projectId: string, variantId: string, afterRevision = 0, pageSize = 20): Promise<MaterialHistoryPage> {
  const project = id(projectId), variant = id(variantId), q = input(materialHistoryQuerySchema, { afterRevision, pageSize });
  return read(`/api/operator/projects/${project}/materials/${variant}/revisions?${new URLSearchParams({ afterRevision: String(q.afterRevision), pageSize: String(q.pageSize) })}`, materialHistoryResponseSchema,
    v => same(v.current.projectId, project) && same(v.current.variantId, variant) && q.afterRevision <= v.current.currentRevision && v.revisions.length <= q.pageSize
      && (v.revisions.length ? v.revisions[0]!.revision === q.afterRevision + 1 : q.afterRevision === v.current.currentRevision));
}
export async function listProjectMaterialUploads(projectId: string, afterObjectId: string | null = null, pageSize = 20): Promise<MaterialUploadPage> {
  const project = id(projectId), q = input(materialUploadInventoryQuerySchema, { afterObjectId, pageSize });
  return read(`/api/operator/projects/${project}/material-uploads?${query(q.afterObjectId, "afterObjectId", q.pageSize)}`, materialUploadInventoryResponseSchema,
    v => same(v.projectId, project) && v.tickets.length <= q.pageSize && v.tickets.every(t => !q.afterObjectId || t.objectId.toLowerCase() > q.afterObjectId.toLowerCase()));
}
