import { Body, Controller, Header, Headers, Inject, Post } from "@nestjs/common";
import { LocalParticipationService } from "./local-participation-service.js";
import { bearerTokenFrom, rethrowHttp } from "./product-http.js";
@Controller("api/installation/participation")
export class LocalParticipationController {
  constructor(@Inject(LocalParticipationService) private readonly service: LocalParticipationService) {}
  private async call(kind: "start" | "challenge" | "confirm" | "withdraw", body: unknown, authorization?: string) {
    const requestId = typeof body === "object" && body !== null && "requestId" in body && typeof body.requestId === "string"
      && body.requestId.length >= 8 && body.requestId.length <= 128 ? body.requestId : "participation-request-unknown";
    try { return await this.service[kind](bearerTokenFrom(authorization, "Installation"), body); }
    catch (e) { rethrowHttp(e, requestId); }
  }
  @Post("start") @Header("Cache-Control", "no-store")
  start(@Body() body: unknown, @Headers("authorization") authorization?: string) { return this.call("start", body, authorization); }
  @Post("challenge") @Header("Cache-Control", "no-store")
  challenge(@Body() body: unknown, @Headers("authorization") authorization?: string) { return this.call("challenge", body, authorization); }
  @Post("confirm") @Header("Cache-Control", "no-store")
  confirm(@Body() body: unknown, @Headers("authorization") authorization?: string) { return this.call("confirm", body, authorization); }
  @Post("withdraw") @Header("Cache-Control", "no-store")
  withdraw(@Body() body: unknown, @Headers("authorization") authorization?: string) { return this.call("withdraw", body, authorization); }
}
