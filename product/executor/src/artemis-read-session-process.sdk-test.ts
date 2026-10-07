import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdir, access } from "node:fs/promises";
import test from "node:test";
import { ArtemisReadSessionProcess, readSessionSources, readSessionSandboxProfile, type ReadSessionBundle } from "./artemis-read-session-process.js";
import { bridgeFixture } from "./read-screen-bridge-fixture.js";

// Real current-host sandbox + actual installed SDK classes, synthetic authority
// and transport only. Explicit component command; never a Web/phone acceptance.
function bundle(): ReadSessionBundle {
  const root = resolve("../.."), sdkRoot = resolve(root, "integrations/google-artemis"), overlaysRoot = resolve(root, "integrations/artemis");
  const hash = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
  const pythonPath = join(sdkRoot, ".venv/bin/python");
  const pythonRuntimePath = join(dirname(dirname(realpathSync(pythonPath))), "Resources/Python.app/Contents/MacOS/Python");
  return { sdkRoot, overlaysRoot, pythonPath, pythonSha256: hash(realpathSync(pythonPath)),
    pythonRuntimePath, pythonRuntimeSha256: hash(pythonRuntimePath),
    sourceHashes: Object.fromEntries(readSessionSources.map(p => [p, hash(join(overlaysRoot, p))])) as ReadSessionBundle["sourceHashes"] };
}
test("actual SDK context boots inside macOS sandbox, original observer crosses fence once, close records child exit only", async () => {
  const f = await bridgeFixture(), path = join(f.dir, "process.sqlite"), p = new ArtemisReadSessionProcess(path, bundle(), f.bridge, f.access);
  try {
    const start = await p.start(); assert.equal(start.replayed, false); assert.equal(start.receipt.state, "ready"); assert.equal(await f.count(), 0);
    const replay = await p.start(); assert.equal(replay.replayed, true); assert.equal(replay.receipt.launchId, start.receipt.launchId);
    const requestId = randomUUID(), image = await p.observe(requestId);
    assert.equal(image.requestId, requestId); assert.equal(image.width, 2); assert.equal(image.height, 2);
    assert.equal(image.sha256, createHash("sha256").update(f.png).digest("hex")); assert.equal(await f.count(), 1);
    await assert.rejects(p.observe(requestId)); assert.equal(await f.count(), 1);
    await Promise.all([p.close(), p.close()]);
    assert.equal(p.receipt()?.state, "child_exited"); assert.equal(p.receipt()?.closeAcknowledged, true); assert.equal(p.receipt()?.exitCode, 0);
    assert.equal(f.fence.snapshot().disposition, "stop_requested"); assert.equal(f.fence.snapshot().proofCheckedAt, null);
    console.log(JSON.stringify({ nativeContextAndOperatorLoaded: true, freshReadCount: 1, childExited: true, phoneStopped: false, allPathsFenced: false, modelCalls: 0 }));
  } finally { await p.close(); p.dispose(); await f.cleanup(); }
});
test("reconstructed host reads original launch intent without spawning or claiming phone stop", async () => {
  const f = await bridgeFixture(), path = join(f.dir, "process.sqlite"), first = new ArtemisReadSessionProcess(path, bundle(), f.bridge, f.access);
  try {
    const db = new DatabaseSync(path), id = randomUUID();
    db.prepare("INSERT INTO read_session_launches(scope_digest,launch_id,serial,state) VALUES(?,?,?,'launch_intent')").run(f.access.scopeDigest, id, f.access.serial); db.close(); first.dispose();
    const recovered = new ArtemisReadSessionProcess(path, bundle(), f.bridge, f.access);
    try { const result = await recovered.start(); assert.equal(result.replayed, true); assert.equal(result.receipt.launchId, id); assert.equal(result.receipt.state, "launch_intent"); assert.equal(await f.count(), 0); }
    finally { recovered.dispose(); }
  } finally { await f.cleanup(); }
});
test("stale scope and changed pinned source refuse before original launch intent or subprocess", async () => {
  for (const mode of ["stale", "source"] as const) {
    const f = await bridgeFixture(), b = bundle(); if (mode === "stale") f.fence.requestStop(randomUUID()); else b.sourceHashes["socialgrowth_read_session.py"] = "0".repeat(64);
    const p = new ArtemisReadSessionProcess(join(f.dir, "process.sqlite"), b, f.bridge, f.access);
    try { await assert.rejects(p.start()); assert.equal(p.receipt(), null); assert.equal(await f.count(), 0); }
    finally { p.dispose(); await f.cleanup(); }
  }
});
test("current local withdrawal prevents observer and child exit does not restore holder", async () => {
  const f = await bridgeFixture(), p = new ArtemisReadSessionProcess(join(f.dir, "process.sqlite"), bundle(), f.bridge, f.access);
  try { await p.start(); f.fence.requestStop(randomUUID()); await assert.rejects(p.observe(randomUUID())); assert.equal(await f.count(), 0); await p.close(); assert.equal(f.fence.snapshot().disposition, "stop_requested"); }
  finally { await p.close(); p.dispose(); await f.cleanup(); }
});
test("transport unknown closes original child, retains unresolved read and never repeats it", async () => {
  const f = await bridgeFixture("setInterval(()=>{},1000);"), p = new ArtemisReadSessionProcess(join(f.dir, "process.sqlite"), bundle(), f.bridge, f.access);
  try { const start = await p.start(); await assert.rejects(p.observe(randomUUID())); assert.deepEqual(f.outcomes, ["unknown"]); assert.equal(await f.count(), 1);
    const replay = await p.start(); assert.equal(replay.replayed, true); assert.equal(replay.receipt.launchId, start.receipt.launchId); assert.equal(replay.receipt.closeAcknowledged, false);
    await assert.rejects(f.fence.confirmStopped()); assert.equal(await f.count(), 1);
  } finally { await p.close(); p.dispose(); await f.cleanup(); }
});
test("host kernel denies native IP, another Unix socket, parent writes and fork before SDK Python guards; original IPC still captures", async () => {
  const f = await bridgeFixture(), b = bundle(), scratch = join(f.dir, "scratch"), other = join(f.dir, "other.sock"), marker = join(f.dir, "forbidden-write");
  let connections = 0;
  const ip = createServer(s => { connections++; s.destroy(); }), unix = createServer(s => { connections++; s.destroy(); });
  try {
    await mkdir(scratch, { mode: 0o700 }); for (const name of ["tmp", "app", "traces"]) await mkdir(join(scratch, name), { mode: 0o700 });
    ip.listen(0, "127.0.0.1"); await once(ip, "listening"); unix.listen(other); await once(unix, "listening");
    const address = ip.address(); assert.ok(address && typeof address !== "string");
    const child = spawn("/usr/bin/sandbox-exec", ["-p", readSessionSandboxProfile(f.access.socketPath, b.pythonPath, b.pythonRuntimePath, scratch), b.pythonPath, "-I", "-B", join(b.overlaysRoot, "read_session_sandbox_component.py")],
      { cwd: scratch, env: { PATH: "/usr/bin:/bin", TMPDIR: join(scratch, "tmp"), ARTEMIS_APP_DIR: join(scratch, "app"), ARTEMIS_TRACES_DIR: join(scratch, "traces") }, stdio: ["pipe", "pipe", "pipe"] });
    let output = "", errors = ""; child.stdout.on("data", v => output += v); child.stderr.on("data", v => errors += v);
    const ended = once(child, "close"), timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    child.stdin.end(JSON.stringify({ access: { socket_path: f.access.socketPath, token: f.access.token, scope_digest: f.access.scopeDigest, serial: f.access.serial }, sdkRoot: b.sdkRoot, port: address.port, otherSocket: other, writeMarker: marker }) + "\n");
    const [code] = await ended; clearTimeout(timer); assert.equal(code, 0, errors.replaceAll(f.access.token, "[redacted]"));
    const result = JSON.parse(output); assert.deepEqual(result.kernelDenied, ["native_ip_connect", "other_unix_endpoint", "native_file_write", "native_fork"]);
    assert.deepEqual(result.nativeScreen, [2, 2]); assert.equal(result.allPathsFenced, false); assert.equal(connections, 0); await assert.rejects(access(marker)); assert.equal(await f.count(), 1);
    console.log(JSON.stringify(result));
  } finally { await Promise.all([new Promise<void>(r => ip.close(() => r())), new Promise<void>(r => unix.close(() => r()))]); await f.cleanup(); }
});
