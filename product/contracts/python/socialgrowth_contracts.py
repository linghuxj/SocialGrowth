"""Runtime consumer for the committed first-batch JSON Schema artifact."""

from __future__ import annotations

import json
import re
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
        return value

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
