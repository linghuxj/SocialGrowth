import { Body, Controller, Header, Headers, Inject, Post } from "@nestjs/common";
import {
  providerLogoutRequestSchema,
  providerRegistrationAuthResponseSchema,
  providerLoginRequestSchema,
  registerProviderRequestSchema,
  requestPhoneVerificationSchema,
  verifyPhoneCodeRequestSchema,
} from "@socialgrowth/product-contracts";

import { IdentityTransactionService } from "./identity-transactions.js";
import { ProviderAuthService } from "./provider-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
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
      const registration = await this.identity.registerProvider(request, {
        verifiedPhoneVerificationId: request.phoneVerificationId,
      });
      const auth = await this.auth.completeRegistrationSession(
        request.phoneVerificationId,
        request.metadata.requestId,
      );
      return providerRegistrationAuthResponseSchema.parse({ registration, ...auth });
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

  @Post("logout")
  @Header("Cache-Control", "no-store")
  async logout(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
  ) {
    const requestId = requestIdFrom(body);
    try {
      requireSupportedContract(body);
      const request = providerLogoutRequestSchema.parse(body);
      const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization ?? "");
      if (!match?.[1]) {
        throw new ProductTransactionError(
          "AUTHENTICATION_REQUIRED",
          "Provider bearer token is required",
        );
      }
      return await this.auth.logout(match[1], request.metadata.requestId);
    } catch (error) {
      rethrowHttp(error, requestId);
    }
  }
}
