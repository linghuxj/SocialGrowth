import { Body, Controller, Header, Headers, Inject, Post } from "@nestjs/common";
import { DeviceConnectionApi } from "./device-connection-api.js";
import { bearerTokenFrom, rethrowHttp } from "./product-http.js";

function requestId(body: unknown): string {
  if (typeof body === "object" && body !== null && "requestId" in body && typeof body.requestId === "string"
    && /^[A-Za-z0-9_-]{8,128}$/.test(body.requestId)) return body.requestId;
  return "device-connection-invalid-request";
}

@Controller("api/installation/device-connection")
export class InstallationDeviceConnectionController {
  constructor(@Inject(DeviceConnectionApi) private readonly api: DeviceConnectionApi) {}

  @Post("state") @Header("Cache-Control", "no-store")
  async state(@Body() body: unknown, @Headers("authorization") authorization?: string) {
    const id = requestId(body);
    try { return await this.api.installationState(bearerTokenFrom(authorization, "Installation"), body); }
    catch (error) { rethrowHttp(error, id); }
  }

  @Post("epoch") @Header("Cache-Control", "no-store")
  async epoch(@Body() body: unknown, @Headers("authorization") authorization?: string) {
    const id = requestId(body);
    try { return await this.api.beginEpoch(bearerTokenFrom(authorization, "Installation"), body); }
    catch (error) { rethrowHttp(error, id); }
  }

  @Post("report") @Header("Cache-Control", "no-store")
  async report(@Body() body: unknown, @Headers("authorization") authorization?: string) {
    const id = requestId(body);
    try { return await this.api.report(bearerTokenFrom(authorization, "Installation"), body); }
    catch (error) { rethrowHttp(error, id); }
  }
}

@Controller("api/provider/device-connection")
export class ProviderDeviceConnectionController {
  constructor(@Inject(DeviceConnectionApi) private readonly api: DeviceConnectionApi) {}

  @Post("state") @Header("Cache-Control", "no-store")
  async state(@Body() body: unknown, @Headers("authorization") authorization?: string) {
    const id = requestId(body);
    try { return await this.api.providerState(bearerTokenFrom(authorization, "Provider"), body); }
    catch (error) { rethrowHttp(error, id); }
  }

  @Post("pair") @Header("Cache-Control", "no-store")
  async pair(@Body() body: unknown, @Headers("authorization") authorization?: string) {
    const id = requestId(body);
    try { return await this.api.pair(bearerTokenFrom(authorization, "Provider"), body); }
    catch (error) { rethrowHttp(error, id); }
  }
}
