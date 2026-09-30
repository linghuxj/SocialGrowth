import { z } from "zod";
import { compareTimestamps, timestampSchema, uuidSchema } from "./common.js";
const iso = z.toJSONSchema(timestampSchema).pattern;
if (typeof iso !== "string" || !iso.startsWith("^")) throw new Error("Expected anchored ISO timestamp grammar");
const time = z.string().regex(new RegExp(iso.replace(/^\^/, "^(?!0000-)")));
const units = z.string().max(78).regex(/^(?:0|[1-9][0-9]*)$/);
export const commissionCursorSchema = z.strictObject({ incomeId: uuidSchema, revision: z.int().min(1) });
// Read-only historical internal calculation, NOT an actual payable/paid claim.
export const providerCommissionRecordSchema = z.strictObject({ incomeId: uuidSchema, revision: z.int().min(1), currentForIncome: z.boolean(),
  identityId: uuidSchema, accountIdentityRef: z.string().regex(/^[A-Za-z0-9_-]{1,150}$/), platform: z.enum(["facebook", "youtube"]),
  currency: z.string().regex(/^[A-Z]{3}$/), minorUnitScale: z.int().min(0).max(12),
  produced: z.strictObject({ startsAt: time, endsAt: time }), receivedAt: time, evaluatedAt: time,
  receivedRevenueMinorUnits: units, commissionMinorUnits: units,
  appliedFraction: z.string().regex(/^(?:0|1|0\.[0-9]{1,18})$/), rateVersion: z.int().min(1),
  rounding: z.enum(["down", "half_up", "half_even"]), moneyPolicyVersion: z.int().min(1),
  calculationStage: z.literal("internal_calculation_only"), paymentStatus: z.literal("not_recorded"), paymentAllowed: z.literal(false),
}).superRefine((v, ctx) => {
  if (time.safeParse(v.produced.startsAt).success && time.safeParse(v.produced.endsAt).success
    && compareTimestamps(v.produced.startsAt, v.produced.endsAt)! >= 0) ctx.addIssue({ code: "custom", message: "Invalid production window" });
  if (time.safeParse(v.evaluatedAt).success && ((time.safeParse(v.receivedAt).success && compareTimestamps(v.receivedAt, v.evaluatedAt)! > 0)
    || (time.safeParse(v.produced.endsAt).success && compareTimestamps(v.produced.endsAt, v.evaluatedAt)! > 0))) ctx.addIssue({ code: "custom", message: "Future income" });
  if (units.safeParse(v.commissionMinorUnits).success && units.safeParse(v.receivedRevenueMinorUnits).success
    && BigInt(v.commissionMinorUnits) > BigInt(v.receivedRevenueMinorUnits)) ctx.addIssue({ code: "custom", message: "Commission exceeds income" });
});
export const listProviderCommissionsResponseSchema = z.strictObject({ records: z.array(providerCommissionRecordSchema).max(50), nextAfter: commissionCursorSchema.nullable() })
  .superRefine((v, ctx) => {
    const keys = v.records.map(r => `${r.incomeId.toLowerCase()}/${r.revision}`), last = v.records.at(-1);
    if (new Set(keys).size !== keys.length || (v.nextAfter && (!last || v.nextAfter.incomeId.toLowerCase() !== last.incomeId.toLowerCase() || v.nextAfter.revision !== last.revision))) {
      ctx.addIssue({ code: "custom", message: "Invalid commission cursor or repeated revision" });
    }
  });
export type ProviderCommissionRecord = z.infer<typeof providerCommissionRecordSchema>;
