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

    def test_admission_challenge_is_strict_and_expiry_is_after_issuance(self) -> None:
        challenge = {
            "protocolVersion": "2026-09-30.admission-v1",
            "purpose": "network_node_binding",
            "challengeId": self.installation_id,
            "enrollmentId": self.installation_id,
            "deviceId": self.installation_id,
            "installationId": self.installation_id,
            "installationGeneration": "9007199254740993",
            "enrollmentGeneration": "1",
            "node": {"nodeId": "node-1", "nodeKey": "node-key-1", "networkRevision": 1},
            "nonce": "A" * 43,
            "issuedAt": "2026-09-30T10:00:00Z",
            "expiresAt": "2026-09-30T10:01:00Z",
        }
        self.contracts.validate("enrollmentChallenge", challenge)
        for patch in (
            {"expiresAt": challenge["issuedAt"]},
            {"installationGeneration": 1},
            {"clientIp": "100.64.0.1"},
            {"purpose": "adb_pairing"},
        ):
            with self.assertRaises(ContractValidationError):
                self.contracts.validate("enrollmentChallenge", {**challenge, **patch})

    def test_project_basics_and_projection_keep_unknown_conditions_unapproved(self) -> None:
        basics = {"name": "首期项目", "kind": "company_owned", "customerName": None,
                  "ownerOperatorId": None, "notificationEmail": None}
        project = {**basics, "projectId": self.installation_id, "createdByOperatorId": self.installation_id,
                   "phase": "preparing", "factVersion": 0, "createdAt": "2026-09-30T00:00:00Z",
                   "updatedAt": "2026-09-30T00:00:00Z"}
        self.contracts.validate("projectResponse", {"project": project})
        for patch in ({"kind": "client_managed"}, {"phase": "running"}, {"approved": True},
                      {"updatedAt": "2026-09-29T00:00:00Z"}, {"name": " padded "}, {"notificationEmail": "wrong"}):
            with self.assertRaises(ContractValidationError):
                self.contracts.validate("listProjectsResponse", {"projects": [{**project, **patch}]})

    def test_planning_inputs_remain_unapproved_with_cross_language_limits(self) -> None:
        inputs = dict.fromkeys(("preOpeningGoal", "postOpeningGoal", "postOpeningPriority", "contentRules", "businessTimeZone",
                               "firstCycleStartsAt", "reviewIntervalDays", "trafficMinimumPerCycle", "observationWindowHours",
                               "tailObservationDays", "maxPublicationsPerDay", "publishingWindow"))
        inputs.update(targetCountries=[], targetLanguages=[], contentForms=[])
        self.contracts.validate("projectPlanningInputs", inputs)
        view = {"projectId": self.installation_id, "projectFactVersion": 0, "draftVersion": 0, "inputs": inputs,
                "status": "unapproved_draft", "savedAt": None, "savedByOperatorId": None}
        self.contracts.validate("projectPlanningResponse", {"draft": view})
        for patch in ({"targetCountries": [" padded "]}, {"targetLanguages": ["西班牙语", "西班牙语"]},
                      {"targetCountries": [str(i) for i in range(51)]}, {"contentForms": ["youtube_shorts"] * 5},
                      {"businessTimeZone": "Asia/Unknown"}, {"businessTimeZone": "GMT+8"}, {"reviewIntervalDays": 0},
                      {"approved": True}, {"tailObservationDays": 9007199254740992}):
            with self.assertRaises(ContractValidationError):
                self.contracts.validate("projectPlanningInputs", {**inputs, **patch})
        fine = {**inputs, "businessTimeZone": "Asia/Shanghai", "trafficMinimumPerCycle": 0,
                "publishingWindow": {"startsAt": "2026-09-30T00:00:00.1234567890Z", "endsAt": "2026-09-30T00:00:00.1234567891Z"}}
        self.contracts.validate("projectPlanningInputs", fine)
        with self.assertRaises(ContractValidationError):
            self.contracts.validate("projectPlanningInputs", {**fine, "publishingWindow": {**fine["publishingWindow"], "endsAt": fine["publishingWindow"]["startsAt"]}})
        for patch in ({"status": "approved"}, {"savedAt": "2026-09-30T00:00:00Z"}, {"inputs": fine}):
            with self.assertRaises(ContractValidationError):
                self.contracts.validate("projectPlanningDraftView", {**view, **patch})

    def test_control_action_is_strict_independent_and_never_grants_permission(self) -> None:
        action = {
            "protocolVersion": "2026-09-30.control-v1", "deviceId": self.installation_id,
            "holderId": self.installation_id, "controlGeneration": "9007199254740993",
            "authorizationId": self.installation_id, "taskAttemptId": self.installation_id,
            "actionId": self.installation_id, "purpose": "business", "kind": "read_screen",
        }
        self.contracts.validate("phoneActionRequest", action)
        for patch in ({"permissionGranted": True}, {"kind": "shell"}, {"controlGeneration": 1},
                      {"protocolVersion": "wrong"}, {"purpose": "unrestricted"}):
            with self.assertRaises(ContractValidationError):
                self.contracts.validate("phoneActionRequest", {**action, **patch})

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

    def test_provider_auth_contracts_preserve_masking_and_time_semantics(self) -> None:
        challenge = {
            "challengeId": self.installation_id,
            "purpose": "provider_registration",
            "phoneHint": "+86*******001",
            "deliveryState": "accepted",
            "expiresAt": "2026-09-29T00:05:00.0000000001Z",
            "resendAvailableAt": "2026-09-29T00:01:00Z",
        }
        self.assertIs(
            self.contracts.validate("phoneVerificationChallengeResponse", challenge),
            challenge,
        )

        provider = {
            "providerId": self.installation_id,
            "displayName": "设备提供者",
            "phoneHint": "+86*******001",
            "status": "active",
            "createdAt": "2026-09-29T00:00:00Z",
            "updatedAt": "2026-09-29T00:00:00.0000000001Z",
        }
        auth = {
            "provider": provider,
            "session": {
                "sessionId": "00000000-0000-4000-8000-000000000002",
                "createdAt": "2026-09-29T00:00:00Z",
                "expiresAt": "2026-10-29T00:00:00Z",
            },
            "sessionToken": "A" * 43,
        }
        self.assertIs(self.contracts.validate("providerAuthResponse", auth), auth)
        wide_offset_and_supplementary_name = {
            **provider,
            "displayName": "😀" * 51,
            "createdAt": "2026-09-29T08:00:00+19:00",
            "updatedAt": "2026-09-29T09:00:00+19:00",
        }
        self.assertIs(
            self.contracts.validate(
                "providerSelfView", wide_offset_and_supplementary_name
            ),
            wide_offset_and_supplementary_name,
        )

        contradictions = [
            (
                "phoneVerificationChallengeResponse",
                {**challenge, "resendAvailableAt": "2026-09-29T00:06:00Z"},
            ),
            (
                "phoneVerificationResponse",
                {
                    "phoneVerificationId": self.installation_id,
                    "purpose": "provider_login",
                    "phoneHint": "+86*******001",
                    "verifiedAt": "2026-09-29T00:05:00Z",
                    "expiresAt": "2026-09-29T00:05:00Z",
                },
            ),
            ("providerSelfView", {**provider, "updatedAt": "2026-09-28T23:59:59Z"}),
            (
                "providerAuthResponse",
                {
                    **auth,
                    "provider": {
                        **provider,
                        "phoneHint": "+8613800000001",
                    },
                },
            ),
            (
                "providerAuthResponse",
                {
                    **auth,
                    "session": {
                        **auth["session"],
                        "expiresAt": auth["session"]["createdAt"],
                    },
                },
            ),
        ]
        for name, value in contradictions:
            with self.subTest(name=name), self.assertRaises(ContractValidationError):
                self.contracts.validate(name, value)
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
