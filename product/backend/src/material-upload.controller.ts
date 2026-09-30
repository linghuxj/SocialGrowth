import { Body, Controller, Get, Header, Headers, Inject, Param, Post, Put, Req, HttpException } from "@nestjs/common";
import type { IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { contractVersion, materialUploadTicketViewSchema, prepareMaterialUploadRequestSchema, prepareMaterialUploadResponseSchema,
  productErrorResponseSchema, uploadMaterialBytesCommandSchema, uploadMaterialBytesResponseSchema, type MaterialUploadTicketView } from "@socialgrowth/product-contracts";
import { MaterialByteTransportError, materialHttpMaxBytes, readMaterialByteStream } from "./material-byte-transport.js";
import { MaterialRuntime } from "./material-runtime.js";
import { MaterialUploadError } from "./material-upload-core.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { requestIdFrom, requireSupportedContract, rethrowHttp } from "./product-http.js";
interface Request { headers: Record<string, string | string[] | undefined> }
function token(request: Request): string {
  const cookies = request.headers.cookie;
  if (typeof cookies !== "string") return "";
  const name = "__Host-sg_operator_session";
  const matches = cookies.split(";").map(c => c.trim()).filter(c => c.slice(0, c.includes("=") ? c.indexOf("=") : c.length).trim() === name);
  const one = matches.length === 1 ? matches[0] : undefined;
  const value = one?.startsWith(`${name}=`) ? one.slice(name.length + 1) : "";
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : "";
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
  if (error instanceof MaterialByteTransportError) {
    throw new HttpException(productErrorResponseSchema.parse({ contractVersion, requestId, error: {
      code: "INPUT_INVALID", message: "Material byte transport did not complete", retryable: error.code !== "INVALID_BYTES" } }), error.code === "BODY_TIMEOUT" ? 408 : 400);
  }
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
      if (input.bytes > materialHttpMaxBytes) throw new MaterialUploadError("INVALID_BYTES");
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
  @Put(":objectId/bytes") @Header("Cache-Control", "no-store")
  async bytes(@Param("projectId") projectId: string, @Param("objectId") objectId: string, @Req() request: IncomingMessage) {
    const command = { projectId, objectId, metadata: { contractVersion: request.headers["x-sg-contract-version"], requestId: request.headers["x-request-id"], idempotencyKey: request.headers["x-idempotency-key"] } };
    try {
      requireSupportedContract(command); const input = uploadMaterialBytesCommandSchema.parse(command);
      if (request.headers["content-type"]?.toLowerCase() !== "application/octet-stream" || request.headers["content-encoding"] !== undefined) throw new MaterialUploadError("INVALID_BYTES");
      const csrf = request.headers["x-csrf-token"];
      if (typeof csrf !== "string") throw new ProductTransactionError("AUTHENTICATION_REQUIRED", "Operator CSRF is required");
      const session = token(request), saved = await this.runtime.uploads().inspectForByteUpload(session, csrf, input);
      const length = request.headers["content-length"];
      if (saved.descriptor.bytes > materialHttpMaxBytes || (length !== undefined && (!/^[1-9][0-9]*$/.test(length) || Number(length) !== saved.descriptor.bytes))) throw new MaterialUploadError("INVALID_BYTES");
      const body = await readMaterialByteStream(request, saved.descriptor.bytes);
      const uploaded = await this.runtime.uploads().upload(session, csrf, input, body);
      const response = uploadMaterialBytesResponseSchema.safeParse({ ...view(uploaded), changed: uploaded.changed, replayed: uploaded.replayed });
      if (!response.success) throw new ProductTransactionError("INTERNAL_ERROR", "Material upload result is unavailable");
      return response.data;
    } catch (error) { fail(error, requestIdFrom(command)); }
  }
}
