import { Body, Controller, Get, Header, Headers, Inject, Param, Post, Req, HttpException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { contractVersion, materialCurrentViewSchema, saveMaterialDeclarationRequestSchema, saveMaterialDeclarationResponseSchema, productErrorResponseSchema } from "@socialgrowth/product-contracts";
import { MaterialRuntime } from "./material-runtime.js";
import { MaterialRegistryError } from "./material-registry-store.js";
import { operatorSessionTokenFrom } from "./operator-session-cookie.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { requestIdFrom, requireSupportedContract, rethrowHttp } from "./product-http.js";
interface Request { headers: Record<string, string | string[] | undefined> }
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
}
