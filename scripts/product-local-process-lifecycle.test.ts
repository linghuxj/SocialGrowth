import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
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

test("completed wrapper metadata does not leave its real descendant process running", async () => {
  const script = "const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});c.unref();process.stdout.write(String(c.pid),()=>process.exit(0));";
  const wrapper = spawn(process.execPath, ["-e", script], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
  let output = "";
  wrapper.stdout.on("data", bytes => { output += String(bytes); });
  await once(wrapper, "close");
  assert.equal(wrapper.exitCode, 0);
  assert.match(output, /^\d+$/);
  const descendantPid = Number(output);
  const alive = () => {
    const state = spawnSync("ps", ["-p", String(descendantPid), "-o", "stat="], { encoding: "utf8" });
    return state.status === 0 && state.stdout.trim() !== "" && !state.stdout.trim().startsWith("Z");
  };
  try {
    assert.equal(alive(), true);
    stopOwnedProcessGroups([wrapper]);
    for (let n = 0; n < 20 && alive(); n++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(alive(), false);
  } finally {
    if (alive() && wrapper.pid) process.kill(-wrapper.pid, "SIGKILL");
  }
});
