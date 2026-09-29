"""Install and run one bounded native NSD probe on an explicitly verified device."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import subprocess
import time
from pathlib import Path

PACKAGE = "com.socialgrowth.endpointprobe"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adb", default=str(Path.home() / "Library/Android/sdk/platform-tools/adb"))
    parser.add_argument("--transport", required=True)
    parser.add_argument("--expected-serial", required=True)
    parser.add_argument("--build", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output already exists; use a fresh path to preserve prior evidence")
    prefix = [args.adb, "-s", args.transport]

    def blocked(reason: str) -> int:
        evidence = {"collectedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "status": "blocked",
                    "reason": reason, "scope": "native NSD probe; no successful discovery result"}
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(evidence, indent=2))
        return 2

    def run(arguments: list[str], timeout: int = 15) -> subprocess.CompletedProcess[str]:
        try:
            return subprocess.run(prefix + arguments, capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            return subprocess.CompletedProcess(prefix + arguments, 124, "", "bounded command timeout")

    identity = run(["shell", "getprop", "ro.serialno"])
    if identity.returncode != 0 or identity.stdout.strip() != args.expected_serial:
        return blocked("target identity unavailable or mismatched; no installation attempted")
    receipt = json.loads((args.build / "build.json").read_text())
    apk = args.build / "endpoint-probe.apk"
    if hashlib.sha256(apk.read_bytes()).hexdigest() != receipt["apkSha256"]:
        return blocked("APK hash differs from build receipt; no installation attempted")
    previous = run(["shell", "run-as", PACKAGE, "cat", "files/probe.json"])
    try:
        previous_id = json.loads(previous.stdout).get("scanId") if previous.returncode == 0 else None
    except json.JSONDecodeError:
        previous_id = None
    install = run(["install", "-r", str(apk.resolve())], timeout=60)
    if install.returncode != 0 or "Success" not in install.stdout:
        return blocked("probe installation did not confirm success; not launched; package state may need inspection")
    # Restart only this isolated probe, never Tailscale, system ADB, or any business app.
    launch = run(["shell", "am", "start", "-S", "-W", "-n", PACKAGE + "/.ProbeActivity"])
    if launch.returncode != 0 or "Error:" in launch.stdout or "Error:" in launch.stderr:
        return blocked("probe launch did not confirm success; probe may be installed")
    deadline = time.monotonic() + 35
    report: dict[str, object] | None = None
    while time.monotonic() < deadline:
        result = run(["shell", "run-as", PACKAGE, "cat", "files/probe.json"])
        if result.returncode == 0:
            try:
                candidate = json.loads(result.stdout)
                if candidate.get("scanId") and candidate["scanId"] != previous_id:
                    report = candidate
                    break
            except json.JSONDecodeError:
                pass
        time.sleep(2)
    stopped = run(["shell", "am", "force-stop", PACKAGE])
    process = run(["shell", "pidof", PACKAGE])
    cleanup_confirmed = stopped.returncode == 0 and process.returncode == 1 and not process.stdout.strip()
    evidence = {"collectedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "identityMatched": True,
                "apkSha256": receipt["apkSha256"], "nativeProbe": report,
                "probeProcessStopped": cleanup_confirmed,
                "status": "observed" if report else "blocked_no_fresh_result",
                "scope": "native discovery feasibility only; not Web, onboarding or automatic report acceptance"}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    return 0 if report and report.get("reason") == "window_complete" and cleanup_confirmed else 2


if __name__ == "__main__":
    raise SystemExit(main())
