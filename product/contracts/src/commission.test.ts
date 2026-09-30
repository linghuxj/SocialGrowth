import assert from "node:assert/strict";
import test from "node:test";
import { providerCommissionRecordSchema, listProviderCommissionsResponseSchema } from "./commission.js";
const id = "a0000000-0000-4000-8000-000000000001";
const row = () => ({ incomeId: id, revision: 1, currentForIncome: false, identityId: id, accountIdentityRef: "page-fixture", platform: "facebook",
  currency: "USD", minorUnitScale: 2, produced: { startsAt: "2026-09-01T00:00:00Z", endsAt: "2026-09-02T00:00:00Z" }, receivedAt: "2026-09-25T00:00:00Z",
  evaluatedAt: "2026-10-01T00:00:00Z", receivedRevenueMinorUnits: "105", commissionMinorUnits: "10", appliedFraction: "0.1", rateVersion: 1,
  rounding: "half_even", moneyPolicyVersion: 1, calculationStage: "internal_calculation_only", paymentStatus: "not_recorded", paymentAllowed: false });
test("commission contract is minimal exact-money internal history, no payables or other-person fields", () => {
  assert.equal(providerCommissionRecordSchema.safeParse(row()).success, true);
  for (const patch of [{ providerId: id }, { paidAmount: "10" }, { paymentStatus: "paid" }, { paymentAllowed: true }, { totalBalance: "20" }, { sourceSecret: "secret" }, { commissionMinorUnits: "1.0" }]) {
    assert.equal(providerCommissionRecordSchema.safeParse({ ...row(), ...patch }).success, false);
  }
  assert.equal(providerCommissionRecordSchema.safeParse({ ...row(), receivedRevenueMinorUnits: "9".repeat(78), commissionMinorUnits: "9".repeat(78) }).success, true);
});
test("commission page enforces revision uniqueness and last-record cursor, permits distinct revisions", () => {
  const r = row(), second = { ...r, revision: 2, currentForIncome: true };
  assert.equal(listProviderCommissionsResponseSchema.safeParse({ records: [r, second], nextAfter: { incomeId: id.toUpperCase(), revision: 2 } }).success, true);
  for (const value of [{ records: [r, r], nextAfter: null }, { records: [r], nextAfter: { incomeId: id, revision: 2 } }, { records: [], nextAfter: { incomeId: id, revision: 1 } }]) {
    assert.equal(listProviderCommissionsResponseSchema.safeParse(value).success, false);
  }
});
test("commission times compare exact fractions and offsets, invalid calendar/money never throws raw BigInt errors", () => {
  const r = row(); r.produced.endsAt = "2026-10-01T08:00:00+08:00"; assert.equal(providerCommissionRecordSchema.safeParse(r).success, true);
  for (const patch of [{ receivedAt: "2026-10-01T00:00:00.0000000000000000000001Z" }, { evaluatedAt: "0000-01-01T00:00:00Z" }, { commissionMinorUnits: "NaN" }, { commissionMinorUnits: "106" }]) {
    assert.equal(providerCommissionRecordSchema.safeParse({ ...r, ...patch }).success, false);
  }
  assert.equal(providerCommissionRecordSchema.safeParse({ ...r, produced: { startsAt: r.produced.endsAt, endsAt: r.produced.endsAt } }).success, false);
});
