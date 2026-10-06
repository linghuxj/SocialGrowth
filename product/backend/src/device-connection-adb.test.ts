import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeviceConnectionAdb, adbEndpoint } from "./device-connection-adb.js";

async function fixture(body: string, work: (adb: DeviceConnectionAdb) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "sg-adb-boundary-"));
  try {
    const file = join(dir, "adb");
    await writeFile(join(dir, "adbkey"), "test boundary identity", { mode: 0o600 });
    await writeFile(file, `#!${process.execPath}\n${body}`, { mode: 0o700 });
    await work(new DeviceConnectionAdb(file, dir, 1000));
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test("pair requires an actual success response and sends the code through stdin", async () => {
  const code = "583021";
  await fixture(`const args=process.argv.slice(2); if(args.length!==2||args[0]!=="pair")process.exit(2); let input="";process.stdin.on("data",x=>input+=x);process.stdin.on("end",()=>{if(input.trim()!=="${code}"||args.includes(input.trim()))process.exit(3);console.log("Enter pairing code: Successfully paired to "+args[1]+" [guid=test]");});`, async adb => {
    assert.equal(await adb.pair({ address: "100.118.89.89", pairingPort: 37001, connectPort: 37002 }, code), "paired");
  });
  await fixture('process.stdin.resume();process.stdin.on("end",()=>console.log("no outcome"));', async adb => {
    assert.equal(await adb.pair({ address: "100.118.89.89", pairingPort: 37001, connectPort: 37002 }, code), "unknown");
  });
});

test("connected status requires the exact transport and readable Android hardware identity", async () => {
  const endpoint = "100.118.89.89:37002";
  const script = `const args=process.argv.slice(2);if(args[0]==="connect")console.log("connected");else if(args[0]==="devices")console.log("List of devices attached\\n${endpoint}\\tdevice");else if(args[2]==="get-state")console.log("device");else if(args[2]==="shell")console.log("RFCW40MYYCV");else process.exit(2);`;
  await fixture(script, async adb => assert.deepEqual(await adb.connectAndVerify("100.118.89.89", 37002), { state: "connected", hardwareSerial: "RFCW40MYYCV" }));
  await fixture(script.replace('console.log("RFCW40MYYCV")', 'console.log("")'), async adb => assert.deepEqual(await adb.connectAndVerify("100.118.89.89", 37002), { state: "unknown" }));
  await fixture(script.replace(endpoint, "100.118.89.90:37002"), async adb => assert.deepEqual(await adb.connectAndVerify("100.118.89.89", 37002), { state: "unknown" }));
});

test("invalid endpoints and stalled ADB processes cannot create successful results", async () => {
  assert.throws(() => adbEndpoint("phone;anything", 37002));
  assert.throws(() => adbEndpoint("100.118.89.89", 0));
  assert.equal(adbEndpoint("fd7a:115c:a1e0::1", 37002), "[fd7a:115c:a1e0::1]:37002");
  await fixture('setInterval(()=>{},1000);', async adb => assert.deepEqual(await adb.connectAndVerify("100.118.89.89", 37002), { state: "unknown" }));
});

test("failed live verification clears a cached device transport and permits the next retry", async () => {
  const endpoint = "100.118.89.89:37002";
  await fixture(`const fs=require("node:fs"),path=require("node:path");
    const marker=path.join(path.dirname(process.argv[1]),"disconnected");
    const args=process.argv.slice(2);
    if(args[0]==="disconnect"){if(args[1]!=="${endpoint}")process.exit(2);fs.writeFileSync(marker,"");}
    else if(args[0]==="connect")console.log("connected");
    else if(args[0]==="devices")console.log("${endpoint}\\tdevice");
    else if(args[2]==="get-state")console.log("device");
    else if(args[2]==="shell"){if(fs.existsSync(marker))console.log("RFCW40MYYCV");else process.exit(1);}
    else process.exit(2);`, async adb => {
      assert.deepEqual(await adb.connectAndVerify("100.118.89.89", 37002), { state: "unknown" });
      assert.deepEqual(await adb.connectAndVerify("100.118.89.89", 37002), { state: "connected", hardwareSerial: "RFCW40MYYCV" });
    });
});
