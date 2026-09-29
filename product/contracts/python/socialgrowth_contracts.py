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
        "maximum",
        "minLength",
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
        if name == "invitationView":
            self._validate_invitation_view(value, name)
        elif name in {"createInvitationResponse", "revokeInvitationResponse"}:
            self._validate_invitation_view(value["invitation"], f"{name}.invitation")
        elif name == "listInvitationsResponse":
            for index, invitation in enumerate(value["invitations"]):
                self._validate_invitation_view(
                    invitation, f"{name}.invitations[{index}]"
                )

    @staticmethod
    def _timestamp_parts(value: str) -> tuple[datetime, str]:
        match = re.fullmatch(
            r"(.*:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})", value, flags=re.ASCII
        )
        if match is None:
            raise ContractDataError("timestamp was not structurally validated")
        whole_seconds = datetime.fromisoformat(
            f"{match.group(1)}{match.group(3)}".replace("Z", "+00:00")
        )
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
