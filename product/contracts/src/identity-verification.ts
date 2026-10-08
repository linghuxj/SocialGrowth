import { z } from "zod";
import { timestampSchema, uuidSchema } from "./common.js";
import { reviewAccountPreparationExecutionSchema } from "./account-preparation.js";

// Only the authenticated execution service supplies these facts. Operator
// requests contain the original task reference, never a claimed success.
export const identityVerificationReceiptSchema = z.strictObject({
  requestId: uuidSchema,
  sourceJobId: uuidSchema,
  traceId: uuidSchema,
  intentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  projectId: uuidSchema,
  accountId: uuidSchema,
  deviceId: uuidSchema,
  platform: z.enum(["facebook", "youtube"]),
  observedLoginIdentifier: z.string().trim().min(1).max(320),
  canonicalAccountRef: z.string().regex(/^[A-Za-z0-9_-]{1,150}$/),
  canonicalIdentityRef: z.string().min(1).max(100),
  observedName: z.string().trim().min(1).max(100),
  scopeRef: z.string().regex(/^[A-Za-z0-9_-]{1,150}$/),
  verifiedAt: timestampSchema,
  screenshotSha256: z.string().regex(/^[a-f0-9]{64}$/),
  appReady: z.literal(true),
  parentLoginVerified: z.literal(true),
  managementVerified: z.literal(true),
  identityCreated: z.literal(false),
  noPublication: z.literal(true),
}).refine(v => v.platform === "facebook"
  ? /^\d{5,30}$/.test(v.canonicalIdentityRef) && /^\d{5,30}$/.test(v.canonicalAccountRef)
    && v.canonicalIdentityRef !== v.canonicalAccountRef
  : /^UC[A-Za-z0-9_-]{22}$/.test(v.canonicalIdentityRef), "Complete platform identity required");

export const syncAccountPreparationIdentitySchema = reviewAccountPreparationExecutionSchema;
export type IdentityVerificationReceipt = z.infer<typeof identityVerificationReceiptSchema>;
