"""Negative IPC codec/filesystem component checks; no SDK/model/phone calls."""
from __future__ import annotations
import base64
import hashlib
import json
import os
from pathlib import Path
import socket
import tempfile
import threading
from typing import Callable
import unittest
from uuid import uuid4
from socialgrowth_read_screen import PhysicalPathDenied, ReadScreenAccess, ReadScreenBridge, VERSION

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAC0lEQVR4nGNgQAYAAA4AAamRc7EAAAAASUVORK5CYII=")


class FakeProtocolHost:
    """Synthetic protocol bytes only. Never supplies actual phone permission."""
    def __init__(self, transform: Callable[[dict[str, object]], dict[str, object]] | None = None, payload: bytes = PNG) -> None:
        self.directory = tempfile.TemporaryDirectory(prefix="sg-codec8-")
        self.path = Path(self.directory.name).resolve() / "r.sock"
        self.server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.server.bind(str(self.path)); self.server.listen(1); self.server.settimeout(0.5)
        self.path.chmod(0o600)
        self.access = ReadScreenAccess(str(self.path), "a" * 64, "b" * 64, "SYNTHETIC_NOT_A_DEVICE")
        self.accepted = 0
        def serve() -> None:
            try:
                connection, _ = self.server.accept()
                with connection:
                    self.accepted += 1
                    request = bytearray()
                    while not request.endswith(b"\n"):
                        b = connection.recv(1)
                        if not b: return
                        request.extend(b)
                    value = json.loads(request)
                    header = {"version": VERSION, "requestId": value["requestId"], "scopeDigest": value["scopeDigest"],
                              "status": "captured", "bytes": len(PNG), "width": 2, "height": 2, "sha256": hashlib.sha256(PNG).hexdigest()}
                    if transform: header = transform(header)
                    connection.sendall(json.dumps(header).encode() + b"\n" + payload)
            except (OSError, ValueError):
                pass
        self.thread = threading.Thread(target=serve); self.thread.start()

    def close(self) -> None:
        self.server.close(); self.thread.join(1); self.directory.cleanup()


class ReadScreenNegativeTests(unittest.TestCase):
    def test_wrong_response_identity_protocol_or_scope_has_no_pixels(self) -> None:
        for patch in [{"requestId": str(uuid4())}, {"scopeDigest": "c" * 64}, {"version": "old"}, {"extra": True}, {"bytes": True}]:
            with self.subTest(patch=patch):
                f = FakeProtocolHost(lambda h: {**h, **patch})
                try:
                    with self.assertRaises(PhysicalPathDenied): ReadScreenBridge(f.access).capture()
                    self.assertEqual(f.accepted, 1)
                finally: f.close()

    def test_corrupt_short_trailing_or_wrong_dimension_pixels_refuse(self) -> None:
        for patch, payload in [({"sha256": "0" * 64}, PNG), ({}, PNG[:-1]), ({}, PNG + b"private"), ({"width": 3}, PNG), ({"bytes": 16 * 1024 * 1024 + 1}, PNG)]:
            with self.subTest(patch=patch):
                f = FakeProtocolHost(lambda h: {**h, **patch}, payload)
                try:
                    with self.assertRaises(PhysicalPathDenied): ReadScreenBridge(f.access).capture()
                    self.assertEqual(f.accepted, 1)
                finally: f.close()

    def test_unavailable_does_not_reconnect_or_return_placeholder(self) -> None:
        f = FakeProtocolHost(lambda h: {"version": VERSION, "requestId": h["requestId"], "scopeDigest": h["scopeDigest"], "status": "unavailable", "bytes": 0}, b"")
        try:
            with self.assertRaises(PhysicalPathDenied) as captured: ReadScreenBridge(f.access).capture()
            self.assertEqual(str(captured.exception), "SOCIALGROWTH_PHYSICAL_PATH_DENIED")
            self.assertNotIn(f.access.token, str(captured.exception)); self.assertEqual(f.accepted, 1)
        finally: f.close()

    def test_public_socket_or_parent_rejects_before_any_connect(self) -> None:
        for parent in [False, True]:
            f = FakeProtocolHost()
            try:
                (f.path.parent if parent else f.path).chmod(0o755)
                with self.assertRaises(PhysicalPathDenied): ReadScreenBridge(f.access)
                self.assertEqual(f.accepted, 0)
            finally: f.path.parent.chmod(0o700); f.close()

    def test_bad_request_id_denies_before_connect_and_private_access_has_no_secret_repr(self) -> None:
        f = FakeProtocolHost()
        try:
            bridge = ReadScreenBridge(f.access)
            with self.assertRaises(PhysicalPathDenied): bridge.capture("bad")
            self.assertEqual(f.accepted, 0); self.assertNotIn(f.access.token, repr(f.access))
        finally: f.close()


if __name__ == "__main__":
    unittest.main()
