import { z } from "zod";

import {
  compareTimestamps,
  requestMetadataSchema,
  timestampSchema,
  uuidSchema,
} from "./common.js";
import { sessionSummarySchema } from "./identity.js";
import { invitationCodeSchema } from "./invitation.js";
import { registerProviderResponseSchema } from "./invitation.js";

export const phoneE164Schema = z.string().regex(/^\+[1-9][0-9]{7,14}$/);
export const phoneVerificationCodeSchema = z.string().regex(/^[0-9]{4,8}$/);
export const maskedPhoneSchema = z
  .string()
  .regex(/^\+(?=[0-9*]{7,18}$)(?=[0-9]*\*)[0-9*]+$/);
export const phoneVerificationPurposeSchema = z.enum([
  "provider_registration",
  "provider_login",
]);

export const requestPhoneVerificationSchema = z.discriminatedUnion("purpose", [
  z.strictObject({
    metadata: requestMetadataSchema,
    purpose: z.literal("provider_registration"),
    phoneE164: phoneE164Schema,
    invitationCode: invitationCodeSchema,
  }),
  z.strictObject({
    metadata: requestMetadataSchema,
    purpose: z.literal("provider_login"),
    phoneE164: phoneE164Schema,
  }),
]);

export const phoneVerificationChallengeResponseSchema = z.strictObject({
  challengeId: uuidSchema,
  purpose: phoneVerificationPurposeSchema,
  phoneHint: maskedPhoneSchema,
  deliveryState: z.literal("accepted"),
  expiresAt: timestampSchema,
  resendAvailableAt: timestampSchema,
  temporaryCode: phoneVerificationCodeSchema.optional(),
}).superRefine((value, context) => {
  const order = compareTimestamps(value.resendAvailableAt, value.expiresAt);
  if (order !== null && order > 0) {
    context.addIssue({ code: "custom", path: ["resendAvailableAt"], message: "Resend cannot become available after challenge expiry" });
  }
});

export const verifyPhoneCodeRequestSchema = z.strictObject({
  metadata: requestMetadataSchema,
  challengeId: uuidSchema,
  code: phoneVerificationCodeSchema,
});

export const phoneVerificationResponseSchema = z.strictObject({
  phoneVerificationId: uuidSchema,
  purpose: phoneVerificationPurposeSchema,
  phoneHint: maskedPhoneSchema,
  verifiedAt: timestampSchema,
  expiresAt: timestampSchema,
}).superRefine((value, context) => {
  const order = compareTimestamps(value.verifiedAt, value.expiresAt);
  if (order !== null && order >= 0) {
    context.addIssue({ code: "custom", path: ["expiresAt"], message: "Verified proof must expire after verification" });
  }
});

export const providerStatusSchema = z.enum(["active", "disabled"]);
export const providerSelfViewSchema = z.strictObject({
  providerId: uuidSchema,
  displayName: z.string().min(1).max(100),
  phoneHint: maskedPhoneSchema,
  status: providerStatusSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).superRefine((value, context) => {
  const order = compareTimestamps(value.updatedAt, value.createdAt);
  if (order !== null && order < 0) {
    context.addIssue({ code: "custom", path: ["updatedAt"], message: "Provider update cannot predate creation" });
  }
});

export const providerLoginRequestSchema = z.strictObject({
  metadata: requestMetadataSchema,
  phoneVerificationId: uuidSchema,
});

export const providerAuthResponseSchema = z.strictObject({
  provider: providerSelfViewSchema,
  session: sessionSummarySchema,
  sessionToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).superRefine((value, context) => {
  const order = compareTimestamps(value.session.createdAt, value.session.expiresAt);
  if (order !== null && order >= 0) {
    context.addIssue({ code: "custom", path: ["session", "expiresAt"], message: "Session must expire after creation" });
  }
});

export const providerRegistrationAuthResponseSchema = z.strictObject({
  registration: registerProviderResponseSchema,
  provider: providerSelfViewSchema,
  session: sessionSummarySchema,
  sessionToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).superRefine((value, context) => {
  if (value.registration.providerId !== value.provider.providerId) {
    context.addIssue({
      code: "custom",
      path: ["provider", "providerId"],
      message: "Registration and session must belong to the same provider",
    });
  }
  const order = compareTimestamps(value.session.createdAt, value.session.expiresAt);
  if (order !== null && order >= 0) {
    context.addIssue({ code: "custom", path: ["session", "expiresAt"], message: "Session must expire after creation" });
  }
});

export const providerLogoutRequestSchema = z.strictObject({
  metadata: requestMetadataSchema,
});

export const providerLogoutResponseSchema = z.strictObject({
  loggedOutAt: timestampSchema,
});

export type RequestPhoneVerification = z.infer<typeof requestPhoneVerificationSchema>;
export type PhoneVerificationChallengeResponse = z.infer<
  typeof phoneVerificationChallengeResponseSchema
>;
export type VerifyPhoneCodeRequest = z.infer<typeof verifyPhoneCodeRequestSchema>;
export type PhoneVerificationResponse = z.infer<typeof phoneVerificationResponseSchema>;
export type ProviderSelfView = z.infer<typeof providerSelfViewSchema>;
export type ProviderLoginRequest = z.infer<typeof providerLoginRequestSchema>;
export type ProviderAuthResponse = z.infer<typeof providerAuthResponseSchema>;
export type ProviderRegistrationAuthResponse = z.infer<typeof providerRegistrationAuthResponseSchema>;
export type ProviderLogoutRequest = z.infer<typeof providerLogoutRequestSchema>;
export type ProviderLogoutResponse = z.infer<typeof providerLogoutResponseSchema>;
