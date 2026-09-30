import { Body, Controller, Get, Header, Headers, Inject, Param, Post, Req, HttpException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { contractVersion, materialUploadTicketViewSchema, prepareMaterialUploadRequestSchema, prepareMaterialUploadResponseSchema,
  productErrorResponseSchema, type MaterialUploadTicketView } from "@socialgrowth/product-contracts";
import { MaterialRuntime } from "./material-runtime.js";
import { MaterialUploadError } from "./material-upload-core.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { requestIdFrom, requireSupportedContract, rethrowHttp } from "./product-http.js";
interface Request { headers: Record<string, string | string[] | undefined> }
function token(request: Request): string {
  const cookies = request.headers.cookie;
  if (typeof cookies !== "string") return "";
  const matches = cookies.split(";").map(c => c.trim().split("=")).filter(([name]) => name === "__Host-sg_operator_session");
  return matches.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(matches[0]?.[1] ?? "") ? matches[0]![1]! : "";
}
function view(saved: Awaited<ReturnType<ReturnType<MaterialRuntime["uploads"]>["read"]>>): MaterialUploadTicketView {
  const parsed = materialUploadTicketViewSchema.safeParse({ projectId: saved.projectId, objectId: saved.objectId,
    sha256: saved.descriptor.sha256, bytes: saved.descriptor.bytes, contentType: saved.descriptor.contentType,
    status: saved.status, preparedAt: saved.preparedAt, verifiedAt: saved.verifiedAt,
    candidateAllowed: saved.candidateAllowed, publicationAllowed: saved.publicationAllowed });
  if (!parsed.success) throw new ProductTransactionError("INTERNAL_ERROR", "Material upload result is unavailable");
  return parsed.data;
}
function fail(error: unknown, requestId: string): never {
  if (error instanceof MaterialUploadError) {
    const unavailable = error.code === "CONFIGURATION_REQUIRED" || error.code === "STORAGE_UNAVAILABLE";
    throw new HttpException(productErrorResponseSchema.parse({ contractVersion, requestId, error: {
      code: error.code === "INVALID_BYTES" ? "INPUT_INVALID" : error.code === "OBJECT_CONFLICT" ? "FACT_VERSION_STALE" : "INTERNAL_ERROR",
      message: "Material upload operation could not be completed", retryable: error.retryable } }), unavailable ? 503 : error.code === "OBJECT_CONFLICT" ? 409 : error.code === "INVALID_BYTES" ? 400 : 500);
  }
  rethrowHttp(error, requestId);
}
@Controller("api/operator/projects/:projectId/material-uploads")
export class MaterialUploadController {
  constructor(@Inject(MaterialRuntime) private readonly runtime: MaterialRuntime) {}
  @Post() @Header("Cache-Control", "no-store")
  async prepare(@Param("projectId") projectId: string, @Body() body: unknown, @Req() request: Request, @Headers("x-csrf-token") csrf: string | undefined) {
    try {
      requireSupportedContract(body); const input = prepareMaterialUploadRequestSchema.parse(body);
      if (input.projectId.toLowerCase() !== projectId.toLowerCase()) throw new ProductTransactionError("INPUT_INVALID", "Project path must match upload descriptor");
      const saved = await this.runtime.uploads().prepare(token(request), csrf ?? "", input);
      const result = prepareMaterialUploadResponseSchema.safeParse({ ...view(saved), changed: saved.changed, replayed: saved.replayed });
      if (!result.success) throw new ProductTransactionError("INTERNAL_ERROR", "Material upload result is unavailable");
      return result.data;
    } catch (error) { fail(error, requestIdFrom(body)); }
  }
  @Get(":objectId") @Header("Cache-Control", "no-store")
  async read(@Param("projectId") projectId: string, @Param("objectId") objectId: string, @Req() request: Request) {
    try { return view(await this.runtime.uploads().read(token(request), projectId, objectId)); }
    catch (error) { fail(error, `request-${randomUUID()}`); }
  }
}
