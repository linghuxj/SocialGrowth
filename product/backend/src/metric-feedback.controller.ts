import { Controller, Get, Header, Inject, Param, Req } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { uuidSchema } from "@socialgrowth/product-contracts";
import { MetricSnapshotStore } from "./metric-snapshot-store.js";
import { operatorSessionTokenFrom } from "./operator-session-cookie.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { rethrowHttp } from "./product-http.js";

interface Request { headers: Record<string, string | string[] | undefined>; body?: unknown }

@Controller("api/operator/projects/:projectId/feedback")
export class MetricFeedbackController {
  constructor(@Inject(MetricSnapshotStore) private readonly store: MetricSnapshotStore) {}

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
