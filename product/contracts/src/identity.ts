import { z } from "zod";

import { timestampSchema, uuidSchema } from "./common.js";

export const principalTypeSchema = z.enum([
  "operator",
  "provider",
  "installation",
]);

export const authenticatedPrincipalSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("operator"), operatorId: uuidSchema }),
  z.strictObject({ type: z.literal("provider"), providerId: uuidSchema }),
  z.strictObject({
    type: z.literal("installation"),
    installationId: uuidSchema,
  }),
]);

export const sessionSummarySchema = z.strictObject({
  sessionId: uuidSchema,
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
});

export type PrincipalType = z.infer<typeof principalTypeSchema>;
export type AuthenticatedPrincipal = z.infer<
  typeof authenticatedPrincipalSchema
>;
