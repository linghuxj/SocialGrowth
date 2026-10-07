import { HttpException } from "@nestjs/common";
import {
  contractVersion,
  productErrorResponseSchema,
  requestTraceSchema,
} from "@socialgrowth/product-contracts";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";

import { ProductTransactionError } from "./product-transaction-error.js";

export function bearerTokenFrom(
  authorization: string | undefined,
  principal: "Installation" | "Provider",
): string {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization ?? "");
  if (!match?.[1]) {
    throw new ProductTransactionError(
      "AUTHENTICATION_REQUIRED",
      `${principal} bearer token is required`,
    );
  }
  return match[1];
}

export function requestIdFrom(value: unknown): string {
  if (typeof value === "object" && value !== null && "metadata" in value) {
    const metadata = value.metadata;
    if (
      typeof metadata === "object" &&
      metadata !== null &&
      "requestId" in metadata &&
      typeof metadata.requestId === "string"
    ) {
      const parsed = requestTraceSchema.shape.requestId.safeParse(metadata.requestId);
      if (parsed.success) return parsed.data;
    }
  }
  return `request-${randomUUID()}`;
}

export function requireSupportedContract(value: unknown): void {
  if (typeof value !== "object" || value === null || !("metadata" in value)) return;
  const metadata = value.metadata;
  if (
    typeof metadata === "object" &&
    metadata !== null &&
    "contractVersion" in metadata &&
    typeof metadata.contractVersion === "string" &&
    metadata.contractVersion !== contractVersion
  ) {
    throw new ProductTransactionError(
      "CONTRACT_VERSION_UNSUPPORTED",
      "Contract version is unsupported",
    );
  }
}

function statusFor(error: ProductTransactionError): number {
  if (
    error.code === "LOGIN_RATE_LIMITED" ||
    error.code === "INSTALLATION_BOOTSTRAP_RATE_LIMITED" ||
    error.code === "PHONE_VERIFICATION_RATE_LIMITED"
  ) return 429;
  if (error.code === "SMS_DELIVERY_UNAVAILABLE") return 503;
  if (error.code === "AUTHENTICATION_REQUIRED" || error.code === "INVALID_CREDENTIALS") {
    return 401;
  }
  if (
    error.code === "AUTHORIZATION_DENIED" ||
    error.code === "OPERATOR_DISABLED" ||
    error.code === "PROVIDER_DISABLED"
  ) return 403;
  if (
    error.code === "FACT_VERSION_STALE" ||
    error.code === "LAST_ACTIVE_OPERATOR" ||
    error.code === "OPERATOR_ALREADY_EXISTS" ||
    error.code === "INVITATION_REVOKED" ||
    error.code === "ASSOCIATION_SESSION_CONSUMED" ||
    error.code === "ASSOCIATION_TARGET_CHANGED" ||
    error.code === "DEVICE_ALREADY_ASSOCIATED" ||
    error.code.startsWith("IDEMPOTENCY_")
  ) {
    return 409;
  }
  return 400;
}

export function rethrowHttp(error: unknown, requestId: string): never {
  const transactionError =
    error instanceof ProductTransactionError
      ? error
      : error instanceof ZodError
        ? new ProductTransactionError("INPUT_INVALID", "Request payload is invalid")
        : new ProductTransactionError(
            "INTERNAL_ERROR",
            "The service could not complete the request",
            true,
          );
  throw new HttpException(
    productErrorResponseSchema.parse({
      contractVersion,
      requestId,
      error: {
        code: transactionError.code,
        message: transactionError.message,
        retryable: transactionError.retryable,
      },
    }),
    transactionError.code === "INTERNAL_ERROR" ? 500 : statusFor(transactionError),
  );
}
