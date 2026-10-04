import { z } from "zod";
import { contractVersionSchema, requestMetadataSchema, uuidSchema } from "./common.js";

const id = uuidSchema;
const platform = z.enum(["facebook", "youtube"]);
const version = z.int().min(0).max(Number.MAX_SAFE_INTEGER);
const reference = z.string().regex(/^[A-Za-z0-9_-]{1,150}$(?![\s\S])/);
const metadata = requestMetadataSchema.extend({
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,128}$(?![\s\S])/),
});
const label = z.string().min(1).max(200).refine(value => value.trim() === value && !value.includes("\u0000"));
const loginIdentifier = z.string().min(1).max(320).refine(value => value.trim() === value && !value.includes("\u0000"));
const personaSchema = z.strictObject({
  name: z.string().max(200).nullable(),
  birthday: z.iso.date().nullable(),
  gender: z.string().max(80).nullable(),
});
const credentialSchema = z.strictObject({
  credentialId: id,
  revision: z.int().min(1).max(Number.MAX_SAFE_INTEGER),
  state: z.enum(["stored_unverified", "invalidated"]),
});
const publishingIdentitySchema = z.strictObject({
  identityId: id,
  canonicalIdentityRef: reference,
  verificationState: z.enum(["registered_unverified", "verified", "blocked"]),
  managementState: z.enum(["unknown", "managed", "not_managed"]),
});
const assignmentSchema = z.strictObject({
  projectId: id,
  deviceId: id,
  state: z.literal("pending_initialization"),
  handoverRequested: z.boolean(),
});
export const mediaAccountSchema = z.strictObject({
  accountId: id,
  platform,
  displayName: label,
  loginIdentifier: loginIdentifier.nullable(),
  canonicalAccountRef: reference.nullable(),
  legacyDeclaredCanonicalAccountRef: reference.nullable(),
  persona: personaSchema.nullable(),
  credential: credentialSchema.nullable(),
  parentLoginVerification: z.enum(["registered_unverified", "verified", "blocked"]),
  publishingIdentities: z.array(publishingIdentitySchema).max(100),
  reservation: assignmentSchema.nullable(),
}).superRefine((value, context) => {
  if ((value.parentLoginVerification === "verified" && value.canonicalAccountRef === null)
    || (value.parentLoginVerification !== "verified" && value.canonicalAccountRef !== null)
    || (value.canonicalAccountRef !== null && value.legacyDeclaredCanonicalAccountRef !== null)) {
    context.addIssue({ code: "custom", path: ["canonicalAccountRef"], message: "Canonical parent identity is present only after verification; legacy declarations are separate" });
  }
});

export const mediaAccountListResponseSchema = z.strictObject({
  contractVersion: contractVersionSchema,
  resourceVersion: version,
  accounts: z.array(mediaAccountSchema).max(1000),
});
export const createMediaAccountRequestSchema = z.strictObject({
  metadata,
  expectedResourceVersion: version,
  platform,
  displayName: label,
  loginIdentifier,
  password: z.string().min(1).max(4096),
  persona: personaSchema.optional(),
});
const createMediaAccountResponse = z.strictObject({
  contractVersion: contractVersionSchema,
  resourceVersion: version,
  account: mediaAccountSchema,
  actionPermissionGranted: z.literal(false),
  publicationAllowed: z.literal(false),
});
export const createMediaAccountResponseSchema = z.union([
  createMediaAccountResponse.extend({ changed: z.literal(true), replayed: z.literal(false) }),
  createMediaAccountResponse.extend({ changed: z.literal(false), replayed: z.literal(false) }),
  createMediaAccountResponse.extend({ changed: z.literal(false), replayed: z.literal(true) }),
]);
export const updateMediaAccountRequestSchema = z.strictObject({
  metadata,
  expectedResourceVersion: version,
  displayName: label,
  persona: personaSchema.nullable(),
});
export const updateMediaAccountResponseSchema = createMediaAccountResponseSchema;

