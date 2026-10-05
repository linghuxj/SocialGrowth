import { Body, Controller, Headers, HttpCode, Inject, Post } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { businessPlanWorkflowScopeSchema } from "@socialgrowth/product-contracts";
import { BusinessPlanWorkflowConsumer } from "./business-plan-workflow-store.js";

@Controller("api/internal/business-plan-workflow")
export class BusinessPlanWorkflowInternalController {
  constructor(@Inject(BusinessPlanWorkflowConsumer) private readonly workflow: BusinessPlanWorkflowConsumer) {}

  @Post("authorize-action") @HttpCode(200)
  async authorizeAction(@Headers("authorization") authorization: string | undefined, @Body() raw: unknown) {
    const secret = process.env.SG_PRODUCT_EXECUTION_RUNTIME_TOKEN ?? "";
    const supplied = authorization?.replace(/^Bearer /, "") ?? "";
    if (secret.length < 32 || supplied.length !== secret.length
      || !timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))) return { allowed: false };
    if (!raw || typeof raw !== "object") return { allowed: false };
    const input = raw as Record<string, unknown>;
    const scope = businessPlanWorkflowScopeSchema.safeParse(input.scope);
    if (!scope.success || typeof input.operationId !== "string" || typeof input.claimId !== "string"
      || typeof input.scopeFingerprint !== "string" || typeof input.stepId !== "string") return { allowed: false };
    const permit = await this.workflow.authorizeCurrentAction({ scope: scope.data, operationId: input.operationId,
      claimId: input.claimId, scopeFingerprint: input.scopeFingerprint, stepId: input.stepId });
    return permit ? { allowed: true } : { allowed: false };
  }
}
