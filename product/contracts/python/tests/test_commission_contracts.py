import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from socialgrowth_contracts import FirstBatchContracts, ContractValidationError


class CommissionContractsTest(unittest.TestCase):
    def row(self):
        identifier = "a0000000-0000-4000-8000-000000000001"
        return {"incomeId": identifier, "revision": 1, "currentForIncome": False, "identityId": identifier,
                "accountIdentityRef": "page-fixture", "platform": "facebook", "currency": "USD", "minorUnitScale": 2,
                "produced": {"startsAt": "2026-09-01T00:00:00Z", "endsAt": "2026-09-02T00:00:00Z"},
                "receivedAt": "2026-09-25T00:00:00Z", "evaluatedAt": "2026-10-01T00:00:00Z",
                "receivedRevenueMinorUnits": "105", "commissionMinorUnits": "10", "appliedFraction": "0.1", "rateVersion": 1,
                "rounding": "half_even", "moneyPolicyVersion": 1, "calculationStage": "internal_calculation_only", "paymentStatus": "not_recorded", "paymentAllowed": False}

    def test_internal_money_and_exact_time_semantics(self):
        contracts = FirstBatchContracts()
        row = self.row()
        self.assertIs(contracts.validate("providerCommissionRecord", row), row)
        for patch in ({"paymentAllowed": True}, {"providerId": row["incomeId"]}, {"paymentStatus": "paid"},
                      {"commissionMinorUnits": "106"}, {"commissionMinorUnits": "NaN"}, {"evaluatedAt": "0000-01-01T00:00:00Z"},
                      {"receivedAt": "2026-10-01T00:00:00.0000000000000000000001Z"}):
            with self.assertRaises(ContractValidationError):
                contracts.validate("providerCommissionRecord", {**row, **patch})
        equivalent = copy.deepcopy(row)
        equivalent["produced"]["endsAt"] = "2026-10-01T08:00:00+08:00"
        contracts.validate("providerCommissionRecord", equivalent)
        equivalent["produced"]["startsAt"] = equivalent["produced"]["endsAt"]
        with self.assertRaises(ContractValidationError):
            contracts.validate("providerCommissionRecord", equivalent)

    def test_cursor_and_revision_identity(self):
        contracts = FirstBatchContracts()
        row = self.row()
        second = {**row, "revision": 2, "currentForIncome": True}
        contracts.validate("listProviderCommissionsResponse", {"records": [row, second], "nextAfter": {"incomeId": row["incomeId"].upper(), "revision": 2}})
        for value in ({"records": [row, row], "nextAfter": None}, {"records": [row], "nextAfter": {"incomeId": row["incomeId"], "revision": 2}},
                      {"records": [], "nextAfter": {"incomeId": row["incomeId"], "revision": 1}}):
            with self.assertRaises(ContractValidationError):
                contracts.validate("listProviderCommissionsResponse", value)
