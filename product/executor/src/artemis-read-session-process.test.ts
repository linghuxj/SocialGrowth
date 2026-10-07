import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ArtemisReadSessionProcess, readSessionSandboxProfile, type ReadSessionBundle } from "./artemis-read-session-process.js";
import { bridgeFixture } from "./read-screen-bridge-fixture.js";

const unusableBundle = { sdkRoot: "/unavailable-sdk", overlaysRoot: "/unavailable-overlays", pythonPath: "/unavailable-python", pythonSha256: "0".repeat(64),
  pythonRuntimePath: "/unavailable-runtime", pythonRuntimeSha256: "0".repeat(64), sourceHashes: {} } as ReadSessionBundle;

test("OS profile permits only original Unix endpoint/private scratch and rejects policy text injection", async () => {
  const f = await bridgeFixture();
  try {
    const profile = readSessionSandboxProfile(f.access.socketPath, "/usr/bin/true", "/usr/bin/true", f.dir);
    assert.match(profile, /deny network\*/); assert.match(profile, /remote unix-socket/); assert.match(profile, /deny process-fork/); assert.match(profile, /deny file-write\*/);
    for (const bad of ['/private/tmp/"escape', "/private/tmp/new\nline", "/private/tmp/\\escape", "relative"])
      assert.throws(() => readSessionSandboxProfile(bad, "/usr/bin/true", "/usr/bin/true", f.dir));
    const unsafeTarget = join(f.dir, 'unsafe"policy'), safeAlias = join(f.dir, "safe-python");
    await writeFile(unsafeTarget, "synthetic component marker", { mode: 0o700 }); await symlink(unsafeTarget, safeAlias);
    assert.throws(() => readSessionSandboxProfile(f.access.socketPath, safeAlias, "/usr/bin/true", f.dir));
  } finally { await f.cleanup(); }
});
test("private original launch receipt is recoverable without SDK/config/physical execution; even ended scope cannot relaunch", async () => {
  for (const state of ["launch_intent", "ready", "launch_unknown", "child_exited"]) {
    const f = await bridgeFixture(), path = join(f.dir, "process.sqlite"), p = new ArtemisReadSessionProcess(path, unusableBundle, f.bridge, f.access);
    try {
      const db = new DatabaseSync(path), id = randomUUID();
      db.prepare("INSERT INTO read_session_launches(scope_digest,launch_id,serial,state) VALUES(?,?,?,?)").run(f.access.scopeDigest, id, f.access.serial, state); db.close();
      const result = await p.start(); assert.equal(result.replayed, true); assert.equal(result.receipt.launchId, id); assert.equal(result.receipt.state, state);
      assert.equal(await f.count(), 0); assert.equal(f.fence.snapshot().disposition, "enabled");
    } finally { p.dispose(); await f.cleanup(); }
  }
});
test("missing pinned bundle refuses before recording launch or changing current fence", async () => {
  const f = await bridgeFixture(), p = new ArtemisReadSessionProcess(join(f.dir, "process.sqlite"), unusableBundle, f.bridge, f.access);
  try { await assert.rejects(p.start()); assert.equal(p.receipt(), null); assert.equal(f.fence.snapshot().disposition, "enabled"); assert.equal(await f.count(), 0); }
  finally { p.dispose(); await f.cleanup(); }
});
test("public ledger and foreign access capability cannot be adopted", async () => {
  const f = await bridgeFixture();
  try { f.bridge.requireCurrentAccess(f.access); assert.throws(() => f.bridge.requireCurrentAccess({ ...f.access, token: "0".repeat(64) }));
    await chmod(f.dir, 0o755); assert.throws(() => new ArtemisReadSessionProcess(join(f.dir, "process.sqlite"), unusableBundle, f.bridge, f.access)); }
  finally { await chmod(f.dir, 0o700); await f.cleanup(); }
});
test("another original launch on the same serial cannot replace an unresolved owner", async () => {
  const f = await bridgeFixture(), path = join(f.dir, "process.sqlite"), p = new ArtemisReadSessionProcess(path, unusableBundle, f.bridge, f.access);
  try {
    const db = new DatabaseSync(path);
    db.prepare("INSERT INTO read_session_launches(scope_digest,launch_id,serial,state) VALUES(?,?,?,'launch_unknown')").run(f.access.scopeDigest, randomUUID(), f.access.serial);
    assert.throws(() => db.prepare("INSERT INTO read_session_launches(scope_digest,launch_id,serial,state) VALUES(?,?,?,'launch_intent')").run("1".repeat(64), randomUUID(), f.access.serial));
    assert.equal(db.prepare("SELECT count(*) n FROM read_session_launches").get()?.n, 1); db.close();
    assert.equal(p.receipt()?.state, "launch_unknown"); assert.equal(await f.count(), 0);
  } finally { p.dispose(); await f.cleanup(); }
});
