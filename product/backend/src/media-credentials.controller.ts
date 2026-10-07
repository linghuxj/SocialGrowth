import { Body, Controller, Get, Header, Headers, Inject, Param, Post, Req } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { contractVersion, mediaCredentialAccountIdSchema, readMediaCredentialResponseSchema,
  writeMediaCredentialRequestSchema, writeMediaCredentialResponseSchema } from "@socialgrowth/product-contracts";
import { MediaCredentialStore } from "./media-credential-store.js";
import { maxMediaCredentialPayloadBytes } from "./media-credential-envelope.js";
import { operatorSessionTokenFrom } from "./operator-session-cookie.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { requireSupportedContract, rethrowHttp } from "./product-http.js";
interface Request { headers: Record<string, string | string[] | undefined> }
@Controller("api/operator/media-accounts/:accountId/credentials")
export class MediaCredentialsController {
  constructor(@Inject(MediaCredentialStore) private readonly store: MediaCredentialStore) {}
  @Get() @Header("Cache-Control", "no-store")
  async read(@Param("accountId") accountInput: string, @Req() request: Request) {
    try {
      const accountId = mediaCredentialAccountIdSchema.parse(accountInput);
      const credential = await this.store.read(operatorSessionTokenFrom(request.headers.cookie), accountId);
      if (credential && credential.accountId !== accountId) throw new Error("Controlled credential metadata mismatch");
      return readMediaCredentialResponseSchema.parse({ contractVersion, credential });
    } catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }
  @Post() @Header("Cache-Control", "no-store")
  async write(@Param("accountId") accountInput: string, @Body() body: unknown, @Req() request: Request,
    @Headers("x-csrf-token") csrf: string | undefined) {
    let payload: Buffer | undefined;
    try {
      requireSupportedContract(body);
      const accountId = mediaCredentialAccountIdSchema.parse(accountInput), parsed = writeMediaCredentialRequestSchema.parse(body);
      if (parsed.accountId !== accountId) throw new ProductTransactionError("INPUT_INVALID", "Credential target does not match request path");
      const { metadata, credentialId, platform, expectedRevision, operation } = parsed;
      if (operation === "put") {
        payload = Buffer.from(parsed.payloadBase64, "base64");
        if (payload.length < 1 || payload.length > maxMediaCredentialPayloadBytes || payload.toString("base64") !== parsed.payloadBase64) {
          throw new ProductTransactionError("INPUT_INVALID", "Invalid controlled credential bytes");
        }
      }
      const result = await this.store.write(operatorSessionTokenFrom(request.headers.cookie), csrf ?? "",
        { metadata, credentialId, accountId, platform, expectedRevision, operation,
          ...(operation === "put" ? { loginIdentifier: parsed.loginIdentifier } : {}) }, payload);
      if (result.credential.accountId !== accountId || (credentialId !== null && result.credential.credentialId !== credentialId) || result.credential.platform !== platform) {
        throw new Error("Controlled credential metadata mismatch");
      }
      return writeMediaCredentialResponseSchema.parse({ contractVersion, ...result });
    } catch (error) {
      // Server-generated error trace only: never reflect sensitive request
      // body/requestId, Zod issues, original driver errors or their causes.
      rethrowHttp(error, `request-${randomUUID()}`);
    } finally { payload?.fill(0); }
  }
}
