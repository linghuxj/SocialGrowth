import { Body, Controller, Header, Inject, Post } from "@nestjs/common";
import {
  providerLoginRequestSchema,
  registerProviderRequestSchema,
  requestPhoneVerificationSchema,
  verifyPhoneCodeRequestSchema,
} from "@socialgrowth/product-contracts";

import { IdentityTransactionService } from "./identity-transactions.js";
import { ProviderAuthService } from "./provider-auth-service.js";
import {
  requestIdFrom,
  requireSupportedContract,
  rethrowHttp,
} from "./product-http.js";

@Controller("api/provider")
export class ProviderController {
  constructor(
    @Inject(ProviderAuthService) private readonly auth: ProviderAuthService,
    @Inject(IdentityTransactionService)
    private readonly identity: IdentityTransactionService,
  ) {}

  @Post("phone-verifications")
  @Header("Cache-Control", "no-store")
  async requestVerification(@Body() body: unknown) {
    const requestId = requestIdFrom(body);
    try {
      requireSupportedContract(body);
      return await this.auth.requestVerification(
        requestPhoneVerificationSchema.parse(body),
      );
    } catch (error) {
      rethrowHttp(error, requestId);
    }
  }

  @Post("phone-verifications/verify")
  @Header("Cache-Control", "no-store")
  async verifyCode(@Body() body: unknown) {
    const requestId = requestIdFrom(body);
    try {
      requireSupportedContract(body);
      return await this.auth.verifyCode(verifyPhoneCodeRequestSchema.parse(body));
    } catch (error) {
      rethrowHttp(error, requestId);
    }
  }

  @Post("register")
  @Header("Cache-Control", "no-store")
  async register(@Body() body: unknown) {
    const requestId = requestIdFrom(body);
    try {
      requireSupportedContract(body);
      const request = registerProviderRequestSchema.parse(body);
      return await this.identity.registerProvider(request, {
        verifiedPhoneVerificationId: request.phoneVerificationId,
      });
    } catch (error) {
      rethrowHttp(error, requestId);
    }
  }

  @Post("login")
  @Header("Cache-Control", "no-store")
  async login(@Body() body: unknown) {
    const requestId = requestIdFrom(body);
    try {
      requireSupportedContract(body);
      return await this.auth.login(providerLoginRequestSchema.parse(body));
    } catch (error) {
      rethrowHttp(error, requestId);
    }
  }
}
