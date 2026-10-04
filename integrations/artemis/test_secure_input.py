from __future__ import annotations

import json
import os
from pathlib import Path
import socket
import tempfile
import threading
import unittest

from socialgrowth_secure_input import SecureInputAccess, SecureInputBridge, SecureInputUnavailable, VERSION


class SecureInputBridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        os.chmod(self.temp.name, 0o700)
        self.path = str(Path(self.temp.name).resolve() / "input.sock")
        self.server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.server.bind(self.path)
        os.chmod(self.path, 0o600)
        self.server.listen(4)
        self.access = SecureInputAccess(self.path, "a" * 64, "b" * 64)
        self.requests = []
        self.respond = {"version": VERSION, "status": "completed"}
        self.closed = False
        self.thread = threading.Thread(target=self.serve, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.closed = True
        try:
            self.server.close()
        finally:
            self.temp.cleanup()

    def serve(self):
        self.server.settimeout(0.1)
        while not self.closed:
            try:
                conn, _ = self.server.accept()
            except (OSError, TimeoutError):
                continue
            with conn:
                raw = bytearray()
                while not raw.endswith(b"\n") and len(raw) < 1024:
                    part = conn.recv(1)
                    if not part:
                        break
                    raw.extend(part)
                self.requests.append(json.loads(raw))
                conn.sendall(json.dumps(self.respond, separators=(",", ":")).encode() + b"\n")

    def test_request_contains_only_field_reference_and_scoped_capability(self):
        result = SecureInputBridge(self.access).request("password")
        self.assertIn("completed", result)
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(set(self.requests[0]), {"version", "scopeDigest", "token", "action", "fieldRef"})
        self.assertEqual(self.requests[0]["action"], "write_input")
        self.assertEqual(self.requests[0]["fieldRef"], "password")
        self.assertNotRegex(json.dumps(self.requests[0]), r"loginIdentifier|passwordValue|credentialId|accountId|serial|secret")

    def test_login_and_password_are_the_only_accepted_actions(self):
        bridge = SecureInputBridge(self.access)
        self.assertIn("completed", bridge.request("login"))
        with self.assertRaises(SecureInputUnavailable):
            bridge.request("submit")

    def test_submit_is_separate_scoped_action_without_model_selected_button(self):
        result = SecureInputBridge(self.access).request(submit_login=True, target_view_id_resource_name="com.facebook.katana:id/login")
        self.assertIn("quarantine remains active", result)
        self.assertEqual(self.requests[-1], {"version": VERSION, "scopeDigest": "b" * 64,
                                             "token": "a" * 64, "action": "submit_login",
                                             "targetViewIdResourceName": "com.facebook.katana:id/login"})
        with self.assertRaises(SecureInputUnavailable):
            SecureInputBridge(self.access).request(submit_login=True, target_view_id_resource_name="*")

    def test_malformed_or_uncertain_ack_fails_closed(self):
        self.respond = {"version": VERSION, "status": "completed", "value": "must-not-be-returned"}
        with self.assertRaises(SecureInputUnavailable):
            SecureInputBridge(self.access).request("login")

    def test_absent_bridge_is_not_registered(self):
        from socialgrowth_secure_input import get_secure_input_tool, get_submit_login_tool
        self.assertIsNone(get_secure_input_tool(None))
        self.assertIsNone(get_submit_login_tool(None))


if __name__ == "__main__":
    unittest.main()
