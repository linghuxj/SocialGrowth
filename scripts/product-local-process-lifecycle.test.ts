import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { stopOwnedProcessGroups } from "./product-local-process-lifecycle.js";

test("a disappeared owned group does not prevent stopping the remaining real child group", async () => {
  const departed = spawn(process.execPath, ["-e", "process.exit(0)"], { detached: true, stdio: "ignore" });
  const departedClose = once(departed, "close");
  await departedClose;
  assert.ok(departed.pid);
  const live = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
  const liveClose = once(live, "close");
  try {
    assert.doesNotThrow(() => stopOwnedProcessGroups([
      { pid: departed.pid, exitCode: null, signalCode: null }, live,
    ]));
    const [code, signal] = await liveClose;
    assert.equal(code, null);
    assert.equal(signal, "SIGTERM");
  } finally {
    if (live.exitCode === null && live.signalCode === null) stopOwnedProcessGroups([live]);
  }
});
