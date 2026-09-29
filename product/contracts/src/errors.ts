import { z } from "zod";

import { contractVersionSchema, requestIdSchema } from "./common.js";

export const productErrorCodeSchema = z.enum([
  "AUTHENTICATION_REQUIRED",
  "AUTHORIZATION_DENIED",
  "CONTRACT_VERSION_UNSUPPORTED",
  "IDEMPOTENCY_KEY_REUSED",
  "IDEMPOTENCY_RESULT_EXPIRED",
  "INPUT_INVALID",
  "INVITATION_EXPIRED",
  "INVITATION_EXHAUSTED",
  "INVITATION_REVOKED",
  "PHONE_ALREADY_REGISTERED",
  "PHONE_VERIFICATION_INVALID",
  "ASSOCIATION_SESSION_EXPIRED",
  "ASSOCIATION_SESSION_CONSUMED",
  "ASSOCIATION_TARGET_CHANGED",
  "DEVICE_ALREADY_ASSOCIATED",
  "FACT_VERSION_STALE",
]);

export const productErrorResponseSchema = z.strictObject({
  contractVersion: contractVersionSchema,
  requestId: requestIdSchema,
  error: z.strictObject({
    code: productErrorCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean(),
    field: z.string().min(1).optional(),
  }),
});

export type ProductErrorCode = z.infer<typeof productErrorCodeSchema>;
export type ProductErrorResponse = z.infer<typeof productErrorResponseSchema>;
