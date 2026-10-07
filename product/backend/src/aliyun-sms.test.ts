import test from "node:test";
import assert from "node:assert/strict";
import { AliyunSmsDeliveryPort, readAliyunSmsConfig, type AliyunSmsConfig } from "./aliyun-sms.js";
import type { SmsDelivery } from "./sms-delivery.js";
import { readBackendConfig } from "./config.js";
const config: AliyunSmsConfig = { accessKeyId: "test-id", accessKeySecret: "secret-canary", signName: "测试签名", registrationTemplate: "SMS_register1", loginTemplate: "SMS_login1", codeParameter: "code", timeoutMs: 1000 };
const delivery: SmsDelivery = { challengeId: "00000000-0000-4000-8000-000000000001", phoneE164: "+8613800000401", code: "123456", purpose: "provider_registration", expiresAt: new Date(Date.now() + 300000) };
test("Aliyun config is explicit; disabled mode rejects dormant credentials", () => {
  assert.equal(readAliyunSmsConfig({}), null);
  assert.throws(() => readAliyunSmsConfig({ SG_PRODUCT_SMS_MODE: "aliyun" }), /CONFIGURATION_REQUIRED/);
  assert.throws(() => readAliyunSmsConfig({ SG_PRODUCT_SMS_ALIYUN_ACCESS_KEY_SECRET: "canary" }), /CONFIGURATION_REQUIRED/);
  assert.equal(readBackendConfig({ SG_PRODUCT_SMS_MODE: "aliyun", SG_PRODUCT_BACKEND_HOST: "0.0.0.0" }).SG_PRODUCT_SMS_MODE, "aliyun");
  assert.throws(() => readBackendConfig({ SG_PRODUCT_SMS_MODE: "aliyun", SG_PRODUCT_DEVELOPMENT_SMS_TOKEN: "x".repeat(32) }));
  // Construction loads the actual SDK, but never sends a request.
  assert.ok(new AliyunSmsDeliveryPort(config));
});
test("one SDK call uses the correct purpose template and disables retries", async () => {
  let calls = 0;
  const port = new AliyunSmsDeliveryPort(config, { async sendSmsWithOptions(request, runtime) {
    calls++;
    assert.equal(request.phoneNumbers, "13800000401");
    assert.equal(request.templateCode, calls === 1 ? config.registrationTemplate : config.loginTemplate);
    assert.equal(request.templateParam, '{"code":"123456"}');
    assert.equal(request.outId, delivery.challengeId);
    assert.equal(runtime.autoretry, false); assert.equal(runtime.maxAttempts, 1);
    return { body: { code: "OK" } } as Awaited<ReturnType<typeof this.sendSmsWithOptions>>;
  } });
  await port.sendVerificationCode(delivery);
  await port.sendVerificationCode({ ...delivery, purpose: "provider_login" });
  assert.equal(calls, 2);
});
test("provider errors are sanitized, not retried, and unsupported numbers never send", async () => {
  let calls = 0;
  const port = new AliyunSmsDeliveryPort(config, { async sendSmsWithOptions() { calls++; throw new Error("secret-canary +8613800000401 123456"); } });
  await assert.rejects(port.sendVerificationCode(delivery), error => error instanceof Error && !/secret-canary|13800000401|123456/.test(error.message));
  assert.equal(calls, 1);
  await assert.rejects(port.sendVerificationCode({ ...delivery, phoneE164: "+12025550123" }));
  await assert.rejects(port.sendVerificationCode({ ...delivery, expiresAt: new Date(0) }));
  assert.equal(calls, 1);
});
