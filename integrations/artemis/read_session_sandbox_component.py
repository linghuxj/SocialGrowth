"""Kernel-policy component probes only; no real phone/server/model calls.

Uses libc directly BEFORE Python SDK guards. The test supplies only loopback
listeners/private marker paths; successful forbidden access fails the check.
"""
import asyncio
import ctypes
import errno
import json
import os
import socket
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from socialgrowth_read_session import open_context


async def run():
    raw = json.loads(sys.stdin.readline())
    libc = ctypes.CDLL(None, use_errno=True)
    denied = []
    # Native socket bypasses the Python audit/SDK patches entirely.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        address = bytes([16, socket.AF_INET]) + int(raw["port"]).to_bytes(2, "big") + socket.inet_aton("127.0.0.1") + bytes(8)
        if libc.connect(s.fileno(), address, len(address)) != -1 or ctypes.get_errno() != errno.EPERM:
            raise AssertionError("kernel allowed IP connection")
        denied.append("native_ip_connect")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
        encoded = raw["otherSocket"].encode()
        address = bytes([len(encoded) + 3, socket.AF_UNIX]) + encoded + b"\0"
        if libc.connect(s.fileno(), address, len(address)) != -1 or ctypes.get_errno() != errno.EPERM:
            raise AssertionError("kernel allowed other Unix endpoint")
        denied.append("other_unix_endpoint")
    fd = libc.open(raw["writeMarker"].encode(), os.O_CREAT | os.O_WRONLY, 0o600)
    if fd != -1 or ctypes.get_errno() != errno.EPERM:
        if fd >= 0:
            os.close(fd)
        raise AssertionError("kernel allowed file write")
    denied.append("native_file_write")
    pid = libc.fork()
    if pid == 0:
        os._exit(3)
    if pid != -1 or ctypes.get_errno() != errno.EPERM:
        if pid > 0:
            os.waitpid(pid, 0)
        raise AssertionError("kernel allowed fork")
    denied.append("native_fork")
    ctx, driver, _operator = open_context(raw["access"], raw["sdkRoot"])
    async with ctx:
        screen = await driver.get_screen_data()
        await driver.disconnect()
    return {"kernelDenied": denied, "nativeScreen": [screen.width, screen.height],
            "onlyOriginalUnixEndpointAllowed": True, "allPathsFenced": False, "modelCalls": 0}


if __name__ == "__main__":
    try:
        print(json.dumps(asyncio.run(run()), separators=(",", ":")))
    except BaseException as error:
        # Only diagnostic class/reason from explicit synthetic probes; no access
        # fields or raw SDK traceback. Preserve real policy failure honestly.
        print(type(error).__name__ + (": " + str(error) if isinstance(error, AssertionError) else ""), file=sys.stderr)
        raise SystemExit(2) from None
