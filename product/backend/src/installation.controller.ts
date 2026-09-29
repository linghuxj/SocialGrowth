import { Body, Controller, Header, Headers, Inject, Post } from "@nestjs/common";
import {
  bootstrapInstallationRequestSchema,
  createAssociationSessionRequestSchema,
  installationStateRequestSchema,
} from "@socialgrowth/product-contracts";

import { IdentityTransactionService } from "./identity-transactions.js";
import { InstallationAuthService } from "./installation-auth-service.js";
import {
  bearerTokenFrom,
  requestIdFrom,
  requireSupportedContract,
  rethrowHttp,
} from "./product-http.js";

@Controller("api/installation")
export class InstallationController {
  constructor(
    @Inject(InstallationAuthService)
    private readonly auth: InstallationAuthService,
    @Inject(IdentityTransactionService)
    private readonly identity: IdentityTransactionService,
  ) {}

  @Post("bootstrap")
  @Header("Cache-Control", "no-store")
  async bootstrap(@Body() body: unknown) {
    const requestId = requestIdFrom(body);
    try {
      requireSupportedContract(body);
      return await this.auth.bootstrap(bootstrapInstallationRequestSchema.parse(body));
    } catch (error) {
      rethrowHttp(error, requestId);
    }
  }

  @Post("association-sessions")
  @Header("Cache-Control", "no-store")
  async createAssociationSession(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
  ) {
    const requestId = requestIdFrom(body);
    try {
      requireSupportedContract(body);
      const request = createAssociationSessionRequestSchema.parse(body);
      const context = await this.auth.authenticate(
        bearerTokenFrom(authorization, "Installation"),
      );
      return await this.identity.createAssociationSession(request, context);
    } catch (error) {
      rethrowHttp(error, requestId);
    }
  }

  @Post("state")
  @Header("Cache-Control", "no-store")
  async state(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
  ) {
    const requestId = requestIdFrom(body);
    try {
      requireSupportedContract(body);
      installationStateRequestSchema.parse(body);
      const context = await this.auth.authenticate(
        bearerTokenFrom(authorization, "Installation"),
      );
      return await this.identity.getInstallationState(context);
    } catch (error) {
      rethrowHttp(error, requestId);
    }
  }
}
