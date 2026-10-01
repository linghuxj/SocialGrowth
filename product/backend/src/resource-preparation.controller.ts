import { Body, Controller, Get, Header, Headers, Inject, Post, Req } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { contractVersion, registerMediaIdentityRequestSchema, reserveResourcePreparationRequestSchema, resourcePreparationResponseSchema } from "@socialgrowth/product-contracts";
import { ResourceReservationStore } from "./resource-reservation-store.js";
import { ResourceReservationError } from "./resource-reservation-core.js";
import { operatorSessionTokenFrom } from "./operator-session-cookie.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { requestIdFrom, requireSupportedContract, rethrowHttp } from "./product-http.js";
interface Request { headers: Record<string, string | string[] | undefined> }
function preparationError(error: unknown, requestId: string): never {
  if (error instanceof ResourceReservationError) {
    rethrowHttp(new ProductTransactionError(error.code === "INVALID_RESOURCE_FACTS" ? "INPUT_INVALID" : "FACT_VERSION_STALE",
      error.code === "HANDOVER_REQUIRED" ? "Resource handover is required; initial preparation cannot replace it" : "Resource preparation facts are invalid or conflicting"), requestId);
  }
  rethrowHttp(error, requestId);
}
@Controller("api/operator/resources")
export class ResourcePreparationController {
  constructor(@Inject(ResourceReservationStore) private readonly store: ResourceReservationStore) {}
  @Get("preparation") @Header("Cache-Control", "no-store")
  async read(@Req() request: Request) {
    try {
      return resourcePreparationResponseSchema.parse({ contractVersion, ...await this.store.read(operatorSessionTokenFrom(request.headers.cookie)),
        actionPermissionGranted: false, acceptanceStarted: false });
    } catch (error) { preparationError(error, `request-${randomUUID()}`); }
  }
  @Post("identities") @Header("Cache-Control", "no-store")
  async register(@Body() body: unknown, @Req() request: Request, @Headers("x-csrf-token") csrf: string | undefined) {
    try {
      requireSupportedContract(body);
      return await this.store.registerIdentity(operatorSessionTokenFrom(request.headers.cookie), csrf ?? "", registerMediaIdentityRequestSchema.parse(body));
    } catch (error) { preparationError(error, requestIdFrom(body)); }
  }
  @Post("reservations") @Header("Cache-Control", "no-store")
  async reserve(@Body() body: unknown, @Req() request: Request, @Headers("x-csrf-token") csrf: string | undefined) {
    try {
      requireSupportedContract(body);
      const result = await this.store.reserve(operatorSessionTokenFrom(request.headers.cookie), csrf ?? "", reserveResourcePreparationRequestSchema.parse(body));
      return resourcePreparationResponseSchema.parse({ contractVersion, ...result, actionPermissionGranted: false, acceptanceStarted: false });
    } catch (error) { preparationError(error, requestIdFrom(body)); }
  }
}
