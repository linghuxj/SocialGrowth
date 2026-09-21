"""Operator-only, one-shot human password handoff. Never puts secrets in tool args/results.

Install beside artemis/tools and mount get_human_input_tool() in OperatorNode only.
The capability is scoped by SocialGrowth to one device, task and expected identity.
"""
import asyncio
import base64
import json
import os
import shlex
import subprocess
import time
from pathlib import Path
import urllib.request
from urllib.parse import urlparse
import xml.etree.ElementTree as ET

from langchain_core.tools import StructuredTool
from artemis.drivers.factory import get_driver


def password_target(xml: str, package: str, require_empty: bool = True) -> tuple[str, str, str]:
    """Fail closed: exactly one focused, enabled, empty protected native field."""
    nodes = [n for n in ET.fromstring(xml).iter("node")
             if n.get("password") == "true" and n.get("focused") == "true"
             and n.get("enabled") == "true" and n.get("package") == package]
    if len(nodes) != 1 or (require_empty and nodes[0].get("text", "")):
        raise ValueError("EMPTY_FOCUSED_PASSWORD_FIELD_REQUIRED")
    n = nodes[0]
    return n.get("resource-id", ""), n.get("class", ""), n.get("bounds", "")


def account_screen_labels(xml: str, package: str) -> tuple[str, ...]:
    """Detect account/context changes without hashing clocks, cursor or keyboard state."""
    labels = []
    for node in ET.fromstring(xml).iter("node"):
        if node.get("package") == package and node.get("password") != "true":
            for key in ("text", "content-desc"):
                if node.get(key):
                    labels.append(node.get(key))
    return tuple(sorted(labels))


def verify_masked_input(xml: str, package: str, target: tuple[str, str, str], length: int) -> None:
    """Prove target and masked length, without exposing or comparing credential characters."""
    if password_target(xml, package, require_empty=False) != target:
        raise ValueError("INPUT_TARGET_CHANGED")
    node = next(n for n in ET.fromstring(xml).iter("node")
                if n.get("password") == "true" and n.get("focused") == "true" and n.get("package") == package)
    masked = node.get("text", "")
    if len(masked) != length or any(c not in "•●*·" for c in masked):
        raise ValueError("MASKED_INPUT_LENGTH_UNCONFIRMED")