export const mediaAccountCommandLookupResponseSchema = z.union([
  z.strictObject({
    contractVersion: contractVersionSchema,
    state: z.literal("applied"),
    commandKind: z.enum(["account_create", "profile_update", "credential_put", "credential_invalidate"]),
    accountId: id,
    resourceVersion: version,
  }),
  z.strictObject({ contractVersion: contractVersionSchema, state: z.literal("not_found") }),
]);
export const resourceCommandLookupResponseSchema = z.union([
  z.strictObject({
    contractVersion: contractVersionSchema,
    state: z.literal("applied"),
    commandKind: z.enum(["account_assignment", "handover_request"]),
    accountId: id.nullable(),
    resourceVersion: version,
  }),
  z.strictObject({ contractVersion: contractVersionSchema, state: z.literal("not_found") }),
]);

export const accountAssignmentSchema = z.strictObject({
  accountId: id,
  platform,
  projectId: id,
  deviceId: id,
  state: z.literal("pending_initialization"),
  handoverRequested: z.boolean(),
});
export const accountAssignmentListResponseSchema = z.strictObject({
  contractVersion: contractVersionSchema,
  resourceVersion: version,
  projectId: id.nullable(),
  projectVersion: version.nullable(),
  assignments: z.array(accountAssignmentSchema).max(1000),
  eligibleDevices: z.array(z.strictObject({ deviceId: id, deviceVersion: version, state: z.string().min(1).max(80) })).max(1000),
});
export const accountAssignmentRequestSchema = z.strictObject({
  metadata,
  expectedResourceVersion: version,
  expectedProjectVersion: version,
  expectedDeviceVersion: version,
  projectId: id,
  deviceId: id,
  accountIds: z.array(id).min(1).max(2),
}).superRefine((value, context) => {
  if (new Set(value.accountIds.map(accountId => accountId.toLowerCase())).size !== value.accountIds.length) {
    context.addIssue({ code: "custom", path: ["accountIds"], message: "Account IDs must be unique" });
  }
});
export const accountAssignmentResponseSchema = z.strictObject({
  contractVersion: contractVersionSchema,
  resourceVersion: version,
  assignments: z.array(accountAssignmentSchema).max(2),
  changed: z.boolean(),
  replayed: z.boolean(),
  actionPermissionGranted: z.literal(false),
  publicationAllowed: z.literal(false),
});
export const resourceHandoverRequestSchema = z.strictObject({
  metadata,
  expectedResourceVersion: version,
  sourceProjectId: id,
  sourceDeviceId: id,
  targetProjectId: id,
  targetDeviceId: id,
  accountIds: z.array(id).min(1).max(2),
});
export const resourceHandoverResponseSchema = z.strictObject({
  contractVersion: contractVersionSchema,
  resourceVersion: version,
  handoverId: id,
  state: z.literal("blocked"),
  reason: z.enum(["trusted_old_stop_unavailable", "unresolved_task_source_unavailable", "tail_collection_source_unavailable"]),
  currentAssignments: z.array(accountAssignmentSchema).max(2),
  actionPermissionGranted: z.literal(false),
  publicationAllowed: z.literal(false),
});

export type MediaAccount = z.infer<typeof mediaAccountSchema>;
export type MediaAccountListResponse = z.infer<typeof mediaAccountListResponseSchema>;
export type CreateMediaAccountRequest = z.infer<typeof createMediaAccountRequestSchema>;
export type CreateMediaAccountResponse = z.infer<typeof createMediaAccountResponseSchema>;
export type UpdateMediaAccountRequest = z.infer<typeof updateMediaAccountRequestSchema>;
export type AccountAssignment = z.infer<typeof accountAssignmentSchema>;
export type AccountAssignmentRequest = z.infer<typeof accountAssignmentRequestSchema>;
export type AccountAssignmentResponse = z.infer<typeof accountAssignmentResponseSchema>;
export type ResourceHandoverRequest = z.infer<typeof resourceHandoverRequestSchema>;
export type ResourceHandoverResponse = z.infer<typeof resourceHandoverResponseSchema>;
