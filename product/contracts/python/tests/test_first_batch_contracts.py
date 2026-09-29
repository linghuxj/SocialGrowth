import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from socialgrowth_contracts import (
    ContractSpecificationError,
    ContractValidationError,
    FirstBatchContracts,
)


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

    def test_matches_json_integer_and_ascii_pattern_semantics(self) -> None:
        accepted = {
            "factVersion": 1.0,
            "updatedAt": "2026-09-29T00:00:00.1234567890Z",
            "installationId": self.installation_id,
            "state": "unassociated",
            "deviceId": None,
        }
        self.assertIs(
            self.contracts.validate("installationSelfView", accepted),
            accepted,
        )
        with self.assertRaises(ContractValidationError):
            self.contracts.validate(
                "installationSelfView",
                {
                    **accepted,
                    "updatedAt": "２０２６-09-29T00:00:00Z",
                },
            )

    def test_composition_does_not_skip_sibling_constraints(self) -> None:
        with self.assertRaises(ContractValidationError):
            self.contracts._validate_schema(
                {"anyOf": [{"type": "string"}], "maxLength": 1},
                "bad",
                "probe",
            )
        with self.assertRaises(ContractSpecificationError):
            self.contracts._validate_schema(
                {"type": "string", "futureKeyword": True},
                "value",
                "probe",
            )

    def test_composition_does_not_hide_invalid_schema_branches(self) -> None:
        invalid_schemas = [
            {"anyOf": [{"type": "string"}, {"futureKeyword": True}]},
            {
                "anyOf": [
                    {"type": "string"},
                    {"type": "string", "format": "email"},
                ]
            },
            {
                "anyOf": [
                    {"type": "string"},
                    {
                        "type": "object",
                        "properties": {"unused": {"futureKeyword": True}},
                    },
                ]
            },
        ]
        for schema in invalid_schemas:
            with self.subTest(schema=schema), self.assertRaises(
                ContractSpecificationError
            ):
                self.contracts._validate_schema(schema, "bad", "probe")


if __name__ == "__main__":
    unittest.main()