def get_human_input_tool(ctx, kind: str = "password"):
    url, token = os.environ.get("SG_ASSISTANCE_URL"), os.environ.get("SG_ASSISTANCE_TOKEN")
    if not url or not token:
        return None
    parsed = urlparse(url)
    if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost", "::1")):
        raise ValueError("ASSISTANCE_TLS_REQUIRED")

    def request(path: str, data: dict | None = None) -> dict:
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None
        req = urllib.request.Request(url.rstrip("/") + "/api/runtime/assistance/agent/" + path,
            data=json.dumps(data).encode() if data is not None else None,
            headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        with urllib.request.build_opener(NoRedirect).open(req, timeout=15) as response:
            return json.load(response)

    async def human_password_input() -> str:
        """Pause this task for Web operator password input into the CURRENT focused masked
        password field. FIRST focus that field. Existing masked text is securely cleared and
        verified empty before requesting Web input. Do not pass, read, reveal or guess any password.
        Web operator confirms account identity. This tool NEVER clicks Log in or publishes.
        After INPUT_COMPLETED observe and click Log in at most ONCE; on rejection stop, no retry.
        Do not call other device actions in the same turn. On failure stop for human assistance.
        """
        challenge_id = None
        stage = "SESSION_UNAVAILABLE"
        try:
            scope = await asyncio.to_thread(request, "session")
            await asyncio.to_thread(request, "credential-begin", {"kind": kind})
            driver = get_driver(ctx)
            if driver.device_id != scope["serial"]:
                raise ValueError("DEVICE_MISMATCH")
            if await driver.get_current_package() != scope["packageName"]:
                raise ValueError("APP_MISMATCH")
            stage = "PROTECTED_FIELD_REQUIRED"
            screen = await driver.get_screen_data()
            target = password_target(screen.ui_hierarchy_xml or "", scope["packageName"], require_empty=False)
            # A PNG from adb is authoritative; do not accept an image supplied by the model.
            def adb(args: list[str], stdin: bytes | None = None) -> bytes:
                done = subprocess.run(["adb", "-s", scope["serial"], *args], input=stdin,
                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=30, check=False)
                if done.returncode:
                    raise ValueError("DEVICE_IO_FAILED")
                return done.stdout
            # An empty text action can be a no-op in Artemis. Clear only this verified
            # focused protected field, without reading its value into model/logs.
            stage = "PROTECTED_FIELD_CLEAR_FAILED"
            # Facebook's Bloks password widget ignores generic keyevent deletion.
            # Use the existing UIAutomator native clearTextField action on exactly
            # the verified focused EditText; never pass any credential to UIAutomator.
            def clear_protected_field() -> None:
                import uiautomator2
                ui = uiautomator2.connect(scope["serial"])
                xml = ui.dump_hierarchy(compressed=True)
                if password_target(xml, scope["packageName"], require_empty=False) != target:
                    raise ValueError("SCREEN_CHANGED")
                field = ui(packageName=scope["packageName"], className=target[1], focused=True)
                if field.count != 1:
                    raise ValueError("FOCUSED_FIELD_AMBIGUOUS")
                field.clear_text(timeout=5)
            await asyncio.to_thread(clear_protected_field)
            cleared = await driver.get_screen_data()
            if (await driver.get_current_package() != scope["packageName"]
                    or password_target(cleared.ui_hierarchy_xml or "", scope["packageName"]) != target):
                raise ValueError("SCREEN_CHANGED_OR_FIELD_NOT_EMPTY")
            account_labels = account_screen_labels(cleared.ui_hierarchy_xml or "", scope["packageName"])
            stage = "ASSISTANCE_REQUEST_FAILED"
            png = await asyncio.to_thread(adb, ["exec-out", "screencap", "-p"])
            created = await asyncio.to_thread(request, "challenge", {
                "traceId": Path(ctx.data_engine.base_dir).name, "kind": kind, "screenshot": base64.b64encode(png).decode()})
            challenge_id = created["id"]
            stage = "ASSISTANCE_WAIT_FAILED"
            deadline = time.monotonic() + 300
            while time.monotonic() < deadline:
                response = await asyncio.to_thread(request, "claim", {"id": challenge_id})
                if response["status"] == "claimed":
                    secret = response.pop("password", None)
                    if not secret:
                        raise ValueError("INPUT_ALREADY_CLAIMED")
                    try:
                        stage = "SCREEN_CHANGED"
                        current = await driver.get_screen_data()
                        if (await driver.get_current_package() != scope["packageName"]
                                or password_target(current.ui_hierarchy_xml or "", scope["packageName"]) != target
                                or account_screen_labels(current.ui_hierarchy_xml or "", scope["packageName"]) != account_labels):
                            await asyncio.to_thread(request, "finish", {"id": challenge_id, "resultCode": "SCREEN_CHANGED"})
                            return "HUMAN_INPUT_BLOCKED: SCREEN_CHANGED"
                        if not all(32 <= ord(c) <= 126 for c in secret) or not 1 <= len(secret) <= 128:
                            raise ValueError("INPUT_FORMAT_UNSUPPORTED")
                        # No clipboard, driver.input_text, log, shell argv or LLM ever sees secret.
                        stage = "SECURE_INPUT_FAILED"
                        # Disable Android's transient last-character reveal before input; restore after.
                        show = (await asyncio.to_thread(adb, ["shell", "settings", "get", "system", "show_password"])).decode().strip()
                        await asyncio.to_thread(adb, ["shell", "settings", "put", "system", "show_password", "0"])
                        try:
                            masked = (await asyncio.to_thread(adb, ["shell", "settings", "get", "system", "show_password"])).decode().strip()
                            if masked != "0":
                                raise ValueError("PASSWORD_MASKING_REQUIRED")
                            # Per-character quoting handles literal %s, spaces and shell metacharacters.
                            script = "\n".join("input text " + shlex.quote("%s" if c == " " else c) + " || exit 1" for c in secret)
                            await asyncio.to_thread(adb, ["shell", "sh"], script.encode())
                            script = ""
                            await asyncio.sleep(1.5)
                            verification = await driver.get_screen_data()
                            verify_masked_input(verification.ui_hierarchy_xml or "", scope["packageName"], target, len(secret))
                        finally:
                            args = ["shell", "settings", "delete", "system", "show_password"] if show == "null" else ["shell", "settings", "put", "system", "show_password", show if show in ("0", "1") else "0"]
                            await asyncio.to_thread(adb, args)
                        await asyncio.to_thread(request, "finish", {"id": challenge_id, "resultCode": "INPUT_COMPLETED"})
                        return "INPUT_COMPLETED: operator input filled once. Not proof of login. Observe masked field then submit Log in ONCE. On rejection stop; do not retry or request another password. Content submission remains governed by the original task authorization."
                    finally:
                        secret = None
                if response["status"] != "waiting":
                    return "HUMAN_INPUT_BLOCKED: " + response["status"].upper()
                await asyncio.sleep(1)
            raise ValueError("EXPIRED")
        except Exception:
            # Never return exception repr: HTTP/device libraries may include request data.
            try:
                await asyncio.to_thread(request, "stop", {"reason": stage})
            except Exception:
                pass
            if challenge_id:
                try:
                    await asyncio.to_thread(request, "finish", {"id": challenge_id, "resultCode": "INPUT_FAILED"})
                except Exception:
                    pass
            return "HUMAN_INPUT_BLOCKED: " + stage + ". Stop; do not retry or use another tool for passwords."

    if kind == "otp":
        return StructuredTool.from_function(name="human_otp_input", coroutine=human_password_input,
            description="Request ONE OTP through Web in THIS task. Only an EMPTY focused native MASKED/protected code field is supported; for unmasked or segmented fields request manual human assistance instead. Never read a code aloud or put it in tool arguments. Tool securely fills only; after completion submit verification at most once. Never request SMS/email automatically. On any failure STOP; all device actions are frozen.")
    return StructuredTool.from_function(coroutine=human_password_input)
