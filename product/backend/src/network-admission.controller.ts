import { Body, Controller, Header, Headers, HttpCode, HttpException, Inject, Post, Req } from "@nestjs/common";
import type { Socket } from "node:net";
import { NetworkAdmissionApi, type AdmissionRoute } from "./network-admission-api.js";

@Controller("api/installation/network-admission")
export class NetworkAdmissionController {
  constructor(@Inject(NetworkAdmissionApi) private readonly api: NetworkAdmissionApi) {}
  private async handle(route: AdmissionRoute, body: unknown, authorization: string | undefined, request: { socket: Socket }) {
    const result = await this.api.handle(route, body, authorization, request.socket);
    if (result.status !== 200) throw new HttpException(result.body as Record<string, unknown>, result.status);
    return result.body;
  }
  @Post("state") @HttpCode(200) @Header("Cache-Control", "no-store")
  state(@Body() body: unknown, @Headers("authorization") authorization: string | undefined, @Req() request: { socket: Socket }) {
    return this.handle("state", body, authorization, request);
  }
  @Post("begin") @HttpCode(200) @Header("Cache-Control", "no-store")
  begin(@Body() body: unknown, @Headers("authorization") authorization: string | undefined, @Req() request: { socket: Socket }) {
    return this.handle("begin", body, authorization, request);
  }
  @Post("challenge") @HttpCode(200) @Header("Cache-Control", "no-store")
  challenge(@Body() body: unknown, @Headers("authorization") authorization: string | undefined, @Req() request: { socket: Socket }) {
    return this.handle("challenge", body, authorization, request);
  }
  @Post("proof") @HttpCode(200) @Header("Cache-Control", "no-store")
  proof(@Body() body: unknown, @Headers("authorization") authorization: string | undefined, @Req() request: { socket: Socket }) {
    return this.handle("proof", body, authorization, request);
  }
}
