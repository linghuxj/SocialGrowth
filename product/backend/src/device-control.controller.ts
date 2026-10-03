import { Body, Controller, Get, Header, Headers, Inject, Param, Post } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { installationSelfControlCommandRequestSchema, providerDeviceControlCommandRequestSchema, uuidSchema } from "@socialgrowth/product-contracts";
import { DeviceControlService } from "./device-control-service.js";
import { bearerTokenFrom, rethrowHttp, requireSupportedContract } from "./product-http.js";

@Controller("api/provider/devices")
export class ProviderDeviceControlController {
  constructor(@Inject(DeviceControlService) private readonly service: DeviceControlService) {}

  @Get(":deviceId/control") @Header("Cache-Control", "no-store")
  async read(@Param("deviceId") rawDeviceId: string, @Headers("authorization") authorization?: string) {
    const requestId = `request-${randomUUID()}`;
    try { return await this.service.providerRead(bearerTokenFrom(authorization, "Provider"), uuidSchema.parse(rawDeviceId).toLowerCase()); }
    catch (error) { rethrowHttp(error, requestId); }
  }

  private async command(kind: "pause" | "resume", rawDeviceId: string, body: unknown, authorization?: string) {
    const requestId = typeof body === "object" && body !== null && "metadata" in body && typeof body.metadata === "object" && body.metadata !== null
      && "requestId" in body.metadata && typeof body.metadata.requestId === "string" ? body.metadata.requestId : `request-${randomUUID()}`;
    try {
      requireSupportedContract(body);
      const deviceId = uuidSchema.parse(rawDeviceId).toLowerCase();
      const request = providerDeviceControlCommandRequestSchema.parse(body);
      return await this.service.providerCommand(bearerTokenFrom(authorization, "Provider"), deviceId, kind, request);
    } catch (error) { rethrowHttp(error, requestId); }
  }

  @Post(":deviceId/control/pause") @Header("Cache-Control", "no-store")
  pause(@Param("deviceId") deviceId: string, @Body() body: unknown, @Headers("authorization") authorization?: string) {
    return this.command("pause", deviceId, body, authorization);
  }

  @Post(":deviceId/control/resume") @Header("Cache-Control", "no-store")
  resume(@Param("deviceId") deviceId: string, @Body() body: unknown, @Headers("authorization") authorization?: string) {
    return this.command("resume", deviceId, body, authorization);
  }
}

@Controller("api/installation/self/control")
export class InstallationSelfControlController {
  constructor(@Inject(DeviceControlService) private readonly service: DeviceControlService) {}

  @Get() @Header("Cache-Control", "no-store")
  async read(@Headers("authorization") authorization?: string) {
    try { return await this.service.installationRead(bearerTokenFrom(authorization, "Installation")); }
    catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }

  @Post("pause") @Header("Cache-Control", "no-store")
  async pause(@Body() body: unknown, @Headers("authorization") authorization?: string) {
    const requestId = typeof body === "object" && body !== null && "metadata" in body && typeof body.metadata === "object" && body.metadata !== null
      && "requestId" in body.metadata && typeof body.metadata.requestId === "string" ? body.metadata.requestId : `request-${randomUUID()}`;
    try {
      requireSupportedContract(body);
      const request = installationSelfControlCommandRequestSchema.parse(body);
      return await this.service.installationPause(bearerTokenFrom(authorization, "Installation"), request);
    } catch (error) { rethrowHttp(error, requestId); }
  }
}
