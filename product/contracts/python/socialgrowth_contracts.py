"""Runtime consumer for the committed first-batch JSON Schema artifact."""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any


class ContractValidationError(ValueError):
    pass


class ContractSpecificationError(ContractValidationError):
    pass


class ContractDataError(ContractValidationError):
    pass


class FirstBatchContracts:
    _SUPPORTED_KEYWORDS = {
        "$schema",
        "additionalProperties",
        "anyOf",
        "const",
        "enum",
        "format",
        "items",
        "maxLength",
        "maxItems",
        "maximum",
        "minLength",
        "minItems",
        "minimum",
        "oneOf",
        "pattern",
        "properties",
        "required",
        "type",
    }

    def __init__(self, schema_path: Path | None = None) -> None:
        path = schema_path or (
            Path(__file__).resolve().parents[1]
            / "generated"
            / "first-batch-contracts.v1.json"
        )
        document = json.loads(path.read_text(encoding="utf-8"))
        self.contract_version: str = document["contractVersion"]
        self._schemas: dict[str, dict[str, Any]] = document["schemas"]

    def validate(self, name: str, value: Any) -> Any:
        try:
            schema = self._schemas[name]
        except KeyError as error:
            raise ContractValidationError(f"unknown contract: {name}") from error
        self._validate_schema(schema, value, name)
        self._validate_contract_semantics(name, value)
        return value

    def _validate_contract_semantics(self, name: str, value: Any) -> None:
        if name == "batchMaterialDeclarationsResponse":
            for index, result in enumerate(value["results"]):
                if result["index"] != index:
                    raise ContractDataError(f"{name}: inconsistent item index")
                if result["outcome"] == "saved":
                    self._validate_contract_semantics("saveMaterialDeclarationResponse", result["material"])
                    if result["material"]["projectId"].lower() != value["projectId"].lower():
                        raise ContractDataError(f"{name}: inconsistent item project")
        elif name == "materialHistoryResponse":
            current, rows = value["current"], value["revisions"]
            self._validate_contract_semantics("materialCurrentView", current)
            last = rows[-1] if rows else None
            cursor = last["revision"] if last and last["revision"] < current["currentRevision"] else None
            if value["nextAfterRevision"] != cursor:
                raise ContractDataError(f"{name}: inconsistent revision cursor")
            for index, row in enumerate(rows):
                self._validate_contract_semantics("materialCurrentView", {**current, **row, "currentRevision": row["revision"]})
                if (row["revision"] > current["currentRevision"] or (index and row["revision"] != rows[index - 1]["revision"] + 1)
                    or self._compare_timestamps(row["recordedAt"], current["recordedAt"]) > 0
                    or (index and self._compare_timestamps(rows[index - 1]["recordedAt"], row["recordedAt"]) > 0)):
                    raise ContractDataError(f"{name}: inconsistent revision sequence or time")
            if (last and last["revision"] == current["currentRevision"]
                and (self._compare_timestamps(last["recordedAt"], current["recordedAt"]) != 0
                     or last["declaration"] != current["declaration"] or last["objects"] != current["objects"])):
                raise ContractDataError(f"{name}: current revision differs from history")
        elif name in ("saveMaterialDeclarationRequest", "materialCurrentView", "saveMaterialDeclarationResponse"):
            identity, declaration = value["identity"], value["declaration"]
            whitespace = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
            if ((identity["seriesId"] is None) != (identity["episodeNumber"] is None)
                or (identity["seriesId"] is not None and (identity["mediaKind"] != "video" or identity["businessKind"] != "drama"))):
                raise ContractDataError(f"{name}: inconsistent explicit episode identity")
            for field, maximum in (("name", 150), ("description", 5000), ("businessFacts", 5000), ("sourceStatement", 5000)):
                text = declaration[field]
                if (text.strip(whitespace) != text or any(ord(char) < 32 or ord(char) == 127 for char in text)
                    or len(text) > maximum):
                    raise ContractDataError(f"{name}: invalid explicit declaration text")
            evidence = [item.lower() for item in declaration["sourceEvidenceIds"]]
            if len(set(evidence)) != len(evidence):
                raise ContractDataError(f"{name}: duplicate evidence identity")
            if name == "saveMaterialDeclarationRequest":
                objects = [item.lower() for item in value["objectIds"]]
            else:
                objects = [item["objectId"].lower() for item in value["objects"]]
                if (value["recordedAt"].startswith("0000-")
                    or any((item["contentType"].startswith("image/") if identity["mediaKind"] == "video" else item["contentType"] == "video/mp4") for item in value["objects"])
                    or (name == "saveMaterialDeclarationResponse" and value["changed"] and value["replayed"])):
                    raise ContractDataError(f"{name}: inconsistent material current result")
            if len(set(objects)) != len(objects) or (identity["mediaKind"] == "video" and len(objects) != 1):
                raise ContractDataError(f"{name}: invalid explicit object list")
        elif name in ("materialUploadTicketView", "prepareMaterialUploadResponse", "uploadMaterialBytesResponse"):
            verified = value["verifiedAt"]
            if ((value["status"] == "verified_bytes") != (verified is not None)
                or (verified is not None and self._compare_timestamps(value["preparedAt"], verified) > 0)
                or (name in ("prepareMaterialUploadResponse", "uploadMaterialBytesResponse") and value["changed"] and value["replayed"])
                or (name == "uploadMaterialBytesResponse" and value["status"] != "verified_bytes")):
                raise ContractDataError(f"{name}: inconsistent byte verification state")
        elif name in ("providerCommissionRecord", "listProviderCommissionsResponse"):
            records = value["records"] if name == "listProviderCommissionsResponse" else [value]
            for record in records:
                if (self._compare_timestamps(record["produced"]["startsAt"], record["produced"]["endsAt"]) >= 0
                    or self._compare_timestamps(record["produced"]["endsAt"], record["evaluatedAt"]) > 0
                    or self._compare_timestamps(record["receivedAt"], record["evaluatedAt"]) > 0
                    or int(record["commissionMinorUnits"]) > int(record["receivedRevenueMinorUnits"])):
                    raise ContractDataError(f"{name}: inconsistent internal commission record")
            if name == "listProviderCommissionsResponse":
                keys = [(r["incomeId"].lower(), r["revision"]) for r in records]
                cursor = value["nextAfter"]
                if len(set(keys)) != len(keys) or (cursor is not None and (not keys or (cursor["incomeId"].lower(), cursor["revision"]) != keys[-1])):
                    raise ContractDataError(f"{name}: inconsistent commission cursor or identity")
        elif name == "listDeviceAssistanceNotesResponse":
            self._validate_contract_semantics("deviceAssistanceTodoSummary", value["todo"])
            ids = [note["noteId"].lower() for note in value["notes"]]
            cursor = value["nextAfterNoteId"]
            if len(ids) != len(set(ids)) or len(ids) > value["todo"]["noteCount"] or (cursor is not None and (not ids or cursor.lower() != ids[-1])):
                raise ContractDataError(f"{name}: inconsistent notes cursor or count")
            if any(self._compare_timestamps(note["recordedAt"], value["todo"]["createdAt"]) < 0 or self._compare_timestamps(note["recordedAt"], value["todo"]["updatedAt"]) > 0 for note in value["notes"]):
                raise ContractDataError(f"{name}: note outside current item history")
        elif name in ("deviceAssistanceTodoSummary", "listDeviceAssistanceTodosResponse", "recordDeviceAssistanceNoteResponse", "providerDeviceAssistanceTodoSummary", "listProviderDeviceAssistanceTodosResponse"):
            page = name in ("listDeviceAssistanceTodosResponse", "listProviderDeviceAssistanceTodosResponse")
            todos = value["todos"] if page else [value["todo"] if name == "recordDeviceAssistanceNoteResponse" else value]
            for todo in todos:
                if todo["status"] == "awaiting_recheck" and todo["noteCount"] == 0:
                    raise ContractDataError(f"{name}: recheck lacks processing report")
                if self._compare_timestamps(todo["updatedAt"], todo["createdAt"]) < 0:
                    raise ContractDataError(f"{name}: update predates creation")
            if page:
                ids = [todo["todoId"].lower() for todo in todos]
                cursor = value["nextAfterTodoId"]
                if len(set(ids)) != len(ids) or (cursor is not None and (not ids or cursor.lower() != ids[-1])):
                    raise ContractDataError(f"{name}: inconsistent page cursor or identity")
        elif name in ("projectPlanningInputs", "saveProjectPlanningRequest", "projectPlanningDraftView", "projectPlanningResponse"):
            draft = value["draft"] if name == "projectPlanningResponse" else value
            inputs = value if name == "projectPlanningInputs" else draft["inputs"]
            for key in ("targetCountries", "targetLanguages", "contentForms"):
                if len(set(inputs[key])) != len(inputs[key]):
                    raise ContractDataError(f"{name}: duplicate planning input")
            # Exact-case time zone vocabulary is the generated JSON enum.
            # Actual scheduling must separately verify executable TZif data;
            # a host's filesystem casing/installed tzdata is not the contract.
            window = inputs["publishingWindow"]
            if window is not None and self._compare_timestamps(window["startsAt"], window["endsAt"]) >= 0:
                raise ContractDataError(f"{name}: unordered publication window")
            if name in ("projectPlanningDraftView", "projectPlanningResponse"):
                unsaved = draft["draftVersion"] == 0
                no_provenance = draft["savedAt"] is None and draft["savedByOperatorId"] is None
                if unsaved != no_provenance or (draft["savedAt"] is None) != (draft["savedByOperatorId"] is None):
                    raise ContractDataError(f"{name}: inconsistent save provenance")
                if unsaved and any(v != [] if k in ("targetCountries", "targetLanguages", "contentForms") else v is not None for k, v in inputs.items()):
                    raise ContractDataError(f"{name}: unsaved draft claims persisted inputs")
        elif name in ("createProjectRequest", "updateProjectRequest"):
            self._validate_project_basics(value["basics"], name)
        elif name in ("projectView", "projectResponse", "listProjectsResponse"):
            projects = value["projects"] if name == "listProjectsResponse" else [value["project"] if name == "projectResponse" else value]
            for project in projects:
                self._validate_project_basics(project, name)
                if self._compare_timestamps(project["updatedAt"], project["createdAt"]) < 0:
                    raise ContractDataError(f"{name}: update predates creation")
        elif name == "enrollmentChallenge":
            if self._compare_timestamps(value["issuedAt"], value["expiresAt"]) >= 0:
                raise ContractDataError(f"{name}: challenge is already expired")
        elif name == "invitationView":
            self._validate_invitation_view(value, name)
        elif name in {"createInvitationResponse", "revokeInvitationResponse"}:
            self._validate_invitation_view(value["invitation"], f"{name}.invitation")
        elif name == "listInvitationsResponse":
            for index, invitation in enumerate(value["invitations"]):
                self._validate_invitation_view(
                    invitation, f"{name}.invitations[{index}]"
                )
        elif name == "phoneVerificationChallengeResponse":
            if self._compare_timestamps(
                value["resendAvailableAt"], value["expiresAt"]
            ) > 0:
                raise ContractDataError(
                    f"{name}: resend availability is after challenge expiry"
                )
        elif name == "phoneVerificationResponse":
            if self._compare_timestamps(value["verifiedAt"], value["expiresAt"]) >= 0:
                raise ContractDataError(f"{name}: verification proof is already expired")
        elif name == "providerSelfView":
            self._validate_provider_view(value, name)
        elif name == "providerAuthResponse":
            self._validate_provider_view(value["provider"], f"{name}.provider")
            if self._compare_timestamps(
                value["session"]["createdAt"], value["session"]["expiresAt"]
            ) >= 0:
                raise ContractDataError(f"{name}.session: session is already expired")

    @staticmethod
    def _validate_project_basics(value: dict[str, Any], path: str) -> None:
        if (value["kind"] == "client_managed") != (value["customerName"] is not None):
            raise ContractDataError(f"{path}: customer and project kind conflict")

    @staticmethod
    def _timestamp_parts(value: str) -> tuple[datetime, str]:
        match = re.fullmatch(
            r"(.*:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})", value, flags=re.ASCII
        )
        if match is None:
            raise ContractDataError("timestamp was not structurally validated")
        try:
            whole_seconds = datetime.fromisoformat(
                f"{match.group(1)}{match.group(3)}".replace("Z", "+00:00")
            )
        except (ValueError, OverflowError) as error:
            raise ContractDataError("timestamp outside supported calendar") from error
        return whole_seconds, match.group(2) or ""

    @classmethod
    def _compare_timestamps(cls, left: str, right: str) -> int:
        left_seconds, left_fraction = cls._timestamp_parts(left)
        right_seconds, right_fraction = cls._timestamp_parts(right)
        if left_seconds != right_seconds:
            return -1 if left_seconds < right_seconds else 1
        width = max(len(left_fraction), len(right_fraction))
        left_padded = left_fraction.ljust(width, "0")
        right_padded = right_fraction.ljust(width, "0")
        return (left_padded > right_padded) - (left_padded < right_padded)

    def _validate_invitation_view(self, invitation: dict[str, Any], path: str) -> None:
        consumed_uses = invitation["consumedUses"]
        max_uses = invitation["maxUses"]
        registrations = invitation["registrations"]

        if (
            self._compare_timestamps(invitation["expiresAt"], invitation["createdAt"])
            <= 0
            or self._compare_timestamps(
                invitation["evaluatedAt"], invitation["createdAt"]
            )
            < 0
        ):
            raise ContractDataError(f"{path}: contradictory invitation time")
        if consumed_uses > max_uses:
            raise ContractDataError(f"{path}: invitation consumption exceeds limit")
        if len(registrations) != consumed_uses:
            raise ContractDataError(f"{path}: registrations are not the complete set")
        provider_ids = [item["providerId"] for item in registrations]
        if len(set(provider_ids)) != len(provider_ids):
            raise ContractDataError(f"{path}: duplicate registered provider")
        for registration in registrations:
            if (
                self._compare_timestamps(
                    registration["registeredAt"], invitation["createdAt"]
                )
                < 0
                or self._compare_timestamps(
                    registration["registeredAt"], invitation["evaluatedAt"]
                )
                > 0
            ):
                raise ContractDataError(f"{path}: registration time outside observation")

        if invitation["status"] == "revoked":
            if (
                self._compare_timestamps(
                    invitation["revokedAt"], invitation["createdAt"]
                )
                < 0
            ):
                raise ContractDataError(f"{path}: revocation predates invitation")
            if (
                self._compare_timestamps(
                    invitation["revokedAt"], invitation["evaluatedAt"]
                )
                > 0
            ):
                raise ContractDataError(f"{path}: revocation outside observation")
            return

        expected_status = (
            "expired"
            if self._compare_timestamps(
                invitation["expiresAt"], invitation["evaluatedAt"]
            )
            <= 0
            else "exhausted"
            if consumed_uses == max_uses
            else "active"
        )
        if invitation["status"] != expected_status:
            raise ContractDataError(f"{path}: status contradicts evaluated facts")

    def _validate_provider_view(self, provider: dict[str, Any], path: str) -> None:
        if self._compare_timestamps(provider["updatedAt"], provider["createdAt"]) < 0:
            raise ContractDataError(f"{path}: update predates creation")

    def _validate_schema(self, schema: dict[str, Any], value: Any, path: str) -> None:
        self._validate_specification(schema, path)
        self._validate_value(schema, value, path)

    def _validate_specification(self, schema: dict[str, Any], path: str) -> None:
        unsupported = schema.keys() - self._SUPPORTED_KEYWORDS
        if unsupported:
            raise ContractSpecificationError(
                f"{path}: unsupported schema keywords {sorted(unsupported)}"
            )
        schema_format = schema.get("format")
        if schema_format is not None and "pattern" not in schema:
            raise ContractSpecificationError(
                f"{path}: format {schema_format} requires an explicit generated pattern"
            )
        for keyword in ("oneOf", "anyOf"):
            if keyword not in schema:
                continue
            branches = schema[keyword]
            if not isinstance(branches, list):
                raise ContractSpecificationError(f"{path}: {keyword} must be an array")
            for index, branch in enumerate(branches):
                if not isinstance(branch, dict):
                    raise ContractSpecificationError(
                        f"{path}: {keyword}[{index}] must be an object"
                    )
                self._validate_specification(branch, f"{path}.{keyword}[{index}]")
        properties = schema.get("properties", {})
        if not isinstance(properties, dict):
            raise ContractSpecificationError(f"{path}: properties must be an object")
        for key, child in properties.items():
            if not isinstance(child, dict):
                raise ContractSpecificationError(
                    f"{path}.properties.{key} must be an object"
                )
            self._validate_specification(child, f"{path}.{key}")
        items = schema.get("items")
        if items is not None:
            if not isinstance(items, dict):
                raise ContractSpecificationError(f"{path}: items must be an object")
            self._validate_specification(items, f"{path}.items")

    def _validate_value(self, schema: dict[str, Any], value: Any, path: str) -> None:
        for keyword in ("oneOf", "anyOf"):
            if keyword in schema:
                matches = 0
                for branch in schema[keyword]:
                    try:
                        self._validate_value(branch, value, path)
                        matches += 1
                    except ContractDataError:
                        pass
                expected = 1 if keyword == "oneOf" else None
                if matches == 0 or (expected is not None and matches != expected):
                    raise ContractDataError(f"{path}: {keyword} did not match")

        expected_type = schema.get("type")
        is_integer = (
            isinstance(value, int)
            and not isinstance(value, bool)
            or isinstance(value, float)
            and value.is_integer()
        )
        type_matches = {
            "object": isinstance(value, dict),
            "string": isinstance(value, str),
            "boolean": isinstance(value, bool),
            "integer": is_integer,
            "null": value is None,
            "array": isinstance(value, list),
        }
        if expected_type is not None and not type_matches.get(expected_type, False):
            raise ContractDataError(f"{path}: expected {expected_type}")
        if "const" in schema and value != schema["const"]:
            raise ContractDataError(f"{path}: unsupported constant value")
        if "enum" in schema and value not in schema["enum"]:
            raise ContractDataError(f"{path}: value is not in enum")

        if isinstance(value, dict):
            properties = schema.get("properties", {})
            missing = set(schema.get("required", ())) - value.keys()
            if missing:
                raise ContractDataError(f"{path}: missing {sorted(missing)}")
            if schema.get("additionalProperties") is False:
                unknown = value.keys() - properties.keys()
                if unknown:
                    raise ContractDataError(f"{path}: unknown {sorted(unknown)}")
            for key, item in value.items():
                if key in properties:
                    self._validate_value(properties[key], item, f"{path}.{key}")

        if isinstance(value, list):
            if len(value) < schema.get("minItems", 0) or len(value) > schema.get("maxItems", len(value)):
                raise ContractDataError(f"{path}: array length outside limits")
            items = schema.get("items")
            if items is not None:
                for index, item in enumerate(value):
                    self._validate_value(items, item, f"{path}[{index}]")

        if isinstance(value, str):
            if len(value) < schema.get("minLength", 0):
                raise ContractDataError(f"{path}: string is too short")
            maximum = schema.get("maxLength")
            if maximum is not None and len(value) > maximum:
                raise ContractDataError(f"{path}: string is too long")
            pattern = schema.get("pattern")
            if pattern is not None and re.fullmatch(pattern, value, flags=re.ASCII) is None:
                raise ContractDataError(f"{path}: pattern mismatch")

        if is_integer:
            numeric_value = int(value)
            if numeric_value < schema.get("minimum", numeric_value):
                raise ContractDataError(f"{path}: integer below minimum")
            if numeric_value > schema.get("maximum", numeric_value):
                raise ContractDataError(f"{path}: integer above maximum")
