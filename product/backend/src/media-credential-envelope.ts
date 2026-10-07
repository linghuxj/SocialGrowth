import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { uuidSchema } from "@socialgrowth/product-contracts";

const format = "2026-10-01.media-credential-v1";
export const maxMediaCredentialPayloadBytes = 8192; // Technical in-memory bound, not a platform password policy.
const id = uuidSchema.length(36).refine(v => v === v.toLowerCase());
const contextSchema = z.strictObject({ credentialId: id, accountId: id,
  platform: z.enum(["facebook", "youtube"]), revision: z.int().min(1).max(Number.MAX_SAFE_INTEGER) });
const keyIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$(?![\s\S])/);
const secretSchema = z.strictObject({ login: z.string().min(1).max(320), password: z.string().min(1).max(4096) });
const envelopeSchema = z.strictObject({ format: z.literal(format), context: contextSchema, keyId: keyIdSchema,
  payloadBytes: z.int().min(1).max(maxMediaCredentialPayloadBytes), nonce: z.string().length(16),
  tag: z.string().length(24), ciphertext: z.string().min(4).max(Math.ceil(maxMediaCredentialPayloadBytes / 3) * 4) });
export type MediaCredentialContext = z.infer<typeof contextSchema>;
export type MediaCredentialEnvelope = z.infer<typeof envelopeSchema>;
export interface MediaCredentialKey { keyId: string; key: Buffer }
export class MediaCredentialError extends Error { constructor() { super("MEDIA_CREDENTIAL_UNAVAILABLE"); } }
function copyKey(input: MediaCredentialKey | null) {
  if (!input || !keyIdSchema.safeParse(input.keyId).success || !Buffer.isBuffer(input.key) || input.key.length !== 32) throw new MediaCredentialError();
  return { keyId: input.keyId, key: Buffer.from(input.key) };
}
function validPayload(input: unknown): asserts input is Buffer {
  if (!Buffer.isBuffer(input) || input.length < 1 || input.length > maxMediaCredentialPayloadBytes) throw new MediaCredentialError();
  const text = input.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(input)) throw new MediaCredentialError();
  secretSchema.parse(JSON.parse(text)); // Only validate; preserve exact original bytes/spacing/unicode, no normalized secret.
}
function base64(input: string, bytes: number): Buffer {
  const value = Buffer.from(input, "base64");
  if (value.length !== bytes || value.toString("base64") !== input) throw new MediaCredentialError();
  return value;
}
function aad(context: MediaCredentialContext, keyId: string, payloadBytes: number): Buffer {
  return Buffer.from(JSON.stringify({ format, credentialId: context.credentialId, accountId: context.accountId,
    platform: context.platform, revision: context.revision, keyId, payloadBytes }), "utf8");
}
// SERVER-ONLY encryption component. No HTTP/config reader/store/model/phone
// consumer. Context binds bytes, not truth/current permission. A trusted caller
// must load current account/revision and authorization BEFORE using a sink.
// This does not protect screenshots or make an arbitrary sink trustworthy.
export function sealMediaCredentialPayload(input: unknown, contextInput: unknown, keyInput: MediaCredentialKey | null = null): MediaCredentialEnvelope {
  let key: ReturnType<typeof copyKey> | undefined, payload: Buffer | undefined;
  try {
    key = copyKey(keyInput);
    if (!Buffer.isBuffer(input) || input.length < 1 || input.length > maxMediaCredentialPayloadBytes) throw new MediaCredentialError();
    payload = Buffer.from(input); validPayload(payload);
    const context = contextSchema.parse(contextInput), nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key.key, nonce, { authTagLength: 16 });
    cipher.setAAD(aad(context, key.keyId, payload.length));
    const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
    return envelopeSchema.parse({ format, context, keyId: key.keyId, payloadBytes: payload.length,
      nonce: nonce.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") });
  } catch { throw new MediaCredentialError(); } finally { key?.key.fill(0); payload?.fill(0); }
}
// A plaintext buffer is lent ONLY to the explicit trusted sensitive sink, then
// zeroed, including failure. Never return the sink result or exception/cause.
// Caller/sink copies and JS strings/OS memory are not an erasure guarantee.
export async function withDecryptedMediaCredential(input: unknown, expectedContextInput: unknown,
  trustedSensitiveSink: (payload: Buffer) => Promise<void>, keyInput: MediaCredentialKey | null = null): Promise<void> {
  let key: ReturnType<typeof copyKey> | undefined, payload: Buffer | undefined;
  try {
    key = copyKey(keyInput); const envelope = envelopeSchema.parse(input), expected = contextSchema.parse(expectedContextInput);
    const context = envelope.context;
    if (key.keyId !== envelope.keyId || context.credentialId !== expected.credentialId || context.accountId !== expected.accountId
      || context.platform !== expected.platform || context.revision !== expected.revision || typeof trustedSensitiveSink !== "function") throw new MediaCredentialError();
    const decipher = createDecipheriv("aes-256-gcm", key.key, base64(envelope.nonce, 12), { authTagLength: 16 });
    decipher.setAAD(aad(context, envelope.keyId, envelope.payloadBytes)); decipher.setAuthTag(base64(envelope.tag, 16));
    const partial = decipher.update(base64(envelope.ciphertext, envelope.payloadBytes));
    try { payload = Buffer.concat([partial, decipher.final()]); } finally { partial.fill(0); }
    validPayload(payload);
    await trustedSensitiveSink(payload);
  } catch { throw new MediaCredentialError(); } finally { key?.key.fill(0); payload?.fill(0); }
}
