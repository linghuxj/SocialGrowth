import { Body, Controller, Get, Header, Headers, Inject, Param, Post, Req } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { createProjectRequestSchema, updateProjectRequestSchema } from "@socialgrowth/product-contracts";
import { ProjectService } from "./project-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { requestIdFrom, requireSupportedContract, rethrowHttp } from "./product-http.js";
interface Request { headers: Record<string, string | string[] | undefined> }
function token(request: Request): string {
  const header = request.headers.cookie;
  return (Array.isArray(header) ? header.join(";") : header)?.split(";").map(s => s.trim().split("=")).find(([k]) => k === "__Host-sg_operator_session")?.[1] ?? "";
}
@Controller("api/operator/projects")
export class ProjectController {
  constructor(@Inject(ProjectService) private readonly service: ProjectService) {}
  @Get() @Header("Cache-Control", "no-store")
  async list(@Req() request: Request) {
    try { return await this.service.list(token(request)); } catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }
  @Post() @Header("Cache-Control", "no-store")
  async create(@Body() body: unknown, @Req() request: Request, @Headers("x-csrf-token") csrf: string | undefined) {
    try { requireSupportedContract(body); return await this.service.save(token(request), csrf ?? "", createProjectRequestSchema.parse(body), "create"); } catch (error) { rethrowHttp(error, requestIdFrom(body)); }
  }
  @Post(":projectId/basics") @Header("Cache-Control", "no-store")
  async update(@Param("projectId") projectId: string, @Body() body: unknown, @Req() request: Request, @Headers("x-csrf-token") csrf: string | undefined) {
    try {
      requireSupportedContract(body);
      if (typeof body !== "object" || body === null || !("projectId" in body) || body.projectId !== projectId) throw new ProductTransactionError("INPUT_INVALID", "Project path must match body");
      return await this.service.save(token(request), csrf ?? "", updateProjectRequestSchema.parse(body), "update");
    } catch (error) { rethrowHttp(error, requestIdFrom(body)); }
  }
}
