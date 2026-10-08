"""Focused guard regression, no device or business result simulation."""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "integrations/google-artemis"))
from artemis.tools import socialgrowth_supervision as guard


class ConnectivityHomeGuard(unittest.IsolatedAsyncioTestCase):
    async def invoke(self, name="press_key", args=None, mode="connectivity_test",
                     state="active", package="com.socialgrowth.product", ready=False,
                     serial="verified-remote", initialization=False, foreground="com.google.android.youtube", xml="<hierarchy/>"):
        scope = {"serial": "verified-remote", "packageName": package,
                 "mode": "diagnostic", "control": {"state": state,
                 "credentialReady": ready, "policy": {"mode": mode, "allowPhoneInitialization": initialization}}}
        calls = []

        def request(path, data=None):
            calls.append((path, data))
            return scope if path == "session" else {"allowed": True}

        async def current_package():
            return foreground

        async def screen():
            return SimpleNamespace(ui_hierarchy_xml=xml, width=1080, height=2400)

        driver = SimpleNamespace(device_id=serial, get_current_package=current_package, get_screen_data=screen)
        with patch.object(guard, "enabled", return_value=True), \
             patch.object(guard, "request", side_effect=request), \
             patch.object(guard, "get_driver", return_value=driver):
            await guard.guard_action(None, name, args or {"key": "KEYCODE_HOME"})
        return calls

    async def test_home_leaves_foreign_app_without_reading_or_interacting_with_it(self):
        for key in ["HOME", "KEYCODE_HOME", "3"]:
            calls = await self.invoke(args={"key": key})
            self.assertEqual(calls[-1], ("gate", {"action": "press_key", "category": "navigate"}))

    async def test_other_actions_and_scopes_keep_existing_restrictions(self):
        for options in [{"name": "click", "args": {"target": [1, 1]}},
                        {"args": {"key": "BACK"}}, {"mode": "client_test"},
                        {"package": "com.facebook.katana"}]:
            with self.assertRaisesRegex(RuntimeError, "SOCIALGROWTH_APP_MISMATCH"):
                await self.invoke(**options)
        for options, code in [({"state": "stopped"}, "DEVICE_ACTIONS_FROZEN"),
                              ({"serial": "wrong"}, "DEVICE_MISMATCH"),
                              ({"ready": True}, "PROTECTED_INPUT_PENDING")]:
            with self.assertRaisesRegex(RuntimeError, code):
                await self.invoke(**options)

    async def test_initialization_is_an_explicit_native_capability(self):
        for pkg in ["io.nekohasekai.sfa", "com.follow.clash", "com.android.documentsui", "com.google.android.youtube"]:
            with self.assertRaisesRegex(RuntimeError, "SOCIALGROWTH_APP_MISMATCH"):
                await self.invoke(name="click", args={"target": [100, 100]}, foreground=pkg)
            calls = await self.invoke(name="click", args={"target": [100, 100]}, foreground=pkg, initialization=True)
            self.assertEqual(calls[-1][0], "gate")
        with self.assertRaisesRegex(RuntimeError, "SOCIALGROWTH_APP_MISMATCH"):
            await self.invoke(name="click", args={"target": [100, 100]}, foreground="com.example.other", initialization=True)

    async def test_owner_vpn_consent_is_never_automatically_accepted(self):
        with self.assertRaisesRegex(RuntimeError, "OWNER_VPN_CONSENT_REQUIRED"):
            await self.invoke(name="click", args={"target": [100, 100]}, foreground="com.android.systemui", initialization=True,
                              xml='<hierarchy><node text="VPN Connection request"/></hierarchy>')

    async def test_private_configuration_and_destructive_controls_are_unmanaged(self):
        for label in ["编辑配置", "分享", "导出", "复制", "清除数据", "卸载", "reset"]:
            calls = await self.invoke(name="click", args={"target": [100, 100]}, foreground="com.follow.clash", initialization=True,
                                      xml=f'<hierarchy><node text="{label}" bounds="[0,0][1080,2400]"/></hierarchy>')
            self.assertEqual(calls[-1], ("gate", {"action": "click", "category": "unmanaged"}))


if __name__ == "__main__":
    unittest.main()
