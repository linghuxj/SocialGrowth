"""Supplemental adapter boundary checks, no provider, phone, browser or acceptance."""
from __future__ import annotations
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("business_adapter", Path(__file__).with_name("artemis-business-model.py"))
assert spec and spec.loader
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class ConfiguredModel:
    model_name = "configured-test-name"

    def __init__(self) -> None:
        self.calls = 0
        self.tracing: list[str | None] = []
        self.failure: Exception | None = None

    def invoke(self, messages: list[object]) -> SimpleNamespace:
        self.calls += 1
        self.tracing = [os.environ.get(k) for k in ("LANGCHAIN_TRACING", "LANGCHAIN_TRACING_V2", "LANGSMITH_TRACING", "LANGSMITH_TRACING_V2")]
        print("PRIVATE_LIBRARY_DIAGNOSTIC")
        if self.failure:
            raise self.failure
        return SimpleNamespace(content='{"answer":"bounded-advisory"}')


class AdapterBoundaryTests(unittest.TestCase):
    def run_main(self, operation: str = "initial_direction", describe: bool = False, fake: bool = False,
                 failure: Exception | None = None) -> tuple[int, dict[str, object], str, ConfiguredModel]:
        model = ConfiguredModel()
        model.failure = failure
        settings = SimpleNamespace(OPENAI_BASE_URL="https://private.invalid", ARTEMIS_DEFAULT_MODEL="configured-test-name")
        modules = {
            "artemis.config.settings": SimpleNamespace(settings=settings),
            "artemis.llm.router": SimpleNamespace(ModelProvider=SimpleNamespace(from_string=lambda v: v),
                ModelEndpoint=lambda **kwargs: SimpleNamespace(**kwargs), ModelFactory=SimpleNamespace(get_model=lambda endpoint: model)),
            "langchain_core.messages": SimpleNamespace(HumanMessage=lambda **kwargs: kwargs, SystemMessage=lambda **kwargs: kwargs),
        }
        request = json.dumps({"operation": operation, "input": {"facts": "declared only"}, "outputSchema": {"type": "object"}}).encode()
        output = io.StringIO()
        # Simulates workspace dotenv overriding inherited disabled telemetry.
        environment = {"ARTEMIS_FAKE_LLM": "1" if fake else "0", "LANGSMITH_TRACING": "true", "LANGCHAIN_TRACING_V2": "true"}
        with patch.dict(sys.modules, modules), patch.dict(os.environ, environment), patch.object(sys, "argv", ["adapter", *(["--describe"] if describe else [])]), patch.object(sys, "stdin", SimpleNamespace(buffer=io.BytesIO(request))), patch.object(sys, "stdout", output):
            code = adapter.main()
        raw = output.getvalue()
        return code, json.loads(raw), raw, model

    def test_workspace_telemetry_is_disabled_before_model_call(self) -> None:
        code, result, raw, model = self.run_main()
        self.assertEqual(code, 0)
        self.assertEqual(model.calls, 1)
        self.assertEqual(model.tracing, ["false"] * 4)
        self.assertEqual(result["outputText"], '{"answer":"bounded-advisory"}')
        self.assertNotIn("PRIVATE_LIBRARY_DIAGNOSTIC", raw)
        self.assertNotIn("private.invalid", raw)

    def test_describe_has_no_model_request(self) -> None:
        code, result, _, model = self.run_main(describe=True)
        self.assertEqual(code, 0)
        self.assertEqual(model.calls, 0)
        self.assertEqual(result, {"configured": True, "providerKey": "openai", "modelKey": "configured-test-name"})

    def test_fake_configuration_is_refused(self) -> None:
        code, result, _, model = self.run_main(fake=True)
        self.assertEqual(code, 1)
        self.assertTrue(result["unavailable"])
        self.assertEqual(model.calls, 0)

    def test_phone_operation_cannot_reach_model(self) -> None:
        code, result, _, model = self.run_main(operation="mobile_run_task")
        self.assertEqual(code, 1)
        self.assertTrue(result["unavailable"])
        self.assertEqual(model.calls, 0)

    def test_provider_error_body_is_never_serialized(self) -> None:
        code, result, raw, model = self.run_main(failure=ValueError("PRIVATE_TOKEN_OR_BODY"))
        self.assertEqual(code, 1)
        self.assertEqual(model.calls, 1)
        self.assertEqual(result, {"unavailable": True, "reason": "model_response_invalid"})
        self.assertNotIn("PRIVATE_TOKEN_OR_BODY", raw)
        self.assertNotIn("PRIVATE_LIBRARY_DIAGNOSTIC", raw)

    def test_timeout_is_bounded_unavailability_without_fallback(self) -> None:
        code, result, _, model = self.run_main(failure=TimeoutError("PRIVATE_REQUEST"))
        self.assertEqual(code, 1)
        self.assertEqual(model.calls, 1)
        self.assertEqual(result, {"unavailable": True, "reason": "model_timeout"})


if __name__ == "__main__":
    unittest.main()
