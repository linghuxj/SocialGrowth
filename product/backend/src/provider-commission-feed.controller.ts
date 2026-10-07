import { Controller, Get, Header, Headers, Inject, Query } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { uuidSchema } from "@socialgrowth/product-contracts";
import { bearerTokenFrom, rethrowHttp } from "./product-http.js";
import { ProviderCommissionFeedService } from "./provider-commission-feed-service.js";
const querySchema = z.strictObject({ afterIncomeId: uuidSchema.optional(), afterRevision: z.string().regex(/^[1-9][0-9]{0,15}$/)
  .refine(v => Number.isSafeInteger(Number(v))).optional(), pageSize: z.string().regex(/^[1-9][0-9]?$/).refine(v => Number(v) <= 50).optional() })
  .refine(v => (v.afterIncomeId === undefined) === (v.afterRevision === undefined));
@Controller("api/provider/commissions")
export class ProviderCommissionFeedController {
  constructor(@Inject(ProviderCommissionFeedService) private readonly service: ProviderCommissionFeedService) {}
  @Get() @Header("Cache-Control", "no-store")
  async list(@Query() query: unknown, @Headers("authorization") authorization?: string) {
    try { const p = querySchema.parse(query);
      return await this.service.list(bearerTokenFrom(authorization, "Provider"), { after: p.afterIncomeId ? { incomeId: p.afterIncomeId, revision: Number(p.afterRevision) } : null, pageSize: p.pageSize ? Number(p.pageSize) : 20 });
    } catch (e) { rethrowHttp(e, `request-${randomUUID()}`); }
  }
}
