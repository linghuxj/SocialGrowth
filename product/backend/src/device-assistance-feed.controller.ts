import { Body, Controller, Get, Header, Headers, Inject, Param, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { recordDeviceAssistanceNoteRequestSchema, uuidSchema } from "@socialgrowth/product-contracts";
import { randomUUID } from "node:crypto";
import { DeviceAssistanceFeedService } from "./device-assistance-feed-service.js";
import { requestIdFrom, requireSupportedContract, rethrowHttp } from "./product-http.js";
import { ProductTransactionError } from "./product-transaction-error.js";
interface Request { headers: Record<string, string | string[] | undefined> }
function operatorToken(request: Request): string {
  const header = request.headers.cookie;
  return (Array.isArray(header) ? header.join(";") : header)?.split(";").map(s => s.trim().split("=")).find(([k]) => k === "__Host-sg_operator_session")?.[1] ?? "";
}
const querySchema = z.strictObject({ afterTodoId: uuidSchema.optional(), pageSize: z.string().regex(/^[1-9][0-9]?$/).refine(v => Number(v) <= 50).optional() });
@Controller("api/operator/assistance-todos")
export class DeviceAssistanceFeedController {
  constructor(@Inject(DeviceAssistanceFeedService) private readonly service: DeviceAssistanceFeedService) {}
  @Get() @Header("Cache-Control", "no-store")
  async list(@Query() query: unknown, @Req() request: Request) {
    try {
      const parsed = querySchema.parse(query);
      return await this.service.list(operatorToken(request), { afterTodoId: parsed.afterTodoId ?? null, pageSize: parsed.pageSize ? Number(parsed.pageSize) : 20 });
    } catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }
  @Post(":todoId/notes") @Header("Cache-Control", "no-store")
  async recordNote(@Param("todoId") todoId: string, @Body() body: unknown, @Req() request: Request, @Headers("x-csrf-token") csrf: string | undefined) {
    try {
      requireSupportedContract(body);
      const parsed = recordDeviceAssistanceNoteRequestSchema.parse(body), path = uuidSchema.parse(todoId).toLowerCase();
      if (parsed.todoId.toLowerCase() !== path) throw new ProductTransactionError("INPUT_INVALID", "Assistance path must match body");
      return await this.service.recordNote(operatorToken(request), csrf ?? "", parsed);
    } catch (error) { rethrowHttp(error, requestIdFrom(body)); }
  }
}
