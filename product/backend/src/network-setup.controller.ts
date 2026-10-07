import { Body, Controller, Header, HttpException, HttpCode, Inject, Post, Headers } from "@nestjs/common";
import { NetworkSetupApi, type NetworkSetupRoute } from "./network-setup-api.js";

@Controller("api/installation/network-setup")
export class NetworkSetupController {
  constructor(@Inject(NetworkSetupApi) private readonly api: NetworkSetupApi) {}

  private async handle(route: NetworkSetupRoute, body: unknown, authorization: string | undefined) {
    const result = await this.api.handle(route, body, authorization);
    if (result.status !== 200) throw new HttpException(result.body as Record<string, unknown>, result.status);
    return result.body;
  }

  @Post("state") @HttpCode(200) @Header("Cache-Control", "no-store")
  state(@Body() body: unknown, @Headers("authorization") authorization: string | undefined) {
    return this.handle("state", body, authorization);
  }

  @Post("key") @HttpCode(200) @Header("Cache-Control", "no-store")
  key(@Body() body: unknown, @Headers("authorization") authorization: string | undefined) {
    return this.handle("key", body, authorization);
  }
}
