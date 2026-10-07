import { Body, Controller, Get, Header, Headers, Inject, Param, Post, Req } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { saveProjectPlanningRequestSchema, uuidSchema } from "@socialgrowth/product-contracts";
import { ProjectPlanningService } from "./project-planning-service.js";
import { operatorSessionTokenFrom } from "./operator-session-cookie.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { requestIdFrom, requireSupportedContract, rethrowHttp } from "./product-http.js";
interface Request { headers: Record<string, string | string[] | undefined> }
function token(request: Request): string {
  return operatorSessionTokenFrom(request.headers.cookie);
}
@Controller("api/operator/projects/:projectId/planning-draft")
export class ProjectPlanningController {
  constructor(@Inject(ProjectPlanningService) private readonly service: ProjectPlanningService) {}
  @Get() @Header("Cache-Control", "no-store")
  async read(@Param("projectId") projectId: string, @Req() request: Request) {
    try { return await this.service.read(token(request), uuidSchema.parse(projectId)); }
    catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }
  @Post() @Header("Cache-Control", "no-store")
  async save(@Param("projectId") projectId: string, @Body() body: unknown, @Req() request: Request, @Headers("x-csrf-token") csrf: string | undefined) {
    try {
      requireSupportedContract(body);
      const parsed = saveProjectPlanningRequestSchema.parse(body);
      if (parsed.projectId !== projectId) throw new ProductTransactionError("INPUT_INVALID", "Project path must match body");
      return await this.service.save(token(request), csrf ?? "", parsed);
    } catch (error) { rethrowHttp(error, requestIdFrom(body)); }
  }
}
