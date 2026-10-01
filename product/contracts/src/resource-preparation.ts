import { z } from "zod";
import { contractVersionSchema, requestMetadataSchema, uuidSchema } from "./common.js";

// A single pattern keeps the same installed UUID grammar (including nil/max)
// while restricting hex to lowercase; composing regex checks emitted allOf,
// which the existing fail-closed Python consumer intentionally rejects.
const uuidPattern = z.toJSONSchema(uuidSchema).pattern;
if (typeof uuidPattern !== "string" || !uuidPattern.startsWith("^") || !uuidPattern.endsWith("$")
  || !uuidPattern.includes("[0-9a-fA-F]") || !uuidPattern.includes("[89abAB]")) throw new Error("Unsupported UUID grammar");
const id = z.string().regex(new RegExp(uuidPattern.slice(0, -1).replaceAll("[0-9a-fA-F]", "[0-9a-f]").replaceAll("[89abAB]", "[89ab]") + "$(?![\\s\\S])"));
const platform = z.enum(["facebook", "youtube"]);
const sourceRef = z.string().regex(/^[A-Za-z0-9_-]{1,150}$(?![\s\S])/);
const version = z.int().min(0).max(Number.MAX_SAFE_INTEGER);
const metadata = requestMetadataSchema.extend({ idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,128}$(?![\s\S])/) });
const closed = { actionPermissionGranted: z.literal(false), acceptanceStarted: z.literal(false) };
const account = z.strictObject({ accountId: id, platform });
const identity = z.strictObject({ identityId: id, accountId: id, platform });
const registration = z.strictObject({ accountId: id, identityId: id, platform,
  canonicalAccountRef: sourceRef, canonicalIdentityRef: sourceRef });

// Format/central uniqueness only. An operator declaration is not platform or
// ownership verification. No credential/evidence URL/execution flag accepted.
export const registerMediaIdentityRequestSchema = z.strictObject({ metadata,
  expectedResourceVersion: version, registration });
const registrationResponse = z.strictObject({ contractVersion: contractVersionSchema,
  version, registration,
  state: z.literal("registered_unverified"), ...closed,
});
export const registerMediaIdentityResponseSchema = z.union([
  registrationResponse.extend({ changed: z.literal(true), replayed: z.literal(false) }),
  registrationResponse.extend({ changed: z.literal(false), replayed: z.literal(false) }),
  registrationResponse.extend({ changed: z.literal(false), replayed: z.literal(true) }),
]);

export const reserveResourcePreparationRequestSchema = z.strictObject({ metadata,
  expectedResourceVersion: version, expectedProjectVersion: version, expectedDeviceVersion: version,
  reservation: z.strictObject({ projectId: id, deviceId: id, identityIds: z.array(id).min(1).max(2) }),
});
export const resourcePreparationResponseSchema = z.strictObject({ contractVersion: contractVersionSchema,
  version, replayed: z.boolean(), ...closed,
  snapshot: z.strictObject({ accounts: z.array(account), identities: z.array(identity),
    phones: z.array(z.strictObject({ deviceId: id, projectId: id })),
    accountUses: z.array(z.strictObject({ accountId: id, projectId: id })),
    bindings: z.array(identity.extend({ deviceId: id, projectId: id, state: z.literal("pending_initialization") })),
  }),
});
