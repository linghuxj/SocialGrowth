import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from socialgrowth_contracts import ContractValidationError, FirstBatchContracts


class FirstBatchContractsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.contracts = FirstBatchContracts()
        self.installation_id = "00000000-0000-4000-8000-000000000001"

    def test_accepts_versioned_qr_and_installation_view(self) -> None:
        self.contracts.validate(
            "associationQrPayload",
            {
                "contractVersion": self.contracts.contract_version,
                "associationCode": "sgassoc_v1_" + "A" * 43,
            },
        )
        self.contracts.validate(
            "installationSelfView",
            {
                "factVersion": 1,
                "updatedAt": "2026-09-29T00:00:00Z",
                "installationId": self.installation_id,
                "state": "unassociated",
                "deviceId": None,
            },
        )

    def test_rejects_old_version_unknown_field_and_contradictory_state(self) -> None:
        invalid_values = [
            (
                "associationQrPayload",
                {
                    "contractVersion": "2026-09-28.identity-v0",
                    "associationCode": "sgassoc_v1_" + "A" * 43,
                },
            ),
            (
                "associationQrPayload",
                {
                    "contractVersion": self.contracts.contract_version,
                    "associationCode": "sgassoc_v1_" + "A" * 43,
                    "providerId": self.installation_id,
                },
            ),
            (
                "installationSelfView",
                {
                    "factVersion": 1,
                    "updatedAt": "2026-09-29T00:00:00Z",
                    "installationId": self.installation_id,
                    "state": "unassociated",
                    "deviceId": self.installation_id,
                },
            ),
        ]
        for name, value in invalid_values:
            with self.subTest(name=name), self.assertRaises(ContractValidationError):
                self.contracts.validate(name, value)


if __name__ == "__main__":
    unittest.main()
