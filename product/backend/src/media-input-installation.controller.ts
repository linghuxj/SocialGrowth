import { Body, Controller, Get, Header, Headers, HttpCode, Inject, Post } from "@nestjs/common";
import { z } from "zod";
import { InstallationAuthService } from "./installation-auth-service.js";
import { MediaInputAuthority } from "./media-input-authority.js";
import { bearerTokenFrom, rethrowHttp } from "./product-http.js";

const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const generation = z.number().int().positive().safe();
const base64url = (max: number) => z.string().min(1).max(Math.ceil(max * 4 / 3)).regex(/^[A-Za-z0-9_-]+$/);
const contract = z.literal("media-credential-input-v1");
const enrollment = z.strictObject({ contractVersion: contract, installationId: uuid,
  installationGeneration: generation, publicKeySpki: base64url(256) });
const complete = enrollment.extend({ challengeId: uuid, proof: base64url(72) });
const consume = z.strictObject({ contractVersion: contract, requestId: uuid, envelopeSha256: base64url(32) });
const status = z.strictObject({ contractVersion: contract, requestId: uuid, actionId: uuid,
  statusFrameBase64Url: base64url(8192) });

@Controller("api/installation/media-credential-input")
export class MediaInputInstallationController {
  constructor(
    @Inject(InstallationAuthService) private readonly auth: InstallationAuthService,
    @Inject(MediaInputAuthority) private readonly authority: MediaInputAuthority,
  ) {}

  @Get("grant-keys")
  @Header("Cache-Control", "no-store")
  async grantKeys(@Headers("authorization") authorization?: string) {
    try {
      const token = bearerTokenFrom(authorization, "Installation");
      const context = await this.auth.authenticate(token);
      return await this.authority.grantKeys(token, context);
    } catch (error) { rethrowHttp(error, "request-media-input-keyset"); }
  }

  @Post("enrollment/challenge")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async enrollmentChallenge(@Body() body: unknown, @Headers("authorization") authorization?: string) {
    try {
      const request = enrollment.parse(body);
      const token = bearerTokenFrom(authorization, "Installation");
      const context = await this.auth.authenticate(token);
      return await this.authority.enrollmentChallenge(token, context, request);
    } catch (error) { rethrowHttp(error, "request-media-input-enrollment"); }
  }

  @Post("enrollment/complete")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async completeEnrollment(@Body() body: unknown, @Headers("authorization") authorization?: string) {
    try {
      const request = complete.parse(body);
      const token = bearerTokenFrom(authorization, "Installation");
      const context = await this.auth.authenticate(token);
      return await this.authority.completeEnrollment(token, context, request);
    } catch (error) { rethrowHttp(error, "request-media-input-enrollment"); }
  }

  @Post("actions/consume")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async consumeOnce(@Body() body: unknown, @Headers("authorization") authorization?: string) {
    try {
      const request = consume.parse(body);
      const token = bearerTokenFrom(authorization, "Installation");
      const context = await this.auth.authenticate(token);
      return await this.authority.consumeOnce(token, context, request);
    } catch (error) { rethrowHttp(error, "request-media-input-consume"); }
  }

  @Post("actions/status")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async recordStatus(@Body() body: unknown, @Headers("authorization") authorization?: string) {
    try {
      const request = status.parse(body);
      const token = bearerTokenFrom(authorization, "Installation");
      const context = await this.auth.authenticate(token);
      return await this.authority.recordStatus(token, context, request);
    } catch (error) { rethrowHttp(error, "request-media-input-status"); }
  }
}
