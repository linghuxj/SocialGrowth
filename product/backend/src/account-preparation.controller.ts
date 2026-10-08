import { Body, Controller, Get, Header, Headers, Inject, Param, Post, Req } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AccountPreparationService } from "./account-preparation-service.js";
import { requestAccountPreparationSchema, recheckAccountPreparationSchema, reviewAccountPreparationExecutionSchema, syncAccountPreparationIdentitySchema } from "@socialgrowth/product-contracts";
import { operatorSessionTokenFrom } from "./operator-session-cookie.js";
import { requireSupportedContract, requestIdFrom, rethrowHttp } from "./product-http.js";
import { ProductTransactionError } from "./product-transaction-error.js";
interface Request { headers: Record<string, string | string[] | undefined> }
@Controller("api/operator/projects/:projectId/account-preparation")
export class AccountPreparationController {
  constructor(@Inject(AccountPreparationService) private readonly service: AccountPreparationService) {}
  @Get() @Header("Cache-Control", "no-store")
  async read(@Param("projectId") id: string, @Req() req: Request) {
    try { return await this.service.read(operatorSessionTokenFrom(req.headers.cookie), id); }
    catch (e) { rethrowHttp(e, `request-${randomUUID()}`); }
  }
  @Post("request") @Header("Cache-Control", "no-store")
  async request(@Param("projectId") id: string, @Body() body: unknown, @Req() req: Request, @Headers("x-csrf-token") csrf: string | undefined) {
    return this.write(id, body, req, csrf, "request");
  }
  @Post("recheck") @Header("Cache-Control", "no-store")
  async recheck(@Param("projectId") id: string, @Body() body: unknown, @Req() req: Request, @Headers("x-csrf-token") csrf: string | undefined) {
    return this.write(id, body, req, csrf, "recheck");
  }
  @Post("execution-review") @Header("Cache-Control", "no-store")
  async review(@Param("projectId") id: string, @Body() body: unknown, @Req() req: Request, @Headers("x-csrf-token") csrf: string | undefined) {
    try { requireSupportedContract(body); const r = reviewAccountPreparationExecutionSchema.parse(body);
      if (r.projectId.toLowerCase() !== id.toLowerCase()) throw new ProductTransactionError("INPUT_INVALID", "Project path must match preparation scope");
      return await this.service.reviewExecution(operatorSessionTokenFrom(req.headers.cookie), csrf ?? "", r);
    } catch (e) { rethrowHttp(e, requestIdFrom(body)); }
  }
  @Post("identity-sync") @Header("Cache-Control", "no-store")
  async syncIdentity(@Param("projectId") id: string, @Body() body: unknown, @Req() req: Request, @Headers("x-csrf-token") csrf: string | undefined) {
    try { requireSupportedContract(body); const r = syncAccountPreparationIdentitySchema.parse(body);
      if (r.projectId.toLowerCase() !== id.toLowerCase()) throw new ProductTransactionError("INPUT_INVALID", "Project path must match preparation scope");
      return await this.service.syncIdentity(operatorSessionTokenFrom(req.headers.cookie), csrf ?? "", r);
    } catch (e) { rethrowHttp(e, requestIdFrom(body)); }
  }
  private async write(id: string, body: unknown, req: Request, csrf: string | undefined, kind: "request" | "recheck") {
    try { requireSupportedContract(body);
      const r = kind === "request" ? requestAccountPreparationSchema.parse(body) : recheckAccountPreparationSchema.parse(body);
      if (r.projectId.toLowerCase() !== id.toLowerCase()) throw new ProductTransactionError("INPUT_INVALID", "Project path must match preparation scope");
      return await this.service.write(operatorSessionTokenFrom(req.headers.cookie), csrf ?? "", r, kind);
    } catch (e) { rethrowHttp(e, requestIdFrom(body)); }
  }
}
