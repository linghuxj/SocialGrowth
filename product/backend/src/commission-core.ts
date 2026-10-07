import { z } from "zod";
import { compareTimestamps, timestampSchema, uuidSchema } from "@socialgrowth/product-contracts";
const id = uuidSchema.transform(v => v.toLowerCase());
const version = z.int().min(1);
const time = timestampSchema.refine(v => !v.startsWith("0000-"));
const currency = z.string().regex(/^[A-Z]{3}$/); // Shape only; not a currency/precision registry.
const units = z.string().max(78).regex(/^(?:0|[1-9][0-9]*)$/);
const interval = { startsAt: time, endsAt: time.nullable() };
const baseOwnership = { ...interval, periodId: id, version, evidenceId: id };
const owner = z.discriminatedUnion("kind", [
  z.strictObject({ ...baseOwnership, kind: z.literal("provider"), providerId: id, deviceId: id }),
  z.strictObject({ ...baseOwnership, kind: z.literal("company_gap") }),
  z.strictObject({ ...baseOwnership, kind: z.literal("unknown") }),
]);
const rate = z.strictObject({ ...interval, rateId: id, version, evidenceId: id,
  fraction: z.string().regex(/^(?:0|1|0\.[0-9]{1,18})$/) });
const moneyPolicy = z.strictObject({ policyId: id, version, currency, minorUnitScale: z.int().min(0).max(12),
  rounding: z.enum(["down", "half_up", "half_even"]) });
const contextSchema = z.strictObject({ identityId: id, platform: z.enum(["facebook", "youtube"]),
  ownership: z.array(owner).max(1000), rates: z.array(rate).max(1000), moneyPolicy: moneyPolicy.nullable() });
const incomeSchema = z.strictObject({ incomeId: id, sourceId: id, sourceRecordId: id, evidenceId: id, revision: version,
  identityId: id, platform: z.enum(["facebook", "youtube"]), kind: z.literal("advertising"), currency,
  produced: z.strictObject({ startsAt: time, endsAt: time }).nullable(), amountMinorUnits: units.nullable(),
  minorUnitScale: z.int().min(0).max(12), state: z.enum(["estimated", "confirmed_unreceived", "received"]),
  receiptId: id.nullable(), receivedAt: time.nullable(), attribution: z.enum(["confirmed", "unknown"]),
}).superRefine((v, ctx) => {
  if ((v.state === "received") !== (v.receiptId !== null && v.receivedAt !== null)
    || (v.state !== "received" && (v.receiptId !== null || v.receivedAt !== null))
    || (v.produced && compareTimestamps(v.produced.startsAt, v.produced.endsAt)! >= 0)) {
    ctx.addIssue({ code: "custom", message: "Inconsistent income" });
  }
});
export type CommissionIncome = z.infer<typeof incomeSchema>;
export type CommissionContext = z.infer<typeof contextSchema>;
export type CommissionPendingReason = "income_not_received" | "income_details_missing" | "future_income_or_receipt"
  | "attribution_unconfirmed" | "ownership_missing_or_cross_boundary" | "ownership_unknown"
  | "rate_missing_or_cross_boundary" | "money_policy_unavailable";
