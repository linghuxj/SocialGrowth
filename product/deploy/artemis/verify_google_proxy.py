"""Real Google SDK diagnostics only; no phone tools or business operations.

Run in the configured Artemis directory with its Python. Output contains only
check names, booleans, durations and exception types. A synthetic Files upload
is deleted immediately; no user material is used.
"""
from __future__ import annotations

import asyncio
import base64
import contextlib
import io
import json
import os
from pathlib import Path
import struct
import tempfile
import time
from typing import Callable
import zlib


def main() -> int:
    captured = io.StringIO()
    failed = False

    def check(name: str, action: Callable[[], bool]) -> None:
        nonlocal failed
        start = time.monotonic()
        try:
            with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
                passed = bool(action())
            result = {"check": name, "passed": passed, "seconds": round(time.monotonic() - start, 2)}
        except Exception as error:
            passed = False
            result = {"check": name, "passed": False, "errorType": type(error).__name__}
        failed = failed or not passed
        print(json.dumps(result), flush=True)

    try:
        with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
            from artemis.config.settings import settings
            from artemis.config.llm import parse_llm_config
            from artemis.llm.router import ModelEndpoint, ModelFactory
            from artemis.llm.socialgrowth_google_proxy import google_proxy_client_args, google_proxy_http_options
            from google import genai
            from langchain_core.messages import HumanMessage

            if not google_proxy_client_args() or any(k.upper() in {"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"} for k in os.environ):
                raise ValueError("Proxy isolation required")
            cfg = parse_llm_config().model_dump()
            primary_cfg = cfg["planner"]
            fallback_cfg = primary_cfg["fallback"]
            primary = ModelFactory.create_model(ModelEndpoint(provider="google", model_name=primary_cfg["model"],
                thinking_level=primary_cfg.get("thinking_level"), max_tokens=2048, timeout_seconds=40))
            fallback = ModelFactory.create_model(ModelEndpoint(provider="google", model_name=fallback_cfg["model"],
                thinking_level=fallback_cfg.get("thinking_level"), max_tokens=2048, timeout_seconds=40))
            client = genai.Client(api_key=settings.GOOGLE_API_KEY.get_secret_value(), http_options=google_proxy_http_options())

        check("factory-primary-sync", lambda: bool(primary.invoke("Reply with OK only.").content))
        check("factory-fallback-async", lambda: bool(asyncio.run(fallback.ainvoke("Reply with OK only.")).content))
        check("factory-structured-json", lambda: primary.with_structured_output({"title": "Probe", "type": "object",
            "properties": {"ok": {"type": "boolean"}}, "required": ["ok"]}).invoke("Return ok=true.").get("ok") is True)
        check("factory-tool-selection", lambda: bool(primary.bind_tools([{"name": "diagnostic_ok",
            "description": "Return the successful diagnostic result.", "parameters": {"type": "object",
            "properties": {"ok": {"type": "boolean"}}, "required": ["ok"]}}], tool_choice="any")
            .invoke("Call diagnostic_ok with ok=true.").tool_calls))

        def chunk(kind: bytes, data: bytes) -> bytes:
            return struct.pack("!I", len(data)) + kind + data + struct.pack("!I", zlib.crc32(kind + data) & 0xffffffff)

        png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack("!IIBBBBB", 8, 8, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress((b"\x00" + b"\x00\x00\xff" * 8) * 8)) + chunk(b"IEND", b""))
        image = "data:image/png;base64," + base64.b64encode(png).decode()
        check("factory-image-input", lambda: bool(primary.invoke([HumanMessage(content=[
            {"type": "text", "text": "Name the dominant color in one word."},
            {"type": "image_url", "image_url": {"url": image}}])]).content))

        async def native_request() -> bool:
            response = await client.aio.models.generate_content(model=primary_cfg["model"], contents="Reply with OK only.")
            return bool(response.text)

        check("native-google-sdk-async", lambda: asyncio.run(native_request()))

        def files() -> bool:
            uploaded = None
            with tempfile.TemporaryDirectory(prefix="sg-google-proxy-") as directory:
                path = Path(directory) / "diagnostic.txt"
                path.write_text("Non-sensitive proxy connectivity diagnostic.", encoding="utf-8")
                try:
                    uploaded = client.files.upload(file=str(path))
                    return bool(uploaded.name)
                finally:
                    if uploaded:
                        client.files.delete(name=uploaded.name)

        check("native-files-upload-and-delete", files)
        with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
            client.close()
        print(json.dumps({"passed": not failed, "sdkOnlyProxy": True, "phoneOperations": 0}), flush=True)
        return 1 if failed else 0
    except Exception as error:
        print(json.dumps({"passed": False, "errorType": type(error).__name__}), flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
