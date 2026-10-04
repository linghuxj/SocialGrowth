import { Body, Controller, Get, Header, Headers, Inject, Param, Post, Req } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { idempotencyKeySchema, saveProjectCycleConfigurationRequestSchema, uuidSchema } from "@socialgrowth/product-contracts";
import { operatorSessionTokenFrom } from "./operator-session-cookie.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { ProjectCycleConfigService } from "./project-cycle-config-service.js";
import { requestIdFrom, requireSupportedContract, rethrowHttp } from "./product-http.js";

interface Request { headers: Record<string, string | string[] | undefined> }
@Controller("api/operator/projects/:projectId/review-cycle-config")
export class ProjectCycleConfigController {
  constructor(@Inject(ProjectCycleConfigService) private readonly service: ProjectCycleConfigService) {}

  @Get() @Header("Cache-Control", "no-store")
  async read(@Param("projectId") projectId: string, @Req() request: Request) {
    try { return await this.service.read(operatorSessionTokenFrom(request.headers.cookie), uuidSchema.parse(projectId)); }
    catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }

  @Get("commands/:idempotencyKey") @Header("Cache-Control", "no-store")
  async readCommand(@Param("projectId") projectId: string, @Param("idempotencyKey") key: string, @Req() request: Request) {
    try { return await this.service.readCommand(operatorSessionTokenFrom(request.headers.cookie), projectId, idempotencyKeySchema.parse(key)); }
    catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }

  @Post() @Header("Cache-Control", "no-store")
  async save(@Param("projectId") projectId: string, @Body() body: unknown, @Req() request: Request, @Headers("x-csrf-token") csrf: string | undefined) {
    try {
      requireSupportedContract(body);
      const parsed = saveProjectCycleConfigurationRequestSchema.parse(body);
      uuidSchema.parse(projectId);
      return await this.service.save(operatorSessionTokenFrom(request.headers.cookie), csrf ?? "", projectId, parsed);
    } catch (error) {
      if (error instanceof ProductTransactionError) rethrowHttp(error, requestIdFrom(body));
      rethrowHttp(error, requestIdFrom(body));
    }
  }
}
