"""Single read-only SDK context in a host-sandboxed child, not Agent.init/run_task.

No model, graph, daemon, publication or device readiness assertion. The parent
owns the original launch receipt; private access is received on stdin only.
"""
from __future__ import annotations
import asyncio
import hashlib
import importlib
import json
from pathlib import Path
import sys
from uuid import UUID

VERSION = "2026-10-02.read-session-v1"


def canonical_id(value: object) -> str:
    if not isinstance(value, str) or str(UUID(value)) != value:
        raise ValueError("invalid original id")
    return value


def frame() -> dict:
    raw = sys.stdin.buffer.readline(2049)
    if not raw or len(raw) > 2048 or not raw.endswith(b"\n"):
        raise ValueError("private frame unavailable")
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("private frame invalid")
    return value


def open_context(access: dict, sdk_root: str):
    # -I excludes ambient PYTHONPATH/site user; these two host-pinned locations
    # are the only added imports. Never copy over the existing SDK checkout.
    sys.path[:0] = [str(Path(__file__).resolve().parent), sdk_root]
    for name in ("read_screen", "read_only_driver", "supervision", "human_input", "observer"):
        module = importlib.import_module("socialgrowth_" + name)
        sys.modules["artemis.tools.socialgrowth_" + name] = module
    from socialgrowth_read_screen import ReadScreenAccess, ReadScreenBridge
    from socialgrowth_read_only_driver import bind_read_only_context
    from artemis.context import ArtemisContext, DeviceContext
    bridge = ReadScreenBridge(ReadScreenAccess(**access))
    # Explicit zero dimensions until an actual fenced screen is returned.
    ctx = ArtemisContext(device=DeviceContext(device_id=bridge.serial, device_width=0, device_height=0))
    driver = bind_read_only_context(ctx, bridge)
    # SDK package imports may eagerly load its Operator/Agent classes. Construct
    # the actual Pro operator only after binding; never call Agent.init/run_task.
    from artemis.agents.operator.operator import OperatorNode
    from artemis.config.agent import MemoryTranscriptConfig
    operator = OperatorNode(ctx, transcript_config=MemoryTranscriptConfig())
    if operator.ctx is not ctx:
        raise ValueError("SDK context mismatch")
    return ctx, driver, operator


def emit(base: dict, **fields: object) -> None:
    print(json.dumps({**base, **fields}, separators=(",", ":")), flush=True)


async def run(sdk_root: str) -> None:
    message = frame()
    if set(message) != {"version", "launchId", "access"} or message["version"] != VERSION:
        raise ValueError("startup identity invalid")
    launch_id = canonical_id(message["launchId"])
    ctx, driver, _operator = open_context(message["access"], sdk_root)
    base = {"version": VERSION, "launchId": launch_id, "scopeDigest": message["access"]["scope_digest"]}
    async with ctx:
        emit(base, type="ready")  # Means SDK binding only; never task success.
        while True:
            command = frame()
            if command.get("version") != VERSION or command.get("launchId") != launch_id:
                raise ValueError("control identity invalid")
            if command.get("type") == "close" and set(command) == {"version", "launchId", "type"}:
                await driver.disconnect()
                emit(base, type="closed")
                return
            if command.get("type") != "observe" or set(command) != {"version", "launchId", "type", "requestId"}:
                raise ValueError("unsupported control")
            request_id = canonical_id(command["requestId"])
            # One original read, no automatic retries; UUID crosses the durable
            # host ledger. No app/login/page/channel decision is scripted here.
            screen = await driver.get_screen_data(request_id=request_id)
            ctx.device.device_width, ctx.device.device_height = screen.width, screen.height
            emit(base, type="observed", requestId=request_id, width=screen.width, height=screen.height,
                 sha256=hashlib.sha256(screen.screenshot_bytes).hexdigest())


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2:
            raise ValueError("SDK location required")
        asyncio.run(run(sys.argv[1]))
    except BaseException:
        # Never serialize an input, capability, private config or SDK traceback.
        sys.stderr.write("READ_SESSION_UNCONFIRMED\n")
        raise SystemExit(2) from None
