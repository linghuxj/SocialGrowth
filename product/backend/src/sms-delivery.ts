import { randomBytes, timingSafeEqual } from "node:crypto";

import { ProductTransactionError } from "./product-transaction-error.js";

export const SMS_RUNTIME = Symbol("SMS_RUNTIME");

export interface SmsDelivery {
  challengeId: string;
  code: string;
  expiresAt: Date;
  phoneE164: string;
  purpose: "provider_registration" | "provider_login";
}

export interface SmsDeliveryPort {
  readonly deliveryMode?: "temporary_api";
  sendVerificationCode(input: SmsDelivery): Promise<void>;
}

export interface DevelopmentSmsCodeReader {
  readCode(input: {
    accessToken: string | undefined;
    challengeId: string;
  }): { challengeId: string; code: string };
}

export interface SmsRuntime {
  codeReader: DevelopmentSmsCodeReader;
  deliveryPort: SmsDeliveryPort;
  readTemporaryCode?: (challengeId: string) => string;
}

export class UnavailableSmsDeliveryPort implements SmsDeliveryPort {
  async sendVerificationCode(): Promise<never> {
    throw new ProductTransactionError(
      "SMS_DELIVERY_UNAVAILABLE",
      "SMS delivery is not configured",
      true,
    );
  }
}

export class DisabledDevelopmentSmsCodeReader implements DevelopmentSmsCodeReader {
  readCode(): never {
    throw new ProductTransactionError(
      "AUTHORIZATION_DENIED",
      "Development SMS code access is disabled",
    );
  }
}

interface CapturedCode {
  code: string;
  expiresAt: Date;
}

export class DevelopmentSmsCapturePort
  implements SmsDeliveryPort, DevelopmentSmsCodeReader
{
  private readonly codes = new Map<string, CapturedCode>();

  constructor(
    private readonly accessToken: string,
    private readonly now: () => Date = () => new Date(),
    private readonly maximumEntries = 1_000,
  ) {}

  async sendVerificationCode(input: SmsDelivery): Promise<void> {
    this.removeExpired();
    if (this.codes.size >= this.maximumEntries) {
      const oldestChallengeId = this.codes.keys().next().value;
      if (typeof oldestChallengeId === "string") this.codes.delete(oldestChallengeId);
    }
    this.codes.set(input.challengeId, {
      code: input.code,
      expiresAt: input.expiresAt,
    });
  }

  readCode(input: {
    accessToken: string | undefined;
    challengeId: string;
  }): { challengeId: string; code: string } {
    if (!this.authorized(input.accessToken)) {
      throw new ProductTransactionError(
        "AUTHORIZATION_DENIED",
        "Development SMS code access is denied",
      );
    }
    this.removeExpired();
    const captured = this.codes.get(input.challengeId);
    if (!captured) {
      throw new ProductTransactionError(
        "PHONE_VERIFICATION_INVALID",
        "Development SMS code is unavailable",
      );
    }
    return { challengeId: input.challengeId, code: captured.code };
  }

  private authorized(candidate: string | undefined): boolean {
    if (!candidate) return false;
    const expected = Buffer.from(this.accessToken, "utf8");
    const actual = Buffer.from(candidate, "utf8");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private removeExpired(): void {
    const now = this.now();
    for (const [challengeId, captured] of this.codes) {
      if (captured.expiresAt <= now) this.codes.delete(challengeId);
    }
  }
}

// Only wired by explicit temporary_api mode. The private token stays in this
// process; neither the Android APK nor the development reader receives it.
export class TemporaryApiSmsDeliveryPort implements SmsDeliveryPort {
  readonly deliveryMode = "temporary_api" as const;
  private readonly token = randomBytes(32).toString("hex");
  private readonly capture: DevelopmentSmsCapturePort;
  constructor(now: () => Date = () => new Date(), maximumEntries = 1_000) {
    this.capture = new DevelopmentSmsCapturePort(this.token, now, maximumEntries);
  }
  async sendVerificationCode(input: SmsDelivery): Promise<void> { await this.capture.sendVerificationCode(input); }
  readTemporaryCode(challengeId: string): string {
    return this.capture.readCode({ accessToken: this.token, challengeId }).code;
  }
}
