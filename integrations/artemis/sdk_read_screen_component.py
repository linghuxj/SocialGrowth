"""Actual SDK classes + real private IPC, with synthetic authority/executable.

Invoked only by the explicit executor component check. Never start Artemis, a
model, adb or a real phone. Private access arrives on stdin; never printed.
"""
from __future__ import annotations
import asyncio
import json
import subprocess
import sys
from types import SimpleNamespace
from typing import Callable

from socialgrowth_read_screen import PhysicalPathDenied, ReadScreenAccess, ReadScreenBridge
from socialgrowth_read_only_driver import bind_read_only_context, bound_read_driver
from socialgrowth_supervision import filter_tools, guard_action, get_supervision_tools
from socialgrowth_human_input import get_human_input_tool
from socialgrowth_observer import capture_screenshot
from artemis.drivers.factory import get_driver, create_driver
from adbutils._adb import AdbConnection
from artemis.clients.ui_automator_client import UIAutomatorClient
from artemis.runtime.adb_endpoint import AdbSession, AdbEndpoint


async def run() -> dict[str, object]:
    raw = json.loads(sys.stdin.readline())
    bridge = ReadScreenBridge(ReadScreenAccess(**raw["access"]))
    ctx = SimpleNamespace(device=SimpleNamespace(device_id=bridge.serial, device_width=2, device_height=2, mobile_platform="android"),
                          adb_client=None, ui_adb_client=None)
    driver = bind_read_only_context(ctx, bridge)
    if get_driver(ctx) is not driver:
        raise AssertionError("factory did not resolve bounded driver")
    screen = await driver.get_screen_data()
    if screen.width != 2 or screen.height != 2 or screen.ui_hierarchy_xml is not None or screen.ui_elements:
        raise AssertionError("synthetic screen scope mismatch")
    if capture_screenshot(bridge.serial) != screen.screenshot_bytes:
        raise AssertionError("observer did not cross same fenced transport")
    await guard_action(ctx, "observe_screen", {})
    if get_supervision_tools(ctx) or get_human_input_tool(ctx) is not None:
        raise AssertionError("read-only context exposed human/credential tools")
    tools = [SimpleNamespace(name=n) for n in ["observe_screen", "take_screenshot", "click", "input_text", "get_ui_hierarchy", "execute_shell", "human_password_input", "ensure_trusted_app"]]
    if [t.name for t in filter_tools(tools, {t.name for t in tools})] != ["observe_screen", "take_screenshot"]:
        raise AssertionError("arbitrary action names expanded scope")
    denied: list[str] = []
    for name in ["tap", "long_press", "swipe", "swipe_direction", "input_text", "press_key", "launch_app", "stop_app", "execute_shell", "get_current_package", "start_video_recording", "stop_video_recording", "get_ui_hierarchy"]:
        try:
            await getattr(driver, name)()
            raise AssertionError("unsupported driver action returned")
        except PhysicalPathDenied:
            denied.append(name)
    for name in ["click", "input_text", "get_ui_hierarchy", "manage_app"]:
        try:
            await guard_action(ctx, name, {})
            raise AssertionError("unsupported dispatch returned")
        except PhysicalPathDenied:
            denied.append("guard:" + name)
    raw_paths: list[tuple[str, Callable[[], object]]] = [
        ("context_adb", lambda: ctx.adb_client.device()), ("context_ui", lambda: ctx.ui_adb_client.get_hierarchy()),
        ("raw_factory", lambda: create_driver(ctx)), ("adb_connection", lambda: AdbConnection("127.0.0.1", 5037)),
        ("ui_constructor", lambda: UIAutomatorClient(bridge.serial)),
        ("adb_session", lambda: AdbSession(AdbEndpoint.local()).run(["shell", "never-executed"])),
        ("subprocess", lambda: subprocess.run(["never-executed-socialgrowth-component"])),
        ("wrong_observer_serial", lambda: capture_screenshot("other")),
        ("second_context", lambda: bind_read_only_context(SimpleNamespace(), bridge)),
    ]
    for name, call in raw_paths:
        try:
            call()
            raise AssertionError("raw path was not refused")
        except PhysicalPathDenied:
            denied.append(name)
    # Denial must bypass broad Exception fallback, not produce a headless PNG.
    try:
        try:
            driver.device
        except Exception:
            raise AssertionError("physical denial entered legacy fallback")
        raise AssertionError("raw device was exposed")
    except PhysicalPathDenied:
        denied.append("no_exception_fallback")
    ctx._active_driver = None
    try:
        bound_read_driver(ctx)
        raise AssertionError("replaced context accepted")
    except PhysicalPathDenied:
        denied.append("context_replaced")
    ctx._active_driver = driver
    await driver.disconnect()
    try:
        await driver.get_screen_data()
        raise AssertionError("closed driver captured")
    except PhysicalPathDenied:
        denied.append("closed_driver")
    return {"nativeScreenData": True, "actualSdkFactoryResolved": True, "observerRouted": True,
            "unsupportedAndRawPathsDenied": denied, "allPathsFenced": False, "modelCalled": False, "deviceOperation": False}


if __name__ == "__main__":
    print(json.dumps(asyncio.run(run()), separators=(",", ":")))
