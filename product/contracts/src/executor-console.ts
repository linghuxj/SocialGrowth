import { z } from "zod";

const key = z.string().min(1).max(256);
export const executorVerificationSchema = z.strictObject({
  requestId: z.uuid(), expectedName: z.string().trim().min(1).max(100),
  expectedProfileId: z.string().regex(/^(?:\d{5,30}|UC[A-Za-z0-9_-]{22}|com\.socialgrowth\.product)$/),
  platform: z.enum(["facebook", "youtube", "socialgrowth"]),
  mode: z.enum(["observe", "preflight", "client_test", "connectivity_test"]),
  goal: z.string().trim().max(2000), caption: z.string().trim().min(1).max(1000),
  acknowledgeNoPublication: z.literal(true),
  allowLocalParticipationStart: z.boolean(), allowEndpointReportingStart: z.boolean(), allowParticipationWithdrawal: z.boolean(),
});
export const executorJobSchema = z.object({
  id: key, requestId: z.uuid(), deviceId: key, status: key, mode: key.default("unknown"),
  expectedName: z.string(), expectedProfileId: z.string(), resultCode: z.string().optional(),
  errorCode: z.string().optional(), startedAt: z.string(), finishedAt: z.string().optional(),
});
export const executorRequestSchema = z.object({
  id: key, taskId: key, deviceId: key, expectedIdentity: z.string(), kind: key,
  message: z.string(), status: key, expiresAt: z.string(),
});
export const executorChallengeSchema = z.object({
  id: key, taskId: key, deviceId: key, expectedIdentity: z.string(),
  kind: z.enum(["password", "otp"]).default("password"), status: key, expiresAt: z.string(),
  resultCode: z.string().optional(), workflowResult: z.string().optional(),
});
export const executorConsoleSchema = z.strictObject({
  bootstrapDevices: z.array(z.strictObject({ deviceId: z.uuid(), connected: z.boolean(), mode: z.enum(["bootstrap", "managed_verified"]) })).default([]),
  configured: z.boolean(), available: z.boolean(), deviceId: key.optional(),
  tasks: z.array(z.object({ id: key, status: key })),
  holds: z.array(z.object({ device: key, actor: key, since: z.string() })),
  jobs: z.array(executorJobSchema), requests: z.array(executorRequestSchema), challenges: z.array(executorChallengeSchema),
});
export const executorMutationResponseSchema = z.strictObject({ accepted: z.literal(true) });
export const executorResponseSchema = z.strictObject({
  id: key, expectedIdentity: z.string().min(1).max(512), confirmed: z.literal(true),
  decision: z.enum(["provided", "approved", "completed", "cancel"]), text: z.string().trim().max(4000),
});
export const executorCredentialSchema = z.strictObject({
  id: key, expectedIdentity: z.string().min(1).max(512), confirmed: z.literal(true),
  password: z.string().min(1).max(128).regex(/^[\x20-\x7e]+$/),
});
export const executorStopSchema = z.strictObject({ id: key });
export const executorHoldSchema = z.strictObject({ deviceId: key, held: z.boolean() });
export type ExecutorConsole = z.infer<typeof executorConsoleSchema>;
