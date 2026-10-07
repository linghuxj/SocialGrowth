import { Body, Controller, Get, Header, Headers, Inject, Param, Post, Req } from "@nestjs/common";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { uuidSchema } from "@socialgrowth/product-contracts";
import { MetricSnapshotStore } from "./metric-snapshot-store.js";
import { operatorSessionTokenFrom } from "./operator-session-cookie.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { rethrowHttp } from "./product-http.js";
import { PageMetricSource } from "./page-metric-source.js";

interface Request { headers: Record<string, string | string[] | undefined>; body?: unknown }

@Controller("api/operator/projects/:projectId/feedback")
export class MetricFeedbackController {
  constructor(@Inject(MetricSnapshotStore) private readonly store: MetricSnapshotStore,
    @Inject(PageMetricSource) private readonly source: PageMetricSource) {}

  @Post("collect") @Header("Cache-Control", "no-store")
  async collect(@Param("projectId") projectId: string, @Req() request: Request, @Headers("x-csrf-token") csrf: string | undefined, @Body() body: unknown) {
    try {
      if (!body || typeof body !== "object" || Object.keys(body).join(",") !== "operationId") throw new ProductTransactionError("INPUT_INVALID", "只接受采集操作编号");
      return await this.source.collect(operatorSessionTokenFrom(request.headers.cookie), csrf ?? "", uuidSchema.parse(projectId), uuidSchema.parse((body as { operationId: unknown }).operationId));
    } catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }
  @Get("collection") @Header("Cache-Control", "no-store")
  async collection(@Param("projectId") projectId: string, @Req() request: Request) {
    try { return { collection: await this.source.readLatest(operatorSessionTokenFrom(request.headers.cookie), uuidSchema.parse(projectId)) }; }
    catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }
  @Post("collect/:operationId/sync") @Header("Cache-Control", "no-store")
  async sync(@Param("projectId") projectId: string, @Param("operationId") operationId: string, @Req() request: Request,
    @Headers("x-csrf-token") csrf: string | undefined) {
    try {
      const token = operatorSessionTokenFrom(request.headers.cookie);
      // Re-use the exact operation's idempotency check and current operator scope.
      const row = await this.source.collect(token, csrf ?? "", uuidSchema.parse(projectId), uuidSchema.parse(operationId));
      const reports = this.source.reports(row);
      if (row.state !== "completed" || !reports.length) throw new ProductTransactionError("FACT_VERSION_STALE", "采集尚未形成已核验报告");
      for (const report of reports) await this.store.ingestCurrent({ sourceId: report.sourceId, sourceReportId: report.sourceReportId });
      return this.store.readProjectFeedback(token, projectId);
    } catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }

  @Get()
  @Header("Cache-Control", "no-store")
  async read(@Param("projectId") projectId: string, @Req() request: Request) {
    try {
      if (request.body !== undefined) throw new ProductTransactionError("INPUT_INVALID", "Feedback read does not accept a body");
      return await this.store.readProjectFeedback(operatorSessionTokenFrom(request.headers.cookie), uuidSchema.parse(projectId));
    } catch (error) {
      rethrowHttp(error, `request-${randomUUID()}`);
    }
  }
}

@Controller("api/internal/page-metrics")
export class PageMetricAuthorizationController {
  constructor(@Inject(PageMetricSource) private readonly source: PageMetricSource) {}
  @Post("authorize")
  async authorize(@Headers("authorization") authorization: string | undefined, @Body() body: unknown) {
    const token = process.env.SG_PRODUCT_EXECUTION_RUNTIME_TOKEN ?? "", supplied = authorization?.replace(/^Bearer /, "") ?? "";
    if (token.length < 32 || token.length !== supplied.length || !timingSafeEqual(Buffer.from(token), Buffer.from(supplied))) return { allowed: false };
    try {
      if (!body || typeof body !== "object") return { allowed: false };
      const row = body as Record<string, unknown>;
      return { allowed: await this.source.scopeAllowed(uuidSchema.parse(row.projectId), uuidSchema.parse(row.identityId), uuidSchema.parse(row.accountId)) };
    } catch { return { allowed: false }; }
  }
}