export class CommissionError extends Error {
  constructor(readonly code: "INPUT_INVALID" | "CONTEXT_INVALID" | "ACCOUNT_MISMATCH") { super(code); }
}
function fail(code: CommissionError["code"]): never { throw new CommissionError(code); }
function chronological(rows: { startsAt: string; endsAt: string | null }[]): boolean {
  return rows.every((v, i) => (v.endsAt === null || compareTimestamps(v.startsAt, v.endsAt)! < 0)
    && (i === 0 || (rows[i - 1]!.endsAt !== null && compareTimestamps(rows[i - 1]!.endsAt!, v.startsAt)! <= 0)));
}
export function parseCommissionContext(input: unknown): CommissionContext {
  const p = contextSchema.safeParse(input); if (!p.success) return fail("CONTEXT_INVALID"); const c = p.data;
  if (!chronological(c.ownership) || !chronological(c.rates)
    || new Set(c.ownership.map(v => v.periodId)).size !== c.ownership.length
    || new Set(c.rates.map(v => v.rateId)).size !== c.rates.length
    || new Set(c.rates.map(v => v.version)).size !== c.rates.length) return fail("CONTEXT_INVALID");
  return c;
}
export function parseCommissionIncome(input: unknown): CommissionIncome {
  const p = incomeSchema.safeParse(input); return p.success ? p.data : fail("INPUT_INVALID");
}
function contains(row: { startsAt: string; endsAt: string | null }, produced: { startsAt: string; endsAt: string }): boolean {
  return compareTimestamps(row.startsAt, produced.startsAt)! <= 0
    && (row.endsAt === null || compareTimestamps(produced.endsAt, row.endsAt)! <= 0);
}
function multiply(amount: string, fraction: string, rounding: NonNullable<CommissionContext["moneyPolicy"]>["rounding"]): string {
  const parts = fraction.split("."), decimals = parts[1] ?? "", denominator = 10n ** BigInt(decimals.length);
  const numerator = BigInt(`${parts[0]}${decimals}`), product = BigInt(amount) * numerator;
  const q = product / denominator, r = product % denominator;
  const roundUp = rounding !== "down" && (r * 2n > denominator
    || (r * 2n === denominator && (rounding === "half_up" || q % 2n === 1n)));
  return (q + (roundUp ? 1n : 0n)).toString();
}
// INTERNAL arithmetic/reconciliation only. Evidence IDs and ownership/rate
// fields do not independently prove receipt, readiness, exit or approved policy.
// A future trusted producer and atomic ledger must verify them before use.
// No actual payment, per-device/online-time allocation, FX or cost deduction.
export function calculateCommission(incomeInput: unknown, contextInput: unknown, evaluatedAt: string) {
  const income = parseCommissionIncome(incomeInput), c = parseCommissionContext(contextInput), clock = time.safeParse(evaluatedAt);
  if (!clock.success) return fail("INPUT_INVALID");
  if (income.identityId !== c.identityId || income.platform !== c.platform) return fail("ACCOUNT_MISMATCH");
  const base = { stage: "internal_calculation_only" as const, incomeId: income.incomeId, incomeRevision: income.revision,
    identityId: income.identityId, platform: income.platform, currency: income.currency, minorUnitScale: income.minorUnitScale,
    evaluatedAt: clock.data, paymentAllowed: false as const, paidAmountMinorUnits: null,
    pendingChecks: ["trusted_income_receipt_and_account_producer", "trusted_ownership_and_uniform_historical_rate", "atomic_income_deduplication_and_revision", "current_authenticated_projection"] };
  const pending = (reason: CommissionPendingReason) => ({ ...base, status: "pending_reconciliation" as const, reason,
    providerId: null, commissionMinorUnits: null, ownershipRef: null, rateRef: null, moneyPolicyRef: null });
  if (income.state !== "received") return pending("income_not_received");
  if (!income.produced || income.amountMinorUnits === null) return pending("income_details_missing");
  if (compareTimestamps(income.produced.endsAt, clock.data)! > 0 || compareTimestamps(income.receivedAt!, clock.data)! > 0) return pending("future_income_or_receipt");
  if (income.attribution !== "confirmed") return pending("attribution_unconfirmed");
  const ownership = c.ownership.find(v => contains(v, income.produced!));
  if (!ownership) return pending("ownership_missing_or_cross_boundary");
  if (ownership.kind === "unknown") return pending("ownership_unknown");
  const ownershipRef = { periodId: ownership.periodId, version: ownership.version, evidenceId: ownership.evidenceId };
  if (ownership.kind === "company_gap") return { ...base, status: "company_income_only" as const, reason: null,
    providerId: null, commissionMinorUnits: null, ownershipRef, rateRef: null, moneyPolicyRef: null };
  const applicable = c.rates.find(v => contains(v, income.produced!));
  if (!applicable) return pending("rate_missing_or_cross_boundary");
  const policy = c.moneyPolicy;
  if (!policy || policy.currency !== income.currency || policy.minorUnitScale !== income.minorUnitScale) return pending("money_policy_unavailable");
  return { ...base, status: "provider_calculation" as const, reason: null, providerId: ownership.providerId,
    deviceId: ownership.deviceId, commissionMinorUnits: multiply(income.amountMinorUnits, applicable.fraction, policy.rounding), ownershipRef,
    rateRef: { rateId: applicable.rateId, version: applicable.version, evidenceId: applicable.evidenceId, fraction: applicable.fraction },
    moneyPolicyRef: { policyId: policy.policyId, version: policy.version, rounding: policy.rounding } };
}
