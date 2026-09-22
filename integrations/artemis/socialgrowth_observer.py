"""SocialGrowth step observer. Captures per-action screenshots and notifies Runtime."""
import io
import json
import os
import urllib.parse
import urllib.request
from typing import Any
import subprocess

from artemis.drivers.factory import get_driver

_step_count = 0
_current_session_id = f"sess_{int(__import__('time').time())}"

ACTION_DESCRIPTIONS = {
    "input_text": "正在输入文本内容",
    "click": "正在点击屏幕目标",
    "swipe": "正在滑动屏幕",
    "press_key": "正在执行物理/虚拟按键",
    "observe_screen": "正在观察当前屏幕与身份",
    "take_screenshot": "正在截取设备屏幕",
    "human_password_input": "等待人工协助输入密码",
    "manage_app": "正在管理应用状态",
}


def get_runtime_config() -> dict[str, str] | None:
    url = os.environ.get("SG_RUNTIME_URL", "http://127.0.0.1:4318").rstrip("/")
    token = os.environ.get("SG_ASSISTANCE_TOKEN") or os.environ.get("SG_AGENT_TOKEN")
    device_id = os.environ.get("SG_DEVICE_ID", "phone01")
    worker_id = os.environ.get("SG_WORKER_ID", "worker01")

    if not token:
        return None

    return {
        "url": url,
        "token": token,
        "device_id": device_id,
        "worker_id": worker_id,
    }


def capture_screenshot(device_serial: str | None = None) -> bytes | None:
    """Capture raw PNG screenshot from driver or ADB fallback."""
    try:
        driver = get_driver()
        if hasattr(driver, "screenshot"):
            data = driver.screenshot()
            if isinstance(data, bytes) and len(data) > 0:
                return data
            elif isinstance(data, str) and len(data) > 0:
                import base64
                return base64.b64decode(data)
    except Exception:
        pass

    # Fallback to direct ADB screencap
    serial = device_serial or os.environ.get("SG_DEVICE_SERIAL") or os.environ.get("SG_DEVICE_ID")
    if serial and not serial.startswith("emulator-"):
        try:
            res = subprocess.run(
                ["adb", "-s", serial, "exec-out", "screencap", "-p"],
                capture_output=True,
                timeout=10,
            )
            if res.returncode == 0 and len(res.stdout) > 0:
                return res.stdout
        except Exception:
            pass

    return None


async def notify_step(ctx: Any, action_name: str, args: dict[str, Any], result: Any = None) -> None:
    global _step_count, _current_session_id
    config = get_runtime_config()
    if not config:
        return

    _step_count += 1
    action_desc = ACTION_DESCRIPTIONS.get(action_name, f"执行动作: {action_name}")
    if action_name == "input_text" and "text" in args:
        # Mask password input or truncate long text for safe display
        text_preview = str(args.get("text", ""))[:20]
        action_desc = f"输入文本: {text_preview}..."

    # Capture screenshot
    serial = os.environ.get("SG_DEVICE_SERIAL") or config.get("device_id")
    screenshot_bytes = capture_screenshot(serial)
    if not screenshot_bytes:
        return

    req_url = f"{config['url']}/api/runtime/devices/screenshot-step"
    headers = {
        "Authorization": f"Bearer {config['token']}",
        "Content-Type": "image/png",
        "x-worker-id": config["worker_id"],
        "x-device-id": config["device_id"],
        "x-serial": serial or config["device_id"],
        "x-session-id": _current_session_id,
        "x-step": str(_step_count),
        "x-action": action_name,
        "x-action-desc": urllib.parse.quote(action_desc),
        "x-type": "post",
        "x-status": "running",
    }

    try:
        req = urllib.request.Request(req_url, data=screenshot_bytes, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=10) as response:
            pass
    except Exception:
        # Non-blocking: failure to upload monitoring frame shouldn't fail execution
        pass
