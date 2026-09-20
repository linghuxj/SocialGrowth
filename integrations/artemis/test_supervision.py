"""No device, credential or network access. Covers actual dispatch gate and bypass filtering."""
import asyncio
import os
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from socialgrowth_supervision import action_category, filter_tools, guard_action


class SupervisionTests(unittest.IsolatedAsyncioTestCase):
    async def test_installed_serial_dispatch_blocks_write_but_keeps_observation(self):
        from artemis.mcp.action_session import ActionSession, _SHUTDOWN
        from unittest.mock import AsyncMock
        transport = SimpleNamespace(call_tool=AsyncMock(return_value="observed"))
        session = ActionSession(None)
        loop = asyncio.get_running_loop()
        blocked, read = loop.create_future(), loop.create_future()
        session._requests.put_nowait((blocked, "click", {"target": [1, 1]}))
        session._requests.put_nowait((read, "observe_screen", {}))
        session._requests.put_nowait(_SHUTDOWN)
        with patch.dict(os.environ, {"SG_ASSISTANCE_TOKEN": "test"}), patch("artemis.tools.socialgrowth_supervision.request", return_value={"control": {"state": "stopped", "policy": {"mode": "preflight"}}}):
            await session._serve(transport)
        with self.assertRaisesRegex(RuntimeError, "FROZEN"):
            await blocked
        self.assertEqual(await read, "observed")
        transport.call_tool.assert_awaited_once_with("observe_screen", {})

    async def test_frozen_and_observation_reject_before_driver_access(self):
        for state, mode in [("waiting", "preflight"), ("revalidate", "preflight"), ("stopped", "preflight"), ("active", "observe")]:
            with patch.dict(os.environ, {"SG_ASSISTANCE_TOKEN": "test"}), patch("socialgrowth_supervision.request", return_value={"control": {"state": state, "policy": {"mode": mode}}}), patch("socialgrowth_supervision.get_driver") as driver:
                with self.assertRaisesRegex(RuntimeError, "FROZEN"):
                    await guard_action(None, "click", {"target": [10, 10]})
                driver.assert_not_called()

    async def test_runtime_unavailable_fails_closed(self):
        with patch.dict(os.environ, {"SG_ASSISTANCE_TOKEN": "test"}), patch("socialgrowth_supervision.request", side_effect=RuntimeError("offline")), patch("socialgrowth_supervision.get_driver") as driver:
            with self.assertRaises(RuntimeError):
                await guard_action(None, "input_text", {"text": "non-secret-test"})
            driver.assert_not_called()

    async def test_filled_password_cannot_be_revealed_by_eye_tap(self):
        from unittest.mock import AsyncMock
        scope = {"serial": "RFC_TEST", "packageName": "com.facebook.katana", "control": {"state": "active", "policy": {"mode": "preflight"}, "credentialReady": True}}
        screen = SimpleNamespace(ui_hierarchy_xml='<hierarchy><node password="true" text="••••"/><node text="Show password" bounds="[0,0][100,100]"/></hierarchy>', width=100, height=100)
        driver = SimpleNamespace(device_id="RFC_TEST", get_current_package=AsyncMock(return_value="com.facebook.katana"), get_screen_data=AsyncMock(return_value=screen))
        with patch.dict(os.environ, {"SG_ASSISTANCE_TOKEN": "test"}), patch("socialgrowth_supervision.request", return_value=scope), patch("socialgrowth_supervision.get_driver", return_value=driver):
            with self.assertRaisesRegex(RuntimeError, "PROTECTED_INPUT_PENDING"):
                await guard_action(None, "click", {"target": [50, 50]})

    def test_unknown_tools_and_shell_cannot_bypass(self):
        with patch.dict(os.environ, {"SG_ASSISTANCE_TOKEN": "test"}):
            names = ["run_adb_command", "manage_task", "ask_explorer", "ask_diagnoser", "python", "read_note", "request_human_assistance", "click"]
            tools = [SimpleNamespace(name=n) for n in names]
            self.assertEqual([t.name for t in filter_tools(tools, {"click"})], ["read_note", "request_human_assistance", "click"])

    def test_sensitive_native_targets_and_direct_password_input(self):
        xml = '<hierarchy><node text="Log in" bounds="[0,0][100,100]"/><node password="true"/></hierarchy>'
        self.assertEqual(action_category("click", {"target": [50, 50]}, xml, 100, 100), "login_submit")
        self.assertEqual(action_category("click", {"target": [50, 50]}, xml.replace("Log in", "Share now"), 100, 100), "publish")
        self.assertEqual(action_category("click", {"target": [50, 50], "times": 2}, xml, 100, 100), "unmanaged")
        self.assertEqual(action_category("input_text", {"text": "test"}, xml), "unmanaged")
        self.assertEqual(action_category("press_key", {"key": "ENTER"}, xml), "unmanaged")
        self.assertEqual(action_category("run_adb_command", {"command": "anything"}), "unmanaged")


if __name__ == "__main__":
    unittest.main()
