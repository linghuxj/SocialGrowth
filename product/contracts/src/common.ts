import { z } from "zod";

export const contractVersion = "2026-09-29.identity-v1" as const;
export const contractVersionSchema = z.literal(contractVersion);
export const uuidSchema = z.uuid();
export const timestampSchema = z.iso.datetime({ offset: true });
export const requestIdSchema = z.string().min(8).max(128);
export const idempotencyKeySchema = z.string().min(16).max(128);

export const requestMetadataSchema = z.strictObject({
  contractVersion: contractVersionSchema,
  requestId: requestIdSchema,
  idempotencyKey: idempotencyKeySchema,
});

export const requestTraceSchema = z.strictObject({
  contractVersion: contractVersionSchema,
  requestId: requestIdSchema,
});

export const versionedFactSchema = z.strictObject({
  factVersion: z.int().nonnegative(),
  updatedAt: timestampSchema,
});
