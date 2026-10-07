import { Body, Controller, Get, Header, Headers, Inject, Param, Post, Req } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { createMediaAccountResponseSchema, mediaAccountCommandLookupResponseSchema,
  mediaAccountListResponseSchema, updateMediaAccountResponseSchema } from "@socialgrowth/product-contracts";
import { MediaAccountStore } from "./media-account-store.js";
import { operatorSessionTokenFrom } from "./operator-session-cookie.js";
import { rethrowHttp, requireSupportedContract } from "./product-http.js";
interface Request { headers: Record<string, string | string[] | undefined> }

@Controller("api/operator/media-accounts")
export class MediaAccountsController {
  constructor(@Inject(MediaAccountStore) private readonly store: MediaAccountStore) {}
  @Get() @Header("Cache-Control", "no-store")
  async list(@Req() request: Request) {
    try { return mediaAccountListResponseSchema.parse(await this.store.read(operatorSessionTokenFrom(request.headers.cookie))); }
    catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }
  @Get("commands/:idempotencyKey") @Header("Cache-Control", "no-store")
  async lookup(@Param("idempotencyKey") key: string, @Req() request: Request) {
    try { return mediaAccountCommandLookupResponseSchema.parse(await this.store.lookup(operatorSessionTokenFrom(request.headers.cookie), key)); }
    catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }
  @Post() @Header("Cache-Control", "no-store")
  async create(@Body() body: unknown, @Req() request: Request, @Headers("x-csrf-token") csrf: string | undefined) {
    try { requireSupportedContract(body); return createMediaAccountResponseSchema.parse(await this.store.create(operatorSessionTokenFrom(request.headers.cookie), csrf ?? "", body)); }
    catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }
  @Post(":accountId/profile") @Header("Cache-Control", "no-store")
  async profile(@Param("accountId") accountId: string, @Body() body: unknown, @Req() request: Request,
    @Headers("x-csrf-token") csrf: string | undefined) {
    try { requireSupportedContract(body); return updateMediaAccountResponseSchema.parse(await this.store.updateProfile(operatorSessionTokenFrom(request.headers.cookie), csrf ?? "", accountId, body)); }
    catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }
}
