import { Body, Controller, Header, Headers, Inject, Param, Post } from "@nestjs/common";
import { providerDeviceLabelRequestSchema, uuidSchema } from "@socialgrowth/product-contracts";
import { randomUUID } from "node:crypto";
import { IdentityTransactionService } from "./identity-transactions.js";
import { ProviderAuthService } from "./provider-auth-service.js";
import { bearerTokenFrom, requestIdFrom, requireSupportedContract, rethrowHttp } from "./product-http.js";

@Controller("api/provider")
export class ProviderDeviceLabelController {
  constructor(
    @Inject(ProviderAuthService) private readonly auth: ProviderAuthService,
    @Inject(IdentityTransactionService) private readonly identity: IdentityTransactionService,
  ) {}

  @Post("devices/:deviceId/label")
  @Header("Cache-Control", "no-store")
  async rename(
    @Param("deviceId") deviceId: string,
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
  ) {
    const requestId = requestIdFrom(body);
    try {
      requireSupportedContract(body);
      const targetDeviceId = uuidSchema.parse(deviceId);
      const request = providerDeviceLabelRequestSchema.parse(body);
      const sessionToken = bearerTokenFrom(authorization, "Provider");
      return await this.identity.renameProviderDevice(this.auth, sessionToken, targetDeviceId, request);
    } catch (error) {
      rethrowHttp(error, requestId || `request-${randomUUID()}`);
    }
  }
}
