import { z } from "zod";
import { contractVersionSchema, requestMetadataSchema, uuidSchema } from "./common.js";

const uuidPattern = z.toJSONSchema(uuidSchema).pattern;
if (typeof uuidPattern !== "string" || !uuidPattern.startsWith("^") || !uuidPattern.endsWith("$")
  || !uuidPattern.includes("[0-9a-fA-F]") || !uuidPattern.includes("[89abAB]")) throw new Error("Unsupported UUID grammar");
const id = z.string().regex(new RegExp(uuidPattern.slice(0, -1).replaceAll("[0-9a-fA-F]", "[0-9a-f]").replaceAll("[89abAB]", "[89ab]") + "$(?![\\s\\S])"));
export const mediaCredentialAccountIdSchema = id;
const platform = z.enum(["facebook", "youtube"]), revision = z.int().min(1).max(Number.MAX_SAFE_INTEGER);
const metadata = requestMetadataSchema.extend({ idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,128}$(?![\s\S])/) });
export const mediaCredentialMetadataSchema = z.strictObject({ credentialId: id, accountId: id, platform, revision,
  state: z.enum(["stored_unverified", "invalidated"]), actionPermissionGranted: z.literal(false), acceptanceStarted: z.literal(false) });
export const readMediaCredentialResponseSchema = z.strictObject({ contractVersion: contractVersionSchema, credential: mediaCredentialMetadataSchema.nullable() });
const command = z.strictObject({ metadata, credentialId: id, accountId: id, platform, expectedRevision: z.int().min(0).max(Number.MAX_SAFE_INTEGER) });
const loginIdentifier = z.string().min(1).max(320).refine(value => value.trim() === value && !value.includes("\u0000"));
// Sensitive transport bytes, NOT encryption or a logging/screenshot safeguard.
// Canonical base64 represents at most 8192 original UTF8 JSON bytes. Padding
// bits are fixed, so TS/Python can validate identical ASCII without decoding a
// password or changing its whitespace/Unicode. The server validates payload
// login/password after decode inside the controlled write path. Never a model
// field, URL, queue or ordinary response; actual deployment requires TLS and
// protected request handling before enabling the controlled key provider.
const sensitiveBytes = z.string().min(4).regex(/^(?:[A-Za-z0-9+/]{4}){0,2730}(?:[A-Za-z0-9+/][AQgw]==|[A-Za-z0-9+/]{2}[AEIMQUYcgkosw048]=)?$(?![\s\S])/);
export const writeMediaCredentialRequestSchema = z.union([
  command.extend({ credentialId: id.nullable(), operation: z.literal("put"), loginIdentifier, payloadBase64: sensitiveBytes }),
  command.extend({ operation: z.literal("invalidate") }),
]);
const response = z.strictObject({ contractVersion: contractVersionSchema, credential: mediaCredentialMetadataSchema });
export const writeMediaCredentialResponseSchema = z.union([
  response.extend({ changed: z.literal(true), replayed: z.literal(false) }),
  response.extend({ changed: z.literal(false), replayed: z.literal(false) }),
  response.extend({ changed: z.literal(false), replayed: z.literal(true) }),
]);
