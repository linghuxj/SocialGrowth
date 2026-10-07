import { Body, Controller, Get, Header, Headers, Inject, Param, Post, Req } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { arrangeBusinessPlanRequestSchema, uuidSchema } from "@socialgrowth/product-contracts";
import { BusinessPlanService } from "./business-plan-service.js";
import { operatorSessionTokenFrom } from "./operator-session-cookie.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { requestIdFrom, requireSupportedContract, rethrowHttp } from "./product-http.js";

interface Request { headers: Record<string, string | string[] | undefined> }
@Controller("api/operator/projects/:projectId/business-plan")
export class BusinessPlanController {
  constructor(@Inject(BusinessPlanService) private readonly service: BusinessPlanService) {}

  @Get() @Header("Cache-Control", "no-store")
  async read(@Param("projectId") projectInput: string, @Req() request: Request) {
    try { return await this.service.read(operatorSessionTokenFrom(request.headers.cookie), uuidSchema.parse(projectInput)); }
    catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }

  @Get("current-checks") @Header("Cache-Control", "no-store")
  async currentChecks(@Param("projectId") projectInput: string, @Req() request: Request) {
    try { return await this.service.currentChecks(operatorSessionTokenFrom(request.headers.cookie), uuidSchema.parse(projectInput)); }
    catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }

  @Get("workflow") @Header("Cache-Control", "no-store")
  async workflow(@Param("projectId") projectInput: string, @Req() request: Request) {
    try { return await this.service.workflow(operatorSessionTokenFrom(request.headers.cookie), uuidSchema.parse(projectInput)); }
    catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }

  @Post("tasks/:taskId/preflight") @Header("Cache-Control", "no-store")
  async startPreflight(@Param("projectId") projectInput: string, @Param("taskId") taskInput: string,
    @Req() request: Request, @Headers("x-csrf-token") csrf: string | undefined) {
    try { return await this.service.startPreflight(operatorSessionTokenFrom(request.headers.cookie), csrf ?? "", projectInput, taskInput); }
    catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }

  @Get("tasks/:taskId/preflight") @Header("Cache-Control", "no-store")
  async queryPreflight(@Param("projectId") projectInput: string, @Param("taskId") taskInput: string, @Req() request: Request) {
    try { return await this.service.queryPreflight(operatorSessionTokenFrom(request.headers.cookie), projectInput, taskInput); }
    catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }
  @Post("tasks/:taskId/retry-audit") @Header("Cache-Control", "no-store")
  async retryAudit(@Param("projectId") projectId: string, @Param("taskId") taskId: string,
    @Req() request: Request, @Headers("x-csrf-token") csrf: string | undefined) {
    try { return await this.service.retryAudit(operatorSessionTokenFrom(request.headers.cookie), csrf ?? "", projectId, taskId); }
    catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }

  @Post("tasks/:taskId/attempts") @Header("Cache-Control", "no-store")
  async createTaskAttempt(@Param("projectId") projectInput: string, @Param("taskId") taskInput: string, @Body() body: unknown,
    @Req() request: Request, @Headers("x-csrf-token") csrf: string | undefined) {
    try {
      requireSupportedContract(body);
      return await this.service.createTaskAttempt(operatorSessionTokenFrom(request.headers.cookie), csrf ?? "", projectInput, taskInput, body);
    } catch (error) {
      if (!(error instanceof ProductTransactionError) && error instanceof Error && error.name === "ZodError") {
        rethrowHttp(new ProductTransactionError("INPUT_INVALID", "Invalid business plan task attempt request"), requestIdFrom(body));
      }
      rethrowHttp(error, requestIdFrom(body));
    }
  }

  @Post() @Header("Cache-Control", "no-store")
  async arrange(@Param("projectId") projectInput: string, @Body() body: unknown, @Req() request: Request, @Headers("x-csrf-token") csrf: string | undefined) {
    try {
      requireSupportedContract(body);
      const parsed = arrangeBusinessPlanRequestSchema.parse(body);
      const projectId = uuidSchema.parse(projectInput);
      return await this.service.arrange(operatorSessionTokenFrom(request.headers.cookie), csrf ?? "", projectId, parsed);
    } catch (error) {
      if (!(error instanceof ProductTransactionError) && error instanceof Error && error.name === "ZodError") {
        rethrowHttp(new ProductTransactionError("INPUT_INVALID", "Invalid business plan arrangement request"), requestIdFrom(body));
      }
      rethrowHttp(error, requestIdFrom(body));
    }
  }
}
