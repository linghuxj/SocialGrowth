import assert from "node:assert/strict";
import test from "node:test";
import { calculateCommission, CommissionError, parseCommissionContext, type CommissionContext, type CommissionIncome } from "./commission-core.js";
const uid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const t = (day: string) => `2026-09-${day}T00:00:00Z`;
const now = "2026-10-01T00:00:00Z";
function context(): CommissionContext {
  return { identityId: uid(1), platform: "facebook", ownership: [
    { periodId: uid(10), version: 1, evidenceId: uid(110), kind: "provider", providerId: uid(2), deviceId: uid(3), startsAt: t("02"), endsAt: t("10") },
    { periodId: uid(11), version: 1, evidenceId: uid(111), kind: "company_gap", startsAt: t("10"), endsAt: t("15") },
    { periodId: uid(12), version: 1, evidenceId: uid(112), kind: "provider", providerId: uid(4), deviceId: uid(5), startsAt: t("15"), endsAt: null },
  ], rates: [
    { rateId: uid(20), version: 1, evidenceId: uid(120), fraction: "0.1", startsAt: t("01"), endsAt: t("20") },
    { rateId: uid(21), version: 2, evidenceId: uid(121), fraction: "0.2", startsAt: t("20"), endsAt: null },
  ], moneyPolicy: { policyId: uid(30), version: 1, currency: "USD", minorUnitScale: 2, rounding: "half_even" } };
}
function income(): CommissionIncome {
  return { incomeId: uid(40), sourceId: uid(41), sourceRecordId: uid(42), evidenceId: uid(43), revision: 1, identityId: uid(1),
    platform: "facebook", kind: "advertising", currency: "USD", produced: { startsAt: t("03"), endsAt: t("08") },
    amountMinorUnits: "105", minorUnitScale: 2, state: "received", receiptId: uid(44), receivedAt: t("30"), attribution: "confirmed" };
}
function result(i = income(), c = context()) { return calculateCommission(i, c, now); }
function pending(reason: string, i = income(), c = context()) {
  const r = result(i, c); assert.equal(r.status, "pending_reconciliation"); assert.equal(r.reason, reason);
  assert.equal(r.commissionMinorUnits, null); assert.equal(r.providerId, null); assert.equal(r.paymentAllowed, false); return r;
}
function rejects(i: unknown, c: unknown, code: CommissionError["code"]) {
  assert.throws(() => calculateCommission(i, c, now), (e: unknown) => e instanceof CommissionError && e.code === code);
}
test("late receipt retains original provider and historical rate, not current binding", () => {
  const r = result(); assert.equal(r.status, "provider_calculation"); assert.equal(r.providerId, uid(2)); assert.equal(r.commissionMinorUnits, "10");
  assert.equal(r.ownershipRef?.periodId, uid(10)); assert.equal(r.rateRef?.rateId, uid(20)); assert.equal(r.paymentAllowed, false); assert.equal(r.paidAmountMinorUnits, null);
});
test("new production uses new provider and rate; account platforms are independent", () => {
  const i = income(); i.produced = { startsAt: t("22"), endsAt: t("23") }; assert.equal(result(i).providerId, uid(4)); assert.equal(result(i).commissionMinorUnits, "21");
  const c = context(); c.identityId = uid(99); c.platform = "youtube"; const yt = { ...i, identityId: uid(99), platform: "youtube" as const };
  assert.equal(result(yt, c).providerId, uid(4)); rejects(i, c, "ACCOUNT_MISMATCH"); rejects({ ...i, platform: "youtube" }, context(), "ACCOUNT_MISMATCH");
});
test("confirmed gap is company income even when late; absent history is not gap", () => {
  const i = income(); i.produced = { startsAt: t("11"), endsAt: t("14") }; const c = context(); c.rates = []; c.moneyPolicy = null;
  const r = result(i, c); assert.equal(r.status, "company_income_only"); assert.equal(r.providerId, null); assert.equal(r.commissionMinorUnits, null);
  const missing = context(); missing.ownership = []; pending("ownership_missing_or_cross_boundary", i, missing);
});
test("cross owner, gap and same provider device boundaries never allocate by duration", () => {
  for (const [startsAt, endsAt] of [[t("08"), t("12")], [t("08"), t("16")], [t("14"), t("16")]]) {
    pending("ownership_missing_or_cross_boundary", { ...income(), produced: { startsAt: startsAt!, endsAt: endsAt! } });
  }
  const c = context(); c.ownership[1] = { ...c.ownership[0]!, periodId: uid(11), kind: "provider", providerId: uid(2), deviceId: uid(8), startsAt: t("10"), endsAt: t("15") };
  pending("ownership_missing_or_cross_boundary", { ...income(), produced: { startsAt: t("08"), endsAt: t("12") } }, c);
});
test("cross rate boundary remains pending even if owner is known, no newest ratio", () => {
  pending("rate_missing_or_cross_boundary", { ...income(), produced: { startsAt: t("19"), endsAt: t("21") } });
  const c = context(); c.rates = []; pending("rate_missing_or_cross_boundary", income(), c);
});
test("estimated and confirmed but unreceived never become commission", () => {
  for (const state of ["estimated", "confirmed_unreceived"] as const) pending("income_not_received", { ...income(), state, receiptId: null, receivedAt: null });
  rejects({ ...income(), state: "estimated" }, context(), "INPUT_INVALID"); rejects({ ...income(), receiptId: null }, context(), "INPUT_INVALID");
});
test("missing money and interval stay unknown, true confirmed zero is calculable", () => {
  pending("income_details_missing", { ...income(), amountMinorUnits: null }); pending("income_details_missing", { ...income(), produced: null });
  assert.equal(result({ ...income(), amountMinorUnits: "0" }).commissionMinorUnits, "0");
});
test("unclear attribution and explicit unknown owner cannot be replaced with company", () => {
  pending("attribution_unconfirmed", { ...income(), attribution: "unknown" });
  const c = context(); c.ownership[0] = { periodId: uid(10), version: 1, evidenceId: uid(110), kind: "unknown", startsAt: t("02"), endsAt: t("10") };
  pending("ownership_unknown", income(), c);
});
test("no default precision, currency, ratio or rounding, no FX", () => {
  const c = context(); c.moneyPolicy = null; pending("money_policy_unavailable", income(), c);
  pending("money_policy_unavailable", { ...income(), currency: "EUR" }); pending("money_policy_unavailable", { ...income(), minorUnitScale: 3 });
  rejects(income(), { ...context(), moneyPolicy: { policyId: uid(30), version: 1, currency: "USD", minorUnitScale: 2 } }, "CONTEXT_INVALID");
});
test("explicit down, half up and half even apply exactly once to whole known amount", () => {
  for (const [rounding, expected] of [["down", "10"], ["half_up", "11"], ["half_even", "10"]] as const) {
    const c = context(); c.moneyPolicy!.rounding = rounding; assert.equal(result(income(), c).commissionMinorUnits, expected);
    assert.equal(result({ ...income(), amountMinorUnits: "115" }, c).commissionMinorUnits, rounding === "down" ? "11" : "12");
  }
});
test("bounded integer reference matches 6060 exact rounding examples", () => {
  for (let amount = 0; amount < 20; amount++) for (let percentage = 0; percentage <= 100; percentage++) {
    const c = context(); c.rates[0]!.fraction = percentage === 100 ? "1" : `0.${percentage.toString().padStart(2, "0")}`;
    const product = amount * percentage, q = Math.floor(product / 100), remainder = product % 100;
    for (const rounding of ["down", "half_up", "half_even"] as const) {
      c.moneyPolicy!.rounding = rounding;
      const expected = q + Number(rounding !== "down" && (remainder > 50 || (remainder === 50 && (rounding === "half_up" || q % 2 === 1))));
      assert.equal(result({ ...income(), amountMinorUnits: String(amount) }, c).commissionMinorUnits, String(expected));
    }
  }
});
test("large amounts and 18 fractional digits never pass through floating point", () => {
  const c = context(); c.rates[0]!.fraction = "0.000000000000000001"; c.moneyPolicy!.rounding = "half_up";
  assert.equal(result({ ...income(), amountMinorUnits: "1234567890123456789500000000000000000" }, c).commissionMinorUnits, "1234567890123456790");
  c.rates[0]!.fraction = "1"; const amount = "9".repeat(78); assert.equal(result({ ...income(), amountMinorUnits: amount }, c).commissionMinorUnits, amount);
});
test("left closed right open exact ownership/rate cutoffs use production, not receipt", () => {
  assert.equal(result({ ...income(), produced: { startsAt: t("02"), endsAt: t("10") } }).providerId, uid(2));
  assert.equal(result({ ...income(), produced: { startsAt: t("10"), endsAt: t("15") } }).status, "company_income_only");
  assert.equal(result({ ...income(), produced: { startsAt: t("20"), endsAt: t("21") } }).rateRef?.version, 2);
  pending("ownership_missing_or_cross_boundary", { ...income(), produced: { startsAt: t("01"), endsAt: t("03") } });
});
test("offset equivalents and submillisecond boundaries compare exactly", () => {
  const c = context(); c.ownership[0]!.startsAt = "2026-09-02T08:00:00+08:00"; c.ownership[0]!.endsAt = "2026-09-10T00:00:00.0000001Z";
  c.ownership[1]!.startsAt = c.ownership[0]!.endsAt;
  assert.equal(result({ ...income(), produced: { startsAt: t("02"), endsAt: t("10") } }, c).providerId, uid(2));
  pending("ownership_missing_or_cross_boundary", { ...income(), produced: { startsAt: t("02"), endsAt: "2026-09-10T00:00:00.0000002Z" } }, c);
});
test("future receipt or generated interval never turns into actual known revenue", () => {
  pending("future_income_or_receipt", { ...income(), receivedAt: "2026-10-01T00:00:00.000001Z" });
  pending("future_income_or_receipt", { ...income(), produced: { startsAt: t("25"), endsAt: "2026-10-02T00:00:00Z" } });
});
test("strict invalid money, ratio, cost/payment flags, zero or inverted dates reject", () => {
  for (const amountMinorUnits of ["-1", "01", "1.0", "1e4", "9".repeat(79), 100]) rejects({ ...income(), amountMinorUnits }, context(), "INPUT_INVALID");
  for (const fraction of ["1.1", "-0.1", "NaN", "10%", "0.0000000000000000001"]) {
    const c = context(); c.rates[0]!.fraction = fraction; rejects(income(), c, "CONTEXT_INVALID");
  }
  rejects({ ...income(), kind: "commerce" }, context(), "INPUT_INVALID"); rejects({ ...income(), paid: true }, context(), "INPUT_INVALID");
  rejects({ ...income(), operationalCost: "1" }, context(), "INPUT_INVALID"); rejects({ ...income(), produced: { startsAt: t("08"), endsAt: t("08") } }, context(), "INPUT_INVALID");
  rejects({ ...income(), receivedAt: "0000-01-01T00:00:00Z" }, context(), "INPUT_INVALID");
});
test("overlap, unsorted, duplicate periods, duplicate rate versions and unbounded earlier period reject", () => {
  const overlap = context(); overlap.ownership[0]!.endsAt = t("11"); rejects(income(), overlap, "CONTEXT_INVALID");
  const sorted = context(); sorted.rates.reverse(); rejects(income(), sorted, "CONTEXT_INVALID");
  const duplicate = context(); duplicate.ownership[1]!.periodId = duplicate.ownership[0]!.periodId; rejects(income(), duplicate, "CONTEXT_INVALID");
  const rates = context(); rates.rates[1]!.version = 1; rejects(income(), rates, "CONTEXT_INVALID");
  const unbounded = context(); unbounded.ownership[0]!.endsAt = null; rejects(income(), unbounded, "CONTEXT_INVALID");
});
test("pause/offline flags cannot slice a valid period, company gap requires explicit evidence", () => {
  const c = context(); rejects(income(), { ...c, onlineMilliseconds: 1 }, "CONTEXT_INVALID");
  rejects(income(), { ...c, ownership: [{ ...c.ownership[0], pausedAt: t("03") }] }, "CONTEXT_INVALID");
  rejects(income(), { ...c, ownership: [{ kind: "company_gap", periodId: uid(11), version: 1, startsAt: t("02"), endsAt: null }] }, "CONTEXT_INVALID");
});
test("results and parsers are isolated copies, no input mutation or hidden cache", () => {
  const i = income(), c = context(), before = structuredClone({ i, c }), r = result(i, c);
  assert.deepEqual({ i, c }, before); r.ownershipRef!.periodId = uid(88); r.pendingChecks.push("test_only");
  const parsed = parseCommissionContext(c); parsed.rates[0]!.fraction = "1";
  assert.equal(result(i, c).ownershipRef!.periodId, uid(10)); assert.equal(result(i, c).commissionMinorUnits, "10");
  assert.deepEqual({ i, c }, before); pending("income_details_missing", { ...i, amountMinorUnits: null }, c);
});
