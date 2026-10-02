"""Private read-only task IPC. No subprocess, ADB, hierarchy or fallback path."""
from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import json
import os
from pathlib import Path
import socket
import stat
import struct
from uuid import UUID, uuid4

VERSION = "2026-10-02.read-screen-v1"


class PhysicalPathDenied(BaseException):
    """Must escape SDK 'except Exception' screenshot/headless fallback handlers.

    This terminates the attempted read/action; it is not proof of device stop.
    """

    def __init__(self) -> None:
        super().__init__("SOCIALGROWTH_PHYSICAL_PATH_DENIED")


@dataclass(frozen=True, repr=False)
class ReadScreenAccess:
    socket_path: str
    token: str = field(repr=False)
    scope_digest: str
    serial: str


@dataclass(frozen=True)
class CapturedScreen:
    png: bytes = field(repr=False)
    width: int
    height: int


class ReadScreenBridge:
    def __init__(self, access: ReadScreenAccess) -> None:
        self._access = access
        self._check_path()
        f = Path(access.socket_path).lstat()
        self._socket_identity = (f.st_dev, f.st_ino)

    @property
    def serial(self) -> str:
        return self._access.serial

    def _check_path(self) -> None:
        try:
            a = self._access
            path = Path(a.socket_path)
            parent, f = path.parent, path.lstat()
            if (not path.is_absolute() or str(parent.resolve()) != str(parent)
                    or parent.stat().st_uid != os.getuid() or parent.stat().st_mode & 0o077
                    or not stat.S_ISSOCK(f.st_mode) or f.st_uid != os.getuid() or f.st_mode & 0o077
                    or (hasattr(self, "_socket_identity") and self._socket_identity != (f.st_dev, f.st_ino))
                    or len(a.token) != 64 or len(a.scope_digest) != 64 or not a.serial
                    or any(c not in "0123456789abcdef" for c in a.token + a.scope_digest)):
                raise PhysicalPathDenied()
        except Exception:
            raise PhysicalPathDenied() from None

    def capture(self, request_id: str | None = None) -> CapturedScreen:
        """One request, no automatic reconnect/retry after unknown or ACK loss."""
        self._check_path()
        try:
            rid = request_id or str(uuid4())
            if str(UUID(rid)) != rid:
                raise PhysicalPathDenied()
            a = self._access
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
                connection.settimeout(30)
                connection.connect(a.socket_path)
                message = {"version": VERSION, "requestId": rid, "scopeDigest": a.scope_digest, "token": a.token}
                connection.sendall(json.dumps(message, separators=(",", ":")).encode() + b"\n")
                header = bytearray()
                while not header.endswith(b"\n"):
                    b = connection.recv(1)
                    if not b or len(header) >= 1024:
                        raise PhysicalPathDenied()
                    header.extend(b)
                response = json.loads(header)
                required = {"version", "requestId", "scopeDigest", "status", "bytes", "width", "height", "sha256"}
                if (not isinstance(response, dict) or set(response) != required or response["version"] != VERSION
                        or response["requestId"] != rid or response["scopeDigest"] != a.scope_digest
                        or response["status"] != "captured" or type(response["bytes"]) is not int
                        or not 33 <= response["bytes"] <= 16 * 1024 * 1024
                        or type(response["width"]) is not int or type(response["height"]) is not int):
                    raise PhysicalPathDenied()
                data = bytearray()
                while len(data) < response["bytes"]:
                    chunk = connection.recv(min(65536, response["bytes"] - len(data)))
                    if not chunk:
                        raise PhysicalPathDenied()
                    data.extend(chunk)
                if connection.recv(1):
                    raise PhysicalPathDenied()
                png = bytes(data)
                if (png[:8] != b"\x89PNG\r\n\x1a\n" or png[12:16] != b"IHDR"
                        or hashlib.sha256(png).hexdigest() != response["sha256"]):
                    raise PhysicalPathDenied()
                width, height = struct.unpack(">II", png[16:24])
                if width <= 1 or height <= 1 or (width, height) != (response["width"], response["height"]):
                    raise PhysicalPathDenied()
                return CapturedScreen(png, width, height)
        except Exception:
            raise PhysicalPathDenied() from None
