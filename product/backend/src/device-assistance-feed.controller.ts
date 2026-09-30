import { Controller, Get, Header, Inject, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { uuidSchema } from "@socialgrowth/product-contracts";
import { randomUUID } from "node:crypto";
import { DeviceAssistanceFeedService } from "./device-assistance-feed-service.js";
import { rethrowHttp } from "./product-http.js";
interface Request { headers: Record<string, string | string[] | undefined> }
const querySchema = z.strictObject({ afterTodoId: uuidSchema.optional(), pageSize: z.string().regex(/^[1-9][0-9]?$/).refine(v => Number(v) <= 50).optional() });
@Controller("api/operator/assistance-todos")
export class DeviceAssistanceFeedController {
  constructor(@Inject(DeviceAssistanceFeedService) private readonly service: DeviceAssistanceFeedService) {}
  @Get() @Header("Cache-Control", "no-store")
  async list(@Query() query: unknown, @Req() request: Request) {
    try {
      const parsed = querySchema.parse(query), header = request.headers.cookie;
      const token = (Array.isArray(header) ? header.join(";") : header)?.split(";").map(s => s.trim().split("=")).find(([k]) => k === "__Host-sg_operator_session")?.[1] ?? "";
      return await this.service.list(token, { afterTodoId: parsed.afterTodoId ?? null, pageSize: parsed.pageSize ? Number(parsed.pageSize) : 20 });
    } catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }
}
