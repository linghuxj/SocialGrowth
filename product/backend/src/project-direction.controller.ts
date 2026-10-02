import { Body, Controller, Get, Header, Headers, Inject, Param, Post, Req } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { confirmProjectDirectionRequestSchema, generateProjectDirectionRequestSchema, uuidSchema } from "@socialgrowth/product-contracts";
import { ProjectDirectionService } from "./project-direction-service.js";
import { operatorSessionTokenFrom } from "./operator-session-cookie.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { requestIdFrom, requireSupportedContract, rethrowHttp } from "./product-http.js";
interface Request { headers: Record<string, string | string[] | undefined> }
@Controller("api/operator/projects/:projectId/direction")
export class ProjectDirectionController {
  constructor(@Inject(ProjectDirectionService) private readonly service: ProjectDirectionService) {}
  @Get() @Header("Cache-Control", "no-store")
  async read(@Param("projectId") id: string, @Req() req: Request) {
    try { return await this.service.read(operatorSessionTokenFrom(req.headers.cookie), uuidSchema.parse(id)); }
    catch (e) { rethrowHttp(e, `request-${randomUUID()}`); }
  }
  @Post("generate") @Header("Cache-Control", "no-store")
  async generate(@Param("projectId") id: string, @Body() body: unknown, @Req() req: Request, @Headers("x-csrf-token") csrf: string | undefined) {
    try { requireSupportedContract(body); const r = generateProjectDirectionRequestSchema.parse(body);
      if (id.toLowerCase() !== r.projectId.toLowerCase()) throw new ProductTransactionError("INPUT_INVALID", "Project path must match direction");
      return await this.service.generate(operatorSessionTokenFrom(req.headers.cookie), csrf ?? "", r);
    } catch (e) { rethrowHttp(e, requestIdFrom(body)); }
  }
  @Post("confirm") @Header("Cache-Control", "no-store")
  async confirm(@Param("projectId") id: string, @Body() body: unknown, @Req() req: Request, @Headers("x-csrf-token") csrf: string | undefined) {
    try { requireSupportedContract(body); const r = confirmProjectDirectionRequestSchema.parse(body);
      if (id.toLowerCase() !== r.projectId.toLowerCase()) throw new ProductTransactionError("INPUT_INVALID", "Project path must match direction");
      return await this.service.confirm(operatorSessionTokenFrom(req.headers.cookie), csrf ?? "", r);
    } catch (e) { rethrowHttp(e, requestIdFrom(body)); }
  }
}
