import { createRequire } from "node:module";
import { z } from "zod";
import type { SendSmsRequest, SendSmsResponse } from "@alicloud/dysmsapi20170525";
import { Config } from "@alicloud/openapi-client";
import { RuntimeOptions } from "@alicloud/tea-util";
import type { SmsDelivery, SmsDeliveryPort } from "./sms-delivery.js";
import { ProductTransactionError } from "./product-transaction-error.js";

const schema = z.strictObject({
  accessKeyId: z.string().min(1), accessKeySecret: z.string().min(1), securityToken: z.string().min(1).optional(),
  signName: z.string().trim().min(1).max(100), registrationTemplate: z.string().regex(/^SMS_[A-Za-z0-9]+$/),
  loginTemplate: z.string().regex(/^SMS_[A-Za-z0-9]+$/), codeParameter: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/),
  timeoutMs: z.number().int().min(1000).max(30000),
});
export type AliyunSmsConfig = z.infer<typeof schema>;
const fields = ["ACCESS_KEY_ID", "ACCESS_KEY_SECRET", "SECURITY_TOKEN", "SIGN_NAME", "REGISTRATION_TEMPLATE", "LOGIN_TEMPLATE", "CODE_PARAMETER", "TIMEOUT_MS"];
export function readAliyunSmsConfig(env: NodeJS.ProcessEnv = process.env): AliyunSmsConfig | null {
  // Explicit temporary mode retains provider settings for switching back, but never constructs the SDK.
  if (env.SG_PRODUCT_SMS_MODE === "temporary_api") return null;
  if (env.SG_PRODUCT_SMS_MODE !== "aliyun") {
    if (fields.some(key => env[`SG_PRODUCT_SMS_ALIYUN_${key}`] !== undefined)) throw new Error("ALIYUN_SMS_CONFIGURATION_REQUIRED");
    return null;
  }
  const parsed = schema.safeParse({ accessKeyId: env.SG_PRODUCT_SMS_ALIYUN_ACCESS_KEY_ID, accessKeySecret: env.SG_PRODUCT_SMS_ALIYUN_ACCESS_KEY_SECRET,
    ...(env.SG_PRODUCT_SMS_ALIYUN_SECURITY_TOKEN ? { securityToken: env.SG_PRODUCT_SMS_ALIYUN_SECURITY_TOKEN } : {}),
    signName: env.SG_PRODUCT_SMS_ALIYUN_SIGN_NAME, registrationTemplate: env.SG_PRODUCT_SMS_ALIYUN_REGISTRATION_TEMPLATE,
    loginTemplate: env.SG_PRODUCT_SMS_ALIYUN_LOGIN_TEMPLATE, codeParameter: env.SG_PRODUCT_SMS_ALIYUN_CODE_PARAMETER ?? "code",
    timeoutMs: Number(env.SG_PRODUCT_SMS_ALIYUN_TIMEOUT_MS ?? "10000") });
  if (!parsed.success) throw new Error("ALIYUN_SMS_CONFIGURATION_REQUIRED");
  return parsed.data;
}
interface SmsClient { sendSmsWithOptions(request: SendSmsRequest, runtime: RuntimeOptions): Promise<SendSmsResponse> }
// CJS SDK exposes its constructor through .default under native Node ESM.
const sdk = createRequire(import.meta.url)("@alicloud/dysmsapi20170525") as {
  default: new (config: Config) => SmsClient;
  SendSmsRequest: new (input: Record<string, string>) => SendSmsRequest;
};
export class AliyunSmsDeliveryPort implements SmsDeliveryPort {
  private readonly client: SmsClient;
  constructor(private readonly config: AliyunSmsConfig, client?: SmsClient) {
    this.client = client ?? new sdk.default(new Config({ accessKeyId: config.accessKeyId, accessKeySecret: config.accessKeySecret,
      securityToken: config.securityToken, endpoint: "dysmsapi.aliyuncs.com", regionId: "cn-hangzhou", protocol: "HTTPS", type: config.securityToken ? "sts" : "access_key" }));
  }
  async sendVerificationCode(input: SmsDelivery): Promise<void> {
    // This adapter targets China-site domestic verification templates only.
    if (!/^\+861[0-9]{10}$/.test(input.phoneE164) || !/^[0-9]{4,8}$/.test(input.code) || input.expiresAt.getTime() <= Date.now()) {
      throw new ProductTransactionError("SMS_DELIVERY_UNAVAILABLE", "短信接收号码或验证码配置不可用", false);
    }
    const request = new sdk.SendSmsRequest({ phoneNumbers: input.phoneE164.slice(3), signName: this.config.signName,
      templateCode: input.purpose === "provider_registration" ? this.config.registrationTemplate : this.config.loginTemplate,
      templateParam: JSON.stringify({ [this.config.codeParameter]: input.code }), outId: input.challengeId });
    try {
      const result = await this.client.sendSmsWithOptions(request, new RuntimeOptions({ autoretry: false, maxAttempts: 1,
        connectTimeout: this.config.timeoutMs, readTimeout: this.config.timeoutMs }));
      if (result.body?.code !== "OK") throw new Error("SMS_NOT_ACCEPTED");
      // API acceptance is not a handset-delivery receipt. No code/phone/provider error is logged.
    } catch { throw new ProductTransactionError("SMS_DELIVERY_UNAVAILABLE", "短信发送未确认，请稍后检查发送记录", false); }
  }
}
