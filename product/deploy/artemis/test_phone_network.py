"""Focused guard checks against the patched SDK source; no simulated acceptance."""
import argparse
import ast
import asyncio
from pathlib import Path
import re
import types
import unittest
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, required=True)
args = parser.parse_args()
tree = ast.parse(args.source.read_text())
selected = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in {'guard_action', 'action_category', 'filter_tools'}]
namespace = {'asyncio': asyncio, 're': re, 'ET': ET, 'enabled': lambda: True, 'READ_ACTIONS': {'get_screen_data'},
             'SAFE_TOOLS': {'prepare_phone_environment', 'check_phone_network', 'read_note'}}
exec(compile(ast.Module(body=selected, type_ignores=[]), str(args.source), 'exec'), namespace)

class PhoneNetworkGuard(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.calls = []
        self.fail_proxy = False
        self.package = 'io.nekohasekai.sfa'
        self.xml = '<hierarchy><node text="Start" bounds="[0,0][1080,2400]"/></hierarchy>'
        self.scope = {'serial': 'fixture', 'packageName': 'com.socialgrowth.product', 'mode': 'diagnostic',
                      'control': {'state': 'active', 'policy': {'mode': 'connectivity_test', 'allowPhoneInitialization': True}}}
        def request(path: str, data=None, timeout=10):
            self.calls.append((path, data))
            if path == 'session': return self.scope
            if path == 'phone-network-ready' and self.fail_proxy: raise RuntimeError('PHONE_LOCAL_PROXY_NOT_READY')
            return {'ready': True}
        async def package(): return self.package
        async def screen(): return types.SimpleNamespace(ui_hierarchy_xml=self.xml, width=1080, height=2400)
        driver = types.SimpleNamespace(device_id='fixture', get_current_package=package, get_screen_data=screen)
        namespace.update(request=request, get_driver=lambda _ctx: driver)

    async def test_sfa_action_checks_proxy_before_gate(self) -> None:
        await namespace['guard_action'](None, 'click', {'target': [500, 500]})
        self.assertEqual([path for path, _ in self.calls], ['session', 'phone-network-ready', 'gate'])
        self.assertEqual(self.calls[1][1], {'stage': 'proxy'})

    async def test_dead_proxy_prevents_device_dispatch(self) -> None:
        self.fail_proxy = True
        with self.assertRaisesRegex(RuntimeError, 'PHONE_LOCAL_PROXY_NOT_READY'):
            await namespace['guard_action'](None, 'click', {'target': [500, 500]})
        self.assertFalse(any(path == 'gate' for path, _ in self.calls))

    async def test_leaving_sfa_and_reading_remain_available(self) -> None:
        self.fail_proxy = True
        await namespace['guard_action'](None, 'press_key', {'key': 'home'})
        await namespace['guard_action'](None, 'get_screen_data', {})
        self.assertFalse(any(path == 'phone-network-ready' for path, _ in self.calls))

    async def test_other_diagnostics_do_not_gain_phone_check(self) -> None:
        self.scope['control']['policy']['allowPhoneInitialization'] = False
        self.package = 'com.socialgrowth.product'
        await namespace['guard_action'](None, 'click', {'target': [500, 500]})
        tools = [types.SimpleNamespace(name=n) for n in ['check_phone_network', 'prepare_phone_environment', 'read_note']]
        self.assertEqual([t.name for t in namespace['filter_tools'](tools, set())], ['read_note'])
        self.assertFalse(any(path == 'phone-network-ready' for path, _ in self.calls))

    async def test_owner_vpn_consent_still_blocks(self) -> None:
        self.xml = '<hierarchy><node text="VPN connection request" bounds="[0,0][1080,2400]"/></hierarchy>'
        with self.assertRaisesRegex(RuntimeError, 'SOCIALGROWTH_OWNER_VPN_CONSENT_REQUIRED'):
            await namespace['guard_action'](None, 'click', {'target': [500, 500]})
        self.assertFalse(any(path == 'gate' for path, _ in self.calls))

    async def test_json_editor_and_exports_remain_unmanaged(self) -> None:
        for label in ['JSON Editor', 'JSON Viewer', 'Delete', 'Export', 'Share']:
            xml = f'<hierarchy><node text="{label}" bounds="[0,0][1080,2400]"/></hierarchy>'
            self.assertEqual(namespace['action_category']('click', {'target': [500, 500]}, xml, 1080, 2400, True), 'unmanaged')

unittest.main(argv=['test_phone_network'])
