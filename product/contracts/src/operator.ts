import { z } from "zod";

import {
  requestMetadataSchema,
  requestTraceSchema,
  timestampSchema,
  uuidSchema,
} from "./common.js";
import { sessionSummarySchema } from "./identity.js";

export const operatorLoginNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9._-]{2,63}$/);

export const operatorPasswordSchema = z.string().min(12).max(128);
export const operatorStatusSchema = z.enum(["active", "disabled"]);
export const operatorDisplayNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(
    /^[^\s\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff](?:[\s\S]*[^\s\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff])?$/,
  );

const operatorBaseShape = {
  operatorId: uuidSchema,
  loginName: operatorLoginNameSchema,
  displayName: operatorDisplayNameSchema,
  factVersion: z.int().nonnegative(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
};

export const activeOperatorViewSchema = z.strictObject({
  ...operatorBaseShape,
  status: z.literal("active"),
  disabledAt: z.null(),
});

export const disabledOperatorViewSchema = z.strictObject({
  ...operatorBaseShape,
  status: z.literal("disabled"),
  disabledAt: timestampSchema,
});

export const operatorViewSchema = z.discriminatedUnion("status", [
  activeOperatorViewSchema,
  disabledOperatorViewSchema,
]);

export const operatorLoginRequestSchema = z.strictObject({
  metadata: requestTraceSchema,
  loginName: operatorLoginNameSchema,
  password: operatorPasswordSchema,
});

export const operatorLoginResponseSchema = z.strictObject({
  operator: activeOperatorViewSchema,
  session: sessionSummarySchema,
  csrfToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

export const createOperatorRequestSchema = z.strictObject({
  metadata: requestMetadataSchema,
  loginName: operatorLoginNameSchema,
  displayName: operatorDisplayNameSchema,
  initialPassword: operatorPasswordSchema,
});

export const createOperatorResponseSchema = z.strictObject({
  operator: activeOperatorViewSchema,
});

export const disableOperatorRequestSchema = z.strictObject({
  metadata: requestMetadataSchema,
  operatorId: uuidSchema,
  expectedFactVersion: z.int().nonnegative(),
});

export const disableOperatorResponseSchema = z.strictObject({
  operator: disabledOperatorViewSchema,
  revokedSessionCount: z.int().nonnegative(),
});

export const listOperatorsResponseSchema = z.strictObject({
  operators: z.array(operatorViewSchema),
});

export type OperatorView = z.infer<typeof operatorViewSchema>;
export type OperatorLoginRequest = z.infer<typeof operatorLoginRequestSchema>;
export type OperatorLoginResponse = z.infer<typeof operatorLoginResponseSchema>;
export type CreateOperatorRequest = z.infer<typeof createOperatorRequestSchema>;
export type DisableOperatorRequest = z.infer<typeof disableOperatorRequestSchema>;
