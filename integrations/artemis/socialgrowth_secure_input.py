"""Artemis tool adapter for one-shot, host-authorized credential field entry.

The model may select only `login` or `password`; it never supplies account IDs,
values, action IDs, device paths, grants, or secrets. The host bridge owns all
scope and authorization. Missing access or any uncertain response fails closed.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import re
import socket
import stat
import struct
from typing import Literal

VERSION = "2026-10-05.media-secure-input-v1"
FieldRef = Literal["login", "password"]


class SecureInputUnavailable(BaseException):
    """Stop Artemis fallback handlers so no normal input path is attempted."""

    def __init__(self) -> None:
        super().__init__("SOCIALGROWTH_SECURE_INPUT_UNAVAILABLE")


@dataclass(frozen=True, repr=False)
class SecureInputAccess:
    socket_path: str
    token: str = field(repr=False)
    scope_digest: str


class SecureInputBridge:
    def __init__(self, access: SecureInputAccess) -> None:
        self._access = access
        self._check_path()
        f = Path(access.socket_path).lstat()
        self._socket_identity = (f.st_dev, f.st_ino)

    def _check_path(self) -> None:
        try:
            a = self._access
            path = Path(a.socket_path)
            parent, f = path.parent, path.lstat()
            # Reject symlinked or group/world-writable ancestors. A private leaf
            # directory alone does not prevent replacement through a writable
            # parent between validation and connect().
            ancestors = [*reversed(parent.parents), parent]
            for ancestor in ancestors:
                info = ancestor.lstat()
                if (stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode)
                        or info.st_uid not in (0, os.getuid()) or info.st_mode & 0o022):
                    raise SecureInputUnavailable()
            if (not path.is_absolute() or str(parent.resolve()) != str(parent)
                or parent.stat().st_uid != os.getuid() or parent.stat().st_mode & 0o077
                    or not stat.S_ISSOCK(f.st_mode) or f.st_uid != os.getuid() or f.st_mode & 0o077
                    or (hasattr(self, "_socket_identity") and self._socket_identity != (f.st_dev, f.st_ino))
                    or len(a.token) != 64 or len(a.scope_digest) != 64
                    or any(c not in "0123456789abcdef" for c in a.token + a.scope_digest)):
                raise SecureInputUnavailable()
        except Exception:
            raise SecureInputUnavailable() from None

    @staticmethod
    def _verify_connected_peer(connection: socket.socket) -> None:
        """Require same-UID server authentication before disclosing the capability.

        Platforms without a supported peer-credential API fail closed. In
        particular this does not treat a socket pathname, token, or UID-only
        socket ownership as proof of the connected server process.
        """
        try:
            if hasattr(connection, "getpeereid"):
                peer_uid, _peer_gid = connection.getpeereid()  # type: ignore[attr-defined]
            elif hasattr(socket, "SO_PEERCRED"):
                credentials = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
                _pid, peer_uid, _peer_gid = struct.unpack("3i", credentials)
            else:
                raise SecureInputUnavailable()
            if peer_uid != os.getuid():
                raise SecureInputUnavailable()
        except Exception:
            raise SecureInputUnavailable() from None

    def request(self, field_ref: FieldRef | None = None, *, submit_login: bool = False,
                target_view_id_resource_name: str | None = None) -> str:
        """Request one field action. No retry after timeout, malformed ACK, or loss."""
        self._check_path()
        if (submit_login and (field_ref is not None or not isinstance(target_view_id_resource_name, str)
                              or len(target_view_id_resource_name) > 256
                              or not re.fullmatch(r"[A-Za-z0-9_.]+:id/[A-Za-z0-9_]+", target_view_id_resource_name))
                or not submit_login and (field_ref not in ("login", "password") or target_view_id_resource_name is not None)):
            raise SecureInputUnavailable()
        try:
            a = self._access
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
                connection.settimeout(35)
                connection.connect(a.socket_path)
                self._verify_connected_peer(connection)
                body = {"version": VERSION, "scopeDigest": a.scope_digest,
                        "token": a.token, "action": "submit_login" if submit_login else "write_input"}
                if field_ref is not None:
                    body["fieldRef"] = field_ref
                if target_view_id_resource_name is not None:
                    body["targetViewIdResourceName"] = target_view_id_resource_name
                connection.sendall(json.dumps(body, separators=(",", ":")).encode("utf-8") + b"\n")
                response = bytearray()
                while not response.endswith(b"\n"):
                    part = connection.recv(1)
                    if not part or len(response) >= 256:
                        raise SecureInputUnavailable()
                    response.extend(part)
                if connection.recv(1):
                    raise SecureInputUnavailable()
                parsed = json.loads(response)
                if (not isinstance(parsed, dict) or set(parsed) != {"version", "status"}
                        or parsed["version"] != VERSION
                        or parsed["status"] not in ("completed", "human_required", "blocked")):
                    raise SecureInputUnavailable()
                return {
                    "completed": "Secure action completed. The observation quarantine remains active; do not inspect the app or request another action.",
                    "human_required": "Secure input is unavailable; stop and ask for human assistance.",
                    "blocked": "Secure input was blocked; stop this operation.",
                }[parsed["status"]]
        except Exception:
            raise SecureInputUnavailable() from None


def get_secure_input_tool(access: SecureInputAccess | None):
    """Build a StructuredTool only from host-injected, task-scoped IPC access."""
    if access is None:
        return None
    try:
        from langchain_core.tools import StructuredTool
    except Exception:
        return None
    bridge = SecureInputBridge(access)

    async def secure_media_account_input(field_ref: FieldRef) -> str:
        """Fill the currently focused, verified field of the assigned existing account.

        Choose `login` or `password` only after Artemis observes the exact authorized
        app and the corresponding empty field. This tool does not submit the form,
        change accounts, register an account, or verify login success. On rejection
        or uncertainty, stop and ask for human assistance; never retry this field.
        """
        return bridge.request(field_ref)

    return StructuredTool.from_function(
        coroutine=secure_media_account_input,
        name="socialgrowth_secure_media_account_input",
        description="One-shot, scope-authorized input into the currently focused login or password field; returns no credential material.",
    )


def get_submit_login_tool(access: SecureInputAccess | None):
    """Build the separate, one-shot login-submit action tool; no generic click."""
    if access is None:
        return None
    try:
        from langchain_core.tools import StructuredTool
    except Exception:
        return None
    bridge = SecureInputBridge(access)

    async def submit_existing_login(target_view_id_resource_name: str) -> str:
        """Submit the exact authorized existing-account login form once.

        Artemis supplies the exact observed resource ID from the authorized
        pre-entry screen. The device validates one supported login
        button for that resource ID; this is never a generic click. If the post-submit
        screen cannot be proven safe, observation remains blocked for a human.
        """
        return bridge.request(submit_login=True, target_view_id_resource_name=target_view_id_resource_name)

    return StructuredTool.from_function(
        coroutine=submit_existing_login,
        name="socialgrowth_submit_existing_login",
        description="One-shot submit of the Artemis-selected login resource ID; the device independently checks its unique login-button semantics.",
    )
