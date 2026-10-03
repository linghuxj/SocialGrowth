import { Body, Controller, Get, Header, Headers, Inject, Param, Post, Req } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ProjectLifecycleService } from "./project-lifecycle-service.js";
import { operatorSessionTokenFrom } from "./operator-session-cookie.js";
import { requestIdFrom, requireSupportedContract, rethrowHttp } from "./product-http.js";

interface Request { headers: Record<string, string | string[] | undefined> }
@Controller("api/operator/projects")
export class ProjectLifecycleController {
  constructor(@Inject(ProjectLifecycleService) private readonly service: ProjectLifecycleService) {}

  @Get(":projectId/lifecycle-intents") @Header("Cache-Control", "no-store")
  async read(@Param("projectId") projectId: string, @Req() request: Request) {
    try { return await this.service.read(operatorSessionTokenFrom(request.headers.cookie), projectId); }
    catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }

  @Post(":projectId/lifecycle-intents") @Header("Cache-Control", "no-store")
  async setIntent(@Param("projectId") projectId: string, @Body() body: unknown, @Req() request: Request, @Headers("x-csrf-token") csrf: string | undefined) {
    try {
      requireSupportedContract(body);
      return await this.service.setIntent(operatorSessionTokenFrom(request.headers.cookie), csrf ?? "", projectId, body);
    } catch (error) { rethrowHttp(error, requestIdFrom(body)); }
  }

  @Post(":projectId/materials/:variantId/withdrawal") @Header("Cache-Control", "no-store")
  async withdrawMaterial(@Param("projectId") projectId: string, @Param("variantId") variantId: string, @Body() body: unknown,
    @Req() request: Request, @Headers("x-csrf-token") csrf: string | undefined) {
    try {
      requireSupportedContract(body);
      return await this.service.withdrawMaterial(operatorSessionTokenFrom(request.headers.cookie), csrf ?? "", projectId, variantId, body);
    } catch (error) { rethrowHttp(error, requestIdFrom(body)); }
  }
}
