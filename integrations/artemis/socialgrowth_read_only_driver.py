"""Artemis driver for the one authorized read_screen slice; no raw access."""
from __future__ import annotations
import asyncio
import base64
import sys
from typing import NoReturn
from artemis.drivers.base import BaseDeviceDriver, ScreenData

try:
    from artemis.tools.socialgrowth_read_screen import PhysicalPathDenied, ReadScreenBridge
except ModuleNotFoundError:
    from socialgrowth_read_screen import PhysicalPathDenied, ReadScreenBridge

_bound: ReadOnlyArtemisDriver | None = None
_context: object | None = None


def _deny_raw(*args: object, **kwargs: object) -> NoReturn:
    raise PhysicalPathDenied()


def _reject_process_creation(event: str, args: tuple[object, ...]) -> None:
    if event in {"subprocess.Popen", "os.system", "os.exec", "os.posix_spawn", "os.fork", "os.forkpty", "pty.spawn"}:
        raise PhysicalPathDenied()


def _install_raw_rejections() -> None:
    # Process-lifetime known SDK surfaces. This is not an OS sandbox or proof
    # that another host process/native library cannot reach the same phone.
    from adbutils._adb import AdbConnection
    from artemis.drivers.android.adb_driver import AndroidAdbDriver
    from artemis.clients.ui_automator_client import UIAutomatorClient
    from artemis.runtime.adb_endpoint import AdbSession
    guards = ((AdbConnection, "__init__"), (AdbConnection, "send_command"),
              (AndroidAdbDriver, "__init__"), (UIAutomatorClient, "__init__"), (AdbSession, "run"))
    if any(not callable(getattr(owner, name, None)) for owner, name in guards):
        raise PhysicalPathDenied()
    for owner, name in guards:
        setattr(owner, name, _deny_raw)
    sys.addaudithook(_reject_process_creation)


class DeniedRawClient:
    def __getattr__(self, name: str) -> NoReturn:
        raise PhysicalPathDenied()


class ReadOnlyArtemisDriver(BaseDeviceDriver):
    def __init__(self, bridge: ReadScreenBridge) -> None:
        self._bridge = bridge
        self._closed = False
        self._size: tuple[int, int] | None = None

    @property
    def device_id(self) -> str:
        return self._bridge.serial

    @property
    def screen_size(self) -> tuple[int, int]:
        if self._closed or self._size is None:
            raise PhysicalPathDenied()
        return self._size

    async def connect(self) -> None:
        if self._closed:
            raise PhysicalPathDenied()
        # No device call; this is never network/ADB readiness evidence.

    async def disconnect(self) -> None:
        self._closed = True  # Refuses new reads; does not claim phone stop.

    async def get_screen_data(self, skip_settling: bool = False) -> ScreenData:
        if self._closed:
            raise PhysicalPathDenied()
        screen = await asyncio.to_thread(self._bridge.capture)
        if self._closed:
            raise PhysicalPathDenied()
        self._size = (screen.width, screen.height)
        return ScreenData(screenshot_bytes=screen.png, screenshot_base64=base64.b64encode(screen.png).decode("ascii"),
                          width=screen.width, height=screen.height, ui_hierarchy_xml=None, ui_elements=[], platform="android")

    def capture_png(self, serial: str | None = None) -> bytes:
        if self._closed or (serial is not None and serial != self.device_id):
            raise PhysicalPathDenied()
        screen = self._bridge.capture()
        if self._closed:
            raise PhysicalPathDenied()
        self._size = (screen.width, screen.height)
        return screen.png

    async def _deny(self, *args: object, **kwargs: object) -> NoReturn:
        raise PhysicalPathDenied()

    def __getattr__(self, name: str) -> NoReturn:
        raise PhysicalPathDenied()

    tap = long_press = swipe = swipe_direction = input_text = press_key = _deny
    launch_app = stop_app = get_current_package = execute_shell = _deny
    start_video_recording = stop_video_recording = get_ui_hierarchy = _deny


def bound_read_driver(ctx: object | None = None) -> ReadOnlyArtemisDriver | None:
    if _bound is None:
        return None
    if ctx is not None and (ctx is not _context or getattr(ctx, "_active_driver", None) is not _bound
                            or not isinstance(getattr(ctx, "adb_client", None), DeniedRawClient)
                            or not isinstance(getattr(ctx, "ui_adb_client", None), DeniedRawClient)):
        raise PhysicalPathDenied()
    return _bound


def bind_read_only_context(ctx: object, bridge: ReadScreenBridge) -> ReadOnlyArtemisDriver:
    global _bound, _context
    # Fresh dedicated task process only; cannot retrofit an existing owner or
    # silently replace another task, serial, cached raw driver or UI client.
    if (_bound is not None or getattr(ctx, "_active_driver", None) is not None
            or getattr(ctx, "adb_client", None) is not None or getattr(ctx, "ui_adb_client", None) is not None
            or getattr(getattr(ctx, "device", None), "device_id", None) != bridge.serial):
        raise PhysicalPathDenied()
    _install_raw_rejections()
    driver = ReadOnlyArtemisDriver(bridge)
    setattr(ctx, "adb_client", DeniedRawClient())
    setattr(ctx, "ui_adb_client", DeniedRawClient())
    setattr(ctx, "_active_driver", driver)
    _bound, _context = driver, ctx
    return driver
