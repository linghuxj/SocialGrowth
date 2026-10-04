import { createHash } from "node:crypto";
import { z } from "zod";
import { accountPreparationInputSchema, artemisPreparationAssignmentSchema, preparationOperationIdSchema, planAccountPreparation, uuidSchema,
  type ArtemisPreparationAssignment } from "@socialgrowth/product-contracts";

// Read-only compatibility for immutable v1 assignment records created before
// parentLoginRef was removed. Keep the exact v1 field order used by the old
// strict schema so JSON.stringify reproduces its stored fingerprint; never
// strip/normalize the persisted object or pass this projection to a broker.
const current = accountPreparationInputSchema.shape;
const legacyInput = z.strictObject({
  protocolVersion: current.protocolVersion,
  projectId: current.projectId,
  deviceId: current.deviceId,
  accountId: current.accountId,
  parentLoginRef: z.string().regex(/^[A-Za-z0-9_-]{1,150}$(?![\s\S])/),
  mode: current.mode,
  target: current.target,
  requestedScope: current.requestedScope,
  facts: current.facts,
});
export const legacyArtemisPreparationAssignmentSchema = z.strictObject({ taskId: uuidSchema,
  taskVersion: z.int().min(0).max(Number.MAX_SAFE_INTEGER), taskAttemptId: uuidSchema,
  serial: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$(?![\s\S])/).refine(v => !v.startsWith("emulator-")),
  input: legacyInput, operationId: preparationOperationIdSchema,
}).refine(v => {
  const { parentLoginRef: _legacyRef, ...currentInput } = v.input;
  return planAccountPreparation(currentInput).operationId === v.operationId;
}, "Operation must match the current next step");
const fingerprintPattern = /^[a-f0-9]{64}$(?![\s\S])/;

export function readArtemisPreparationHistory(raw: unknown, expectedFingerprint: string): {
  assignment: ArtemisPreparationAssignment;
  legacyParentRef: boolean;
} {
  if (!fingerprintPattern.test(expectedFingerprint)) throw new Error("invalid history");
  const currentResult = artemisPreparationAssignmentSchema.safeParse(raw);
  if (currentResult.success && createHash("sha256").update(JSON.stringify(currentResult.data)).digest("hex") === expectedFingerprint) {
    return { assignment: currentResult.data, legacyParentRef: false };
  }
  const legacyResult = legacyArtemisPreparationAssignmentSchema.safeParse(raw);
  if (!legacyResult.success || createHash("sha256").update(JSON.stringify(legacyResult.data)).digest("hex") !== expectedFingerprint) throw new Error("invalid history");
  // The extra historical field remains only in this local, read-only value;
  // callers must project a limited summary and never feed it to execution.
  return { assignment: legacyResult.data, legacyParentRef: true };
}
