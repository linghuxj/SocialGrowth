import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import test from "node:test";
import { bridgeFixture } from "./read-screen-bridge-fixture.js";

// Explicit non-UI component check, excluded from root *.test.ts. Uses actual
// local SDK classes with synthetic authority/transport; never calls a model,
// actual adb, phone or platform. Not an alternative to Web Playwright acceptance.
test("actual SDK driver and observer cross private IPC into durable fence; raw and write paths refuse without fallback", async () => {
  const f = await bridgeFixture();
  try {
    const root = resolve("../.."), sdk = resolve(root, "integrations/google-artemis"), overlays = resolve(root, "integrations/artemis");
    const python = spawn(resolve(sdk, ".venv/bin/python"), [resolve(overlays, "sdk_read_screen_component.py")], {
      cwd: root, env: { PATH: "/usr/bin:/bin", PYTHONPATH: `${overlays}:${sdk}`, PYTHONDONTWRITEBYTECODE: "1" }, stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "", stderr = ""; python.stdout.on("data", v => stdout += v); python.stderr.on("data", v => stderr += v);
    const exited = once(python, "exit"); const timer = setTimeout(() => python.kill("SIGKILL"), 25_000);
    python.stdin.end(JSON.stringify({ access: { socket_path: f.access.socketPath, token: f.access.token, scope_digest: f.access.scopeDigest, serial: f.access.serial } }) + "\n");
    const [code] = await exited; clearTimeout(timer);
    assert.equal(code, 0, stderr.replaceAll(f.access.token, "[redacted]"));
    const result = JSON.parse(stdout); assert.equal(result.nativeScreenData, true); assert.equal(result.actualSdkFactoryResolved, true); assert.equal(result.observerRouted, true);
    assert.equal(result.unsupportedAndRawPathsDenied.length, 29); assert.equal(result.allPathsFenced, false); assert.equal(result.modelCalled, false);
    assert.equal(await f.count(), 2); assert.deepEqual(f.outcomes, ["ended", "ended"]);
    console.log(JSON.stringify(result));
  } finally { await f.cleanup(); }
});
