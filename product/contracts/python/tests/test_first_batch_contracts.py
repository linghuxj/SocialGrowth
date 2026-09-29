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

    def test_operator_list_validates_each_item_and_unicode_edge_whitespace(self) -> None:
        operator = {
            "operatorId": self.installation_id,
            "loginName": "operator.one",
            "displayName": "Operator One",
            "factVersion": 0,
            "createdAt": "2026-09-29T00:00:00Z",
            "updatedAt": "2026-09-29T00:00:00Z",
            "status": "active",
            "disabledAt": None,
        }
        response = {"operators": [operator]}
        self.assertIs(self.contracts.validate("listOperatorsResponse", response), response)

        invalid_operators = [
            {**operator, "passwordHash": "must-not-leak"},
            {**operator, "status": "disabled", "disabledAt": None},
            {**operator, "displayName": "\u00a0Operator One"},
            {**operator, "displayName": "\ufeffOperator One"},
            {**operator, "displayName": "Operator One\ufeff"},
        ]
        for invalid_operator in invalid_operators:
            with self.subTest(operator=invalid_operator), self.assertRaises(
                ContractValidationError
            ):
                self.contracts.validate(
                    "listOperatorsResponse", {"operators": [invalid_operator]}
                )

    def test_invitation_list_excludes_access_secret_and_fixes_revocation(self) -> None:
        invitation = {
            "invitationId": self.installation_id,
            "maxUses": 5,
            "consumedUses": 1,
            "expiresAt": "2026-10-06T00:00:00Z",
            "createdAt": "2026-09-29T00:00:00Z",
            "evaluatedAt": "2026-09-29T02:00:00Z",
            "createdByOperatorId": "00000000-0000-4000-8000-000000000002",
            "factVersion": 1,
            "registrations": [
                {
                    "providerId": "00000000-0000-4000-8000-000000000003",
                    "displayName": "Provider One",
                    "registeredAt": "2026-09-29T01:00:00Z",
                    "associatedDeviceCount": 0,
                }
            ],
            "status": "active",
            "revokedAt": None,
            "revokedByOperatorId": None,
        }
        response = {"invitations": [invitation]}
        self.assertIs(
            self.contracts.validate("listInvitationsResponse", response), response
        )

        invalid_invitations = [
            {**invitation, "code": "A" * 43},
            {**invitation, "status": "revoked"},
            {
                **invitation,
                "revokedAt": "2026-09-29T01:00:00Z",
                "revokedByOperatorId": "00000000-0000-4000-8000-000000000002",
            },
        ]
        for invalid_invitation in invalid_invitations:
            with self.subTest(invitation=invalid_invitation), self.assertRaises(
                ContractValidationError
            ):
                self.contracts.validate(
                    "listInvitationsResponse", {"invitations": [invalid_invitation]}
                )

        semantic_contradictions = [
            {**invitation, "consumedUses": 6},
            {**invitation, "consumedUses": 5, "status": "active"},
            {**invitation, "consumedUses": 1, "registrations": []},
            {**invitation, "expiresAt": "2026-09-28T00:00:00Z"},
            {
                **invitation,
                "status": "revoked",
                "revokedAt": "2026-09-30T00:00:00Z",
                "revokedByOperatorId": "00000000-0000-4000-8000-000000000002",
            },
        ]
        for contradiction in semantic_contradictions:
            with self.subTest(invitation=contradiction), self.assertRaises(
                ContractValidationError
            ):
                self.contracts.validate(
                    "listInvitationsResponse", {"invitations": [contradiction]}
                )

        with self.assertRaises(ContractValidationError):
            self.contracts.validate(
                "revokeInvitationResponse",
                {
                    "invitation": {
                        **invitation,
                        "consumedUses": 6,
                        "status": "revoked",
                        "revokedAt": "2026-09-29T01:30:00Z",
                        "revokedByOperatorId": "00000000-0000-4000-8000-000000000002",
                    }
                },
            )

        precise = {
            **invitation,
            "createdAt": "2026-09-29T00:00:00.000000Z",
            "evaluatedAt": "2026-10-06T00:00:00.000100Z",
            "expiresAt": "2026-10-06T00:00:00.000900Z",
            "registrations": [
                {
                    **invitation["registrations"][0],
                    "registeredAt": "2026-10-06T00:00:00.000050Z",
                }
            ],
        }
        self.assertIs(
            self.contracts.validate(
                "listInvitationsResponse", {"invitations": [precise]}
            )["invitations"][0],
            precise,
        )


if __name__ == "__main__":
    unittest.main()
