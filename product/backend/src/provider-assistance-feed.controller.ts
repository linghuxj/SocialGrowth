import { Controller, Get, Header, Headers, Inject, Query } from "@nestjs/common";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { uuidSchema } from "@socialgrowth/product-contracts";
import { ProviderAssistanceFeedService } from "./provider-assistance-feed-service.js";
import { bearerTokenFrom, rethrowHttp } from "./product-http.js";
const querySchema = z.strictObject({ afterTodoId: uuidSchema.optional(), pageSize: z.string().regex(/^[1-9][0-9]?$/).refine(v => Number(v) <= 50).optional() });
@Controller("api/provider/assistance-todos")
export class ProviderAssistanceFeedController {
  constructor(@Inject(ProviderAssistanceFeedService) private readonly service: ProviderAssistanceFeedService) {}
  @Get() @Header("Cache-Control", "no-store")
  async list(@Query() query: unknown, @Headers("authorization") authorization?: string) {
    try {
      const parsed = querySchema.parse(query);
      return await this.service.list(bearerTokenFrom(authorization, "Provider"), { afterTodoId: parsed.afterTodoId ?? null, pageSize: parsed.pageSize ? Number(parsed.pageSize) : 20 });
    } catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }
}
