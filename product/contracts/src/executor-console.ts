import { z } from "zod";

const key = z.string().min(1).max(256);
export const phoneInitializationProgressSchema = z.strictObject({
  phase: z.enum(["checking_device", "inspecting_apps", "preparing_apps", "delivering_configuration", "configuring_network", "checking_proxy", "checking_vpn", "recovering_connection", "observing_stability", "completed", "needs_attention"]),
  updatedAt: z.string().datetime(),
  packageName: z.enum(["io.nekohasekai.sfa", "com.follow.clash", "com.facebook.katana", "com.google.android.youtube"]).optional(),
});
export type PhoneInitializationProgress = z.infer<typeof phoneInitializationProgressSchema>;
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
  stability: z.object({ observedSeconds: z.int().min(0), samples: z.int().min(1), transport: z.literal("tailnet_and_bootstrap") }).optional(),
  errorCode: z.string().optional(), startedAt: z.string(), finishedAt: z.string().optional(),
  initializationProgress: phoneInitializationProgressSchema.optional(),
  previousInitializationId: key.optional(),
  initializationPrepared: z.boolean().optional(),
  initializationConfigurationRecoveryCount: z.int().min(0).max(2).optional(),
  initializationPreparationRequestId: z.uuid().optional(),
  initializationStartupRecoveryCount: z.int().min(0).max(2).optional(),
  initializationRecovery: z.object({ at: z.string().datetime(), successorId: key }).optional(),
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
  automaticPhoneInitialization: z.boolean().default(false),
  phoneInitializationDispatches: z.array(z.strictObject({ deviceId: z.uuid(),
    state: z.enum(["dispatching", "handing_off", "blocked", "completed"]),
    updatedAt: z.string().datetime(),
    reason: z.enum(["connection_unconfirmed", "executor_unconfirmed", "original_requires_attention", "handoff_unconfirmed"]).optional(),
  })).default([]),
  configured: z.boolean(), available: z.boolean(), deviceId: key.optional(),
  tasks: z.array(z.object({ id: key, status: key, deviceId: key.optional() })),
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
