import { Body, Controller, Get, Header, Headers, Inject, Param, Post, Query, Req, HttpException } from "@nestjs/common";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { contractVersion, materialCurrentViewSchema, saveMaterialDeclarationRequestSchema, saveMaterialDeclarationResponseSchema, productErrorResponseSchema,
  batchMaterialDeclarationsRequestSchema, batchMaterialDeclarationsResponseSchema, materialHistoryQuerySchema, materialHistoryResponseSchema } from "@socialgrowth/product-contracts";
import { MaterialRuntime } from "./material-runtime.js";
import { MaterialRegistryError } from "./material-registry-store.js";
import { operatorSessionTokenFrom } from "./operator-session-cookie.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { requestIdFrom, requireSupportedContract, rethrowHttp } from "./product-http.js";
import { mapProductException } from "./product-exception.filter.js";
interface Request { headers: Record<string, string | string[] | undefined> }
const querySchema = z.strictObject({ afterRevision: z.string().regex(/^(?:0|[1-9][0-9]{0,3})$/).optional(), pageSize: z.string().regex(/^[1-9][0-9]?$/).optional() });
function view(saved: Awaited<ReturnType<ReturnType<MaterialRuntime["registry"]>["read"]>>) {
  const last = saved.revisions.at(-1);
  if (!last || last.revision !== saved.currentRevision) throw new ProductTransactionError("INTERNAL_ERROR", "Material result is unavailable");
  const value = materialCurrentViewSchema.safeParse({ projectId: saved.projectId, contentUnitId: saved.contentUnitId, sourceId: saved.sourceId, sourceRecordId: saved.sourceRecordId,
    identity: saved.identity, variantId: saved.variantId, languageTag: saved.languageTag, currentRevision: saved.currentRevision,
    declaration: last.declaration, objects: last.objects.map(o => ({ objectId: o.objectId, sha256: o.sha256, bytes: o.bytes, contentType: o.contentType })),
    recordedAt: last.recordedAt, status: last.status, candidateAllowed: saved.candidateAllowed, publicationAllowed: saved.publicationAllowed });
  if (!value.success) throw new ProductTransactionError("INTERNAL_ERROR", "Material result is unavailable");
  return value.data;
}
function fail(error: unknown, requestId: string): never {
  if (error instanceof MaterialRegistryError) {
    throw new HttpException(productErrorResponseSchema.parse({ contractVersion, requestId, error: {
      code: error.code === "INVALID_OBJECTS" ? "INPUT_INVALID" : "INTERNAL_ERROR", message: "Material declaration could not be completed",
      retryable: error.code === "VERIFIER_UNAVAILABLE" } }), error.code === "VERIFIER_UNAVAILABLE" ? 503 : error.code === "INVALID_OBJECTS" ? 400 : 500);
  }
  rethrowHttp(error, requestId);
}
@Controller("api/operator/projects/:projectId/materials")
export class MaterialRegistryController {
  constructor(@Inject(MaterialRuntime) private readonly runtime: MaterialRuntime) {}
  @Post() @Header("Cache-Control", "no-store")
  async save(@Param("projectId") projectId: string, @Body() body: unknown, @Req() request: Request, @Headers("x-csrf-token") csrf: string | undefined) {
    try {
      requireSupportedContract(body); const input = saveMaterialDeclarationRequestSchema.parse(body);
      if (input.projectId.toLowerCase() !== projectId.toLowerCase()) throw new ProductTransactionError("INPUT_INVALID", "Project path must match material declaration");
      const token = operatorSessionTokenFrom(request.headers.cookie);
      await this.runtime.registry().authorizeWrite(token, csrf ?? "", projectId);
      const saved = await this.runtime.registry().save(token, csrf ?? "", input);
      const result = saveMaterialDeclarationResponseSchema.safeParse({ ...view(saved), changed: saved.changed, replayed: saved.replayed });
      if (!result.success) throw new ProductTransactionError("INTERNAL_ERROR", "Material result is unavailable");
      return result.data;
    } catch (error) { fail(error, requestIdFrom(body)); }
  }
  @Get(":variantId") @Header("Cache-Control", "no-store")
  async read(@Param("projectId") projectId: string, @Param("variantId") variantId: string, @Req() request: Request) {
    try { return view(await this.runtime.registry().read(operatorSessionTokenFrom(request.headers.cookie), projectId, variantId)); }
    catch (error) { fail(error, `request-${randomUUID()}`); }
  }
  @Post("batch") @Header("Cache-Control", "no-store")
  async batch(@Param("projectId") projectId: string, @Body() body: unknown, @Req() request: Request, @Headers("x-csrf-token") csrf: string | undefined) {
    try {
      requireSupportedContract(body); const input = batchMaterialDeclarationsRequestSchema.parse(body);
      if (input.projectId.toLowerCase() !== projectId.toLowerCase()) throw new ProductTransactionError("INPUT_INVALID", "Project path must match material batch");
      await this.runtime.registry().authorizeWrite(operatorSessionTokenFrom(request.headers.cookie), csrf ?? "", projectId);
      const results = [];
      // No batch transaction/cache/whole-batch success. Each item's original key
      // survives interruption; completed prior items are not rolled back.
      for (const [index, item] of input.items.entries()) {
        try { results.push({ index, outcome: "saved" as const, material: await this.save(projectId, item, request, csrf) }); }
        catch (error) { results.push({ index, outcome: "rejected" as const, error: mapProductException(error).body.error }); }
      }
      const result = batchMaterialDeclarationsResponseSchema.safeParse({ projectId: input.projectId.toLowerCase(), results });
      if (!result.success) throw new ProductTransactionError("INTERNAL_ERROR", "Material batch result is unavailable");
      return result.data;
    } catch (error) { fail(error, requestIdFrom(body)); }
  }
  @Get(":variantId/revisions") @Header("Cache-Control", "no-store")
  async history(@Param("projectId") projectId: string, @Param("variantId") variantId: string, @Query() query: unknown, @Req() request: Request) {
    try {
      const q = querySchema.parse(query), input = materialHistoryQuerySchema.parse({ afterRevision: q.afterRevision === undefined ? 0 : Number(q.afterRevision), pageSize: q.pageSize === undefined ? 20 : Number(q.pageSize) });
      const saved = await this.runtime.registry().read(operatorSessionTokenFrom(request.headers.cookie), projectId, variantId);
      if (input.afterRevision > saved.currentRevision) throw new ProductTransactionError("FACT_VERSION_STALE", "Material history cursor is unavailable");
      const page = saved.revisions.filter(r => r.revision > input.afterRevision).slice(0, input.pageSize), last = page.at(-1);
      const result = materialHistoryResponseSchema.safeParse({ current: view(saved), revisions: page.map(r => ({ revision: r.revision, declaration: r.declaration,
        objects: r.objects.map(o => ({ objectId: o.objectId, sha256: o.sha256, bytes: o.bytes, contentType: o.contentType })), recordedAt: r.recordedAt, status: r.status })),
        nextAfterRevision: last && last.revision < saved.currentRevision ? last.revision : null });
      if (!result.success) throw new ProductTransactionError("INTERNAL_ERROR", "Material history result is unavailable");
      return result.data;
    } catch (error) { fail(error, `request-${randomUUID()}`); }
  }
}
