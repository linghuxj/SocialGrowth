import { z } from "zod";
import { uuidSchema } from "./common.js";
import { accountPreparationInputSchema, preparationOperationIdSchema } from "./execution-library.js";
import { planAccountPreparation } from "./account-preparation-plan.js";
export const artemisPreparationAssignmentSchema = z.strictObject({ taskId: uuidSchema,
  taskVersion: z.int().min(0).max(Number.MAX_SAFE_INTEGER), taskAttemptId: uuidSchema,
  serial: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$(?![\s\S])/).refine(v => !v.startsWith("emulator-")),
  input: accountPreparationInputSchema, operationId: preparationOperationIdSchema,
}).refine(v => planAccountPreparation(v.input).operationId === v.operationId, "Operation must match the current next step");
export const artemisPreparationObservationSchema = z.strictObject({ traceId: uuidSchema.nullable(),
  state: z.enum(["running", "launch_unknown", "reported", "needs_human", "result_unknown", "stop_unconfirmed"]),
  evidenceIds: z.array(uuidSchema).max(20), identityVerified: z.literal(false), publicationAllowed: z.literal(false),
}).refine(v => new Set(v.evidenceIds.map(id => id.toLowerCase())).size === v.evidenceIds.length
  && (v.traceId !== null || v.state === "launch_unknown") && (!["reported", "needs_human"].includes(v.state) || v.evidenceIds.length > 0));
export type ArtemisPreparationAssignment = z.infer<typeof artemisPreparationAssignmentSchema>;
export type ArtemisPreparationObservation = z.infer<typeof artemisPreparationObservationSchema>;
export interface ArtemisPreparationJournal {
  claim(a: ArtemisPreparationAssignment, fingerprint: string): Promise<{ state: "new" } | { state: "existing"; traceId: string | null }>;
  read(a: ArtemisPreparationAssignment, fingerprint: string): Promise<{ traceId: string | null } | null>;
  bindTrace(attempt: string, fingerprint: string, traceId: string): Promise<void>;
  record(attempt: string, fingerprint: string, observation: ArtemisPreparationObservation): Promise<void>;
}
