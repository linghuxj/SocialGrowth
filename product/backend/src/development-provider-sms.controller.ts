import {
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  Inject,
  Post,
} from "@nestjs/common";
import { requestTraceSchema } from "@socialgrowth/product-contracts";
import { z } from "zod";

import { requestIdFrom, rethrowHttp } from "./product-http.js";
import { SMS_RUNTIME, type SmsRuntime } from "./sms-delivery.js";

const readDevelopmentSmsCodeRequestSchema = z.strictObject({
  challengeId: z.uuid(),
  requestId: requestTraceSchema.shape.requestId,
});

const developmentSmsCodeResponseSchema = z.strictObject({
  challengeId: z.uuid(),
  code: z.string().regex(/^[0-9]{4,8}$/),
});

@Controller("internal/development/provider-sms-codes")
export class DevelopmentProviderSmsController {
  constructor(@Inject(SMS_RUNTIME) private readonly smsRuntime: SmsRuntime) {}

  @Post("read")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  readCode(
    @Headers("x-development-sms-token") accessToken: string | undefined,
    @Body() body: unknown,
  ) {
    const requestId = requestIdFrom({
      metadata: {
        requestId:
          typeof body === "object" && body !== null && "requestId" in body
            ? body.requestId
            : undefined,
      },
    });
    try {
      const request = readDevelopmentSmsCodeRequestSchema.parse(body);
      return developmentSmsCodeResponseSchema.parse(
        this.smsRuntime.codeReader.readCode({
          accessToken,
          challengeId: request.challengeId,
        }),
      );
    } catch (error) {
      rethrowHttp(error, requestId);
    }
  }
}
