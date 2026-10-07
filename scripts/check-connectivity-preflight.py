"""Read-only prerequisites; never counts as Web or device business acceptance."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import shutil
import socket
import subprocess
from pathlib import Path


def run(args: list[str]) -> tuple[int, str]:
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=20)
        return result.returncode, result.stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return -1, ""


def listening(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=2):
            return True
    except OSError:
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adb", default=shutil.which("adb") or str(Path.home() / "Library/Android/sdk/platform-tools/adb"))
    parser.add_argument("--tailscale", default="/Applications/Tailscale.app/Contents/MacOS/Tailscale")
    parser.add_argument("--web-port", type=int, default=3000)
    parser.add_argument("--runtime-port", type=int, default=4318)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    checks: list[dict[str, object]] = []

    def record(name: str, status: str, **evidence: object) -> None:
        checks.append({"name": name, "status": status, "evidence": evidence})

    code, output = run([args.adb, "devices", "-l"])
    rows = [line.split() for line in output.splitlines() if line.strip() and not line.startswith("List of devices")]
    devices = [row for row in rows if len(row) >= 2 and row[1] == "device"]
    record("adb_inventory", "passed" if code == 0 and devices else "blocked", querySucceeded=code == 0, onlineCount=len(devices), usbCount=sum(any(item.startswith("usb:") for item in row) for row in devices))
    # Never choose an arbitrary phone when several transports/devices are present.
    if len(devices) == 1:
        serial = devices[0][0]
        prefix = [args.adb, "-s", serial, "shell"]
        for prop in ["ro.product.model", "ro.build.version.release", "ro.build.version.sdk"]:
            code, value = run(prefix + ["getprop", prop])
            record(prop, "passed" if code == 0 and value else "blocked", value=value if code == 0 else None)
        code, value = run(prefix + ["settings", "get", "global", "adb_wifi_enabled"])
        record("wireless_debugging", "passed" if code == 0 and value == "1" else "blocked", enabled=value == "1", querySucceeded=code == 0)
        code, value = run(prefix + ["pm", "list", "packages", "com.tailscale.ipn"])
        present = "package:com.tailscale.ipn" in value.splitlines()
        record("phone_tailscale_package", "passed" if code == 0 and present else "blocked", present=present, querySucceeded=code == 0, scope="queried Android user only")
    else:
        record("phone_selection", "blocked", reason="requires exactly one online transport for this preflight")
    code, value = run([args.adb, "mdns", "services"])
    services = [line for line in value.splitlines() if "_adb-tls-" in line]
    record("mdns_observation", "unverified", querySucceeded=code == 0, discoveredServiceCount=len(services), scope="discovery only; not proof of a Tailscale route")
    code, value = run([args.tailscale, "status", "--json"])
    try:
        state = json.loads(value) if code == 0 else {}
        if not isinstance(state, dict):
            state = {}
    except json.JSONDecodeError:
        state = {}
    own = state.get("Self") or {}
    backend = state.get("BackendState")
    ready = backend == "Running" and bool(own.get("Online")) and bool(own.get("TailscaleIPs"))
    record("center_tailscale", "passed" if ready else "blocked", backendState=backend, selfOnline=bool(own.get("Online")), hasAddress=bool(own.get("TailscaleIPs")), scope="local state only; peer identity and access policy unverified")
    peers = list((state.get("Peer") or {}).values())
    android = [peer for peer in peers if str(peer.get("OS", "")).lower() == "android"]
    record("android_peer_visibility", "unverified" if android else "blocked", visibleAndroidCount=len(android), onlineAndroidCount=sum(bool(peer.get("Online")) for peer in android), scope="visible network map only; cannot prove target phone identity or tailnet membership")
    for name, port in [("web_tcp", args.web_port), ("runtime_tcp", args.runtime_port)]:
        connected = listening(port)
        record(name, "passed" if connected else "blocked", port=port, listening=connected, scope="TCP only; service identity and business health unverified")
    blocked = any(check["status"] == "blocked" for check in checks)
    report = {"checkedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "scope": "read-only connectivity prerequisites", "status": "blocked" if blocked else "prerequisites_present", "checks": checks, "businessAcceptance": "unverified", "sameWifiTailscaleRoute": "unverified", "independentNetworkRoute": "unverified"}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 2 if blocked else 0


if __name__ == "__main__":
    raise SystemExit(main())
