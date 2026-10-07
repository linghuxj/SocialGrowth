import { Body, Controller, Header, Headers, Inject, Post } from "@nestjs/common";
import {
  confirmAssociationRequestSchema,
  inspectAssociationCodeRequestSchema,
  listProviderDevicesRequestSchema,
  providerLogoutRequestSchema,
  providerRegistrationAuthResponseSchema,
  providerLoginRequestSchema,
  registerProviderRequestSchema,
  requestPhoneVerificationSchema,
  queryAssociationResultRequestSchema,
  verifyPhoneCodeRequestSchema,
} from "@socialgrowth/product-contracts";

import { IdentityTransactionService } from "./identity-transactions.js";
import { SMS_RUNTIME, type SmsRuntime } from "./sms-delivery.js";
import { ProviderAuthService } from "./provider-auth-service.js";
import {
  bearerTokenFrom,
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
    @Inject(SMS_RUNTIME) private readonly smsRuntime?: SmsRuntime,
  ) {}

  @Post("phone-verifications")
  @Header("Cache-Control", "no-store")
  async requestVerification(@Body() body: unknown) {
    const requestId = requestIdFrom(body);
    try {
      requireSupportedContract(body);
      const challenge = await this.auth.requestVerification(requestPhoneVerificationSchema.parse(body));
      // Only after existing invitation/account checks, throttling and challenge
      // persistence. Plaintext codes stay out of the database and audit payload.
      return this.smsRuntime?.readTemporaryCode
        ? { ...challenge, temporaryCode: this.smsRuntime.readTemporaryCode(challenge.challengeId) }
        : challenge;
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
      return await this.auth.logout(
        bearerTokenFrom(authorization, "Provider"),
        request.metadata.requestId,
      );
    } catch (error) {
      rethrowHttp(error, requestId);
    }
  }

  @Post("association-sessions/inspect")
  @Header("Cache-Control", "no-store")
  async inspectAssociation(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
  ) {
    const requestId = requestIdFrom(body);
    try {
      requireSupportedContract(body);
      const request = inspectAssociationCodeRequestSchema.parse(body);
      const context = await this.auth.authenticate(
        bearerTokenFrom(authorization, "Provider"),
      );
      return await this.identity.inspectAssociationCode(request, context);
    } catch (error) {
      rethrowHttp(error, requestId);
    }
  }

  @Post("association-sessions/confirm")
  @Header("Cache-Control", "no-store")
  async confirmAssociation(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
  ) {
    const requestId = requestIdFrom(body);
    try {
      requireSupportedContract(body);
      const request = confirmAssociationRequestSchema.parse(body);
      const context = await this.auth.authenticate(
        bearerTokenFrom(authorization, "Provider"),
      );
      return await this.identity.confirmAssociation(request, context);
    } catch (error) {
      rethrowHttp(error, requestId);
    }
  }

  @Post("association-sessions/result")
  @Header("Cache-Control", "no-store")
  async queryAssociationResult(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
  ) {
    const requestId = requestIdFrom(body);
    try {
      requireSupportedContract(body);
      const request = queryAssociationResultRequestSchema.parse(body);
      const context = await this.auth.authenticate(
        bearerTokenFrom(authorization, "Provider"),
      );
      return await this.identity.queryAssociationResult(request, context);
    } catch (error) {
      rethrowHttp(error, requestId);
    }
  }

  @Post("devices/list")
  @Header("Cache-Control", "no-store")
  async listDevices(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
  ) {
    const requestId = requestIdFrom(body);
    try {
      requireSupportedContract(body);
      listProviderDevicesRequestSchema.parse(body);
      const context = await this.auth.authenticate(
        bearerTokenFrom(authorization, "Provider"),
      );
      return await this.identity.listProviderDevices(context);
    } catch (error) {
      rethrowHttp(error, requestId);
    }
  }
}
