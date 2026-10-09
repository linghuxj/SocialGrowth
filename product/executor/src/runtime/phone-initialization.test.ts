import { AppProvisioner, type AppReadiness } from "./app-readiness.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PhoneInitialization, phoneInitializationVersion, deviceSfaConfiguration, readPrivatePreparationFile } from "./phone-initialization.js";

const enrollment = "11111111-1111-4111-8111-111111111111";
function config() { return {
  endpoints: [{ type: "tailscale", tag: "phone-tailnet", auth_key: "fixture-key-not-real", accept_routes: false,
    advertise_exit_node: false, system_interface: false, domain_resolver: "direct-dns" }],
  inbounds: [{ type: "tun", auto_route: true, strict_route: true, exclude_package: ["com.follow.clash", "com.tailscale.ipn"] }],
  outbounds: [{ type: "direct", tag: "local-direct" }, { type: "socks", tag: "phone-subscription", server: "127.0.0.1", server_port: 7890 }],
  route: { final: "phone-subscription", rules: [
    { inbound: ["phone-tailnet"], network: "tcp", action: "route", outbound: "local-direct", source_ip_cidr: ["100.95.244.67/32"], port_range: ["32768:60999"] },
    { inbound: ["phone-tailnet"], action: "reject" },
    { ip_cidr: ["100.64.0.0/10"], outbound: "phone-tailnet" },
  ] },
  dns: { final: "business-dns", rules: [{ server: "tailnet-dns", preferred_by: "tailnet-dns" }], servers: [{ tag: "business-dns", type: "https", server: "223.5.5.5", detour: "phone-subscription" }, { tag: "direct-dns" }, { type: "tailscale", tag: "tailnet-dns", endpoint: "phone-tailnet", accept_default_resolvers: false, accept_search_domain: false }] },
}; }
test("per-enrollment SFA state is isolated; other-center, exit-node and recursive proxy templates are rejected", () => {
  const original = config(), first = deviceSfaConfiguration(original, "100.95.244.67", enrollment);
  const second = deviceSfaConfiguration(original, "100.95.244.67", "22222222-2222-4222-8222-222222222222");
  assert.notEqual(JSON.stringify(first.endpoints), JSON.stringify(second.endpoints));
  assert.equal("hostname" in original.endpoints[0], false);
  assert.throws(() => deviceSfaConfiguration(original, "100.75.25.72", enrollment), /PHONE_CENTER_ACCESS_UNSAFE/);
  const exit = config(); exit.endpoints[0].advertise_exit_node = true;
  assert.throws(() => deviceSfaConfiguration(exit, "100.95.244.67", enrollment), /PHONE_ENDPOINT_INVALID/);
  const loop = config(); loop.inbounds[0].exclude_package = ["com.tailscale.ipn"];
  assert.throws(() => deviceSfaConfiguration(loop, "100.95.244.67", enrollment), /PHONE_VPN_LOOP_UNSAFE/);
  const broad = config(); broad.route.rules[0].source_ip_cidr = ["100.64.0.0/10"];
  assert.throws(() => deviceSfaConfiguration(broad, "100.95.244.67", enrollment), /PHONE_CENTER_ACCESS_UNSAFE/);
  const reversed = config(); reversed.route.rules.reverse();
  assert.throws(() => deviceSfaConfiguration(reversed, "100.95.244.67", enrollment));
});
test("private delivery refuses exposed files and symlink targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "sg-private-preparation-")), file = join(root, "private.json");
  try {
    await writeFile(file, "fixture", { mode: 0o600 });
    assert.equal((await readPrivatePreparationFile(file)).toString(), "fixture");
    await chmod(file, 0o644); await assert.rejects(readPrivatePreparationFile(file), /PHONE_PRIVATE_FILE_INVALID/);
    await chmod(file, 0o600); await symlink(file, join(root, "link"));
    await assert.rejects(readPrivatePreparationFile(join(root, "link")), /PHONE_PRIVATE_FILE_INVALID/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("subscription import preserves approved proxy credentials but disables TUN and exposed listeners; encoded or alias payloads cannot masquerade as YAML", async () => {
  const { subscriptionConfiguration } = await import("./phone-initialization.js");
  const { parse } = await import("yaml");
  const input = Buffer.from('proxies:\n  - name: fixture\n    type: ss\n    server: fixture.invalid\n    password: fixture-only-secret\n    port: 443\nmode: rule\nallow-lan: true\ntun:\n  enable: true\nredir-port: 7892\n');
  const normalized = parse(subscriptionConfiguration(input).toString()) as Record<string, unknown>;
  assert.equal(normalized.mode, "global"); assert.equal(normalized["mixed-port"], 7890); assert.equal(normalized["allow-lan"], false);
  assert.deepEqual(normalized.tun, { enable: false }); assert.equal(normalized["bind-address"], "127.0.0.1");
  assert.equal("redir-port" in normalized, false);
  assert.deepEqual(normalized.proxies, [{ name: "fixture", type: "ss", server: "fixture.invalid", password: "fixture-only-secret", port: 443 }]);
  for (const text of ['encodedscalar', 'proxies: []', 'proxies: &items []\ncopy: *items', 'proxies:\n - name: a\n   type: ss\nproxy-providers: {}'])
    assert.throws(() => subscriptionConfiguration(Buffer.from(text)));
});


test("prepared continuation refuses a missing app without reinstalling or delivering files", async () => {
  const root = await mkdtemp(join(tmpdir(), "sg-prepared-resume-"));
  const saved = process.env.SG_APP_STORAGE_FILE;
  const calls: string[][] = [];
  class MissingApp extends AppProvisioner {
    override async ensure(_serial: string, packageName: string, installMissing = true): Promise<AppReadiness> {
      assert.equal(installMissing, false);
      return { packageName, status: "missing" };
    }
  }
  try {
    const manifestPath = join(root, "manifest.json"), template = join(root, "sfa.json"), subscription = join(root, "subscription.yaml");
    await writeFile(template, JSON.stringify(config()), { mode: 0o600 });
    await writeFile(subscription, "proxies:\n - name: fixture\n   type: ss\n   server: fixture.invalid\n", { mode: 0o600 });
    await writeFile(manifestPath, JSON.stringify({ version: phoneInitializationVersion, deviceIds: [enrollment], centerTailnetIp: "100.95.244.67",
      authKeyExpiresAt: new Date(Date.now() + 3600000).toISOString(), sfaTemplate: template, subscriptionFile: subscription, proxyGroup: "fixture" }), { mode: 0o600 });
    process.env.SG_APP_STORAGE_FILE = "fixture-storage";
    const initializer = new PhoneInitialization(manifestPath, new MissingApp(), async (file, args) => {
      calls.push([file, ...args]);
      return file.endsWith("tailscale") ? "100.95.244.67" : args.includes("ro.serialno") ? "RFC_TEST" : "";
    });
    await assert.rejects(initializer.prepare({ deviceId: enrollment, requestId: enrollment, serial: "127.0.0.1:12345", hardwareSerial: "RFC_TEST", verifyInstalledOnly: true }), /PHONE_PREPARED_APP_MISSING/);
    assert.equal(calls.some(c => c.includes("push") || c.includes("install")), false);
  } finally {
    if (saved === undefined) delete process.env.SG_APP_STORAGE_FILE; else process.env.SG_APP_STORAGE_FILE = saved;
    await rm(root, { recursive: true, force: true });
  }
});

test("management exclusion is added without mutating template, state or business route", () => {
  const raw = config();
  const result = deviceSfaConfiguration(raw, "100.95.244.67", enrollment);
  assert.deepEqual((result.inbounds as { exclude_package: string[] }[])[0].exclude_package,
    ["com.follow.clash", "com.tailscale.ipn", "com.socialgrowth.product"]);
  assert.deepEqual(raw.inbounds[0].exclude_package, ["com.follow.clash", "com.tailscale.ipn"]);
  assert.deepEqual(result.route, raw.route);
  assert.equal((result.endpoints as { state_directory: string }[])[0].state_directory, `tailscale-sg-${enrollment}`);
  raw.inbounds[0].exclude_package.push("com.facebook.katana");
  assert.throws(() => deviceSfaConfiguration(raw, "100.95.244.67", enrollment), /PHONE_BUSINESS_ROUTE_BYPASSED/);
});

test("actual VPN proof requires sole SFA owner and effective UID exclusion while business apps remain routed", async () => {
  const { activePhoneVpns, verifyPhoneVpn } = await import("./phone-initialization.js");
  const uids = { sfa: 10403, management: 10404, clash: 10405, facebook: 10300, youtube: 10301 };
  const network = "NetworkAgentInfo{network{300} Transports: VPN Capabilities: INTERNET Uids: <0-10402, 10406-99999> OwnerUid: 10403 AdminUids: [10403]}";
  assert.doesNotThrow(() => verifyPhoneVpn(network, uids));
  assert.doesNotThrow(() => verifyPhoneVpn(network.replace("<0-10402, 10406-99999>", "<{0-10402, 10406-99999}>"), uids));
  assert.throws(() => verifyPhoneVpn(network.replace("<0-10402, 10406-99999>", "<{0-99999}>"), uids), /PHONE_MANAGEMENT_VPN_NOT_EXCLUDED/);
  assert.throws(() => verifyPhoneVpn(network.replace("<0-10402, 10406-99999>", "<{{0-10402, 10406-99999}}>"), uids), /PHONE_VPN_UIDS_UNCONFIRMED/);
  assert.deepEqual(activePhoneVpns("NetworkAgentInfo{Transports: WIFI Capabilities: NOT_VPN}\nRemembered VPN OwnerUid: 10403"), []);
  for (const [value, code] of [
    ["", "PHONE_SFA_VPN_NOT_ACTIVE"],
    [network + "\n" + network, "PHONE_SFA_VPN_NOT_ACTIVE"],
    [network.replace("OwnerUid: 10403", "OwnerUid: 10405"), "PHONE_SFA_VPN_NOT_ACTIVE"],
    [network.replace("Uids: <0-10402, 10406-99999>", "Uids: <0-99999>"), "PHONE_MANAGEMENT_VPN_NOT_EXCLUDED"],
    [network.replace("Uids: <0-10402, 10406-99999>", "Uids: <1-200>"), "PHONE_BUSINESS_ROUTE_BYPASSED"],
    [network.replace("Uids: <0-10402, 10406-99999>", ""), "PHONE_VPN_UIDS_UNCONFIRMED"],
  ]) assert.throws(() => verifyPhoneVpn(value, uids), new RegExp(code));
});

test("proxy readiness is hardware pinned, uses actual SOCKS HTTPS and rejects unavailable or second VPN", async () => {
  const calls: string[][] = [];
  let hardware = "RFC_TEST", connectivity = "NetworkAgentInfo{Transports: WIFI Capabilities: NOT_VPN}", response = "204", curlFails = false;
  const init = new PhoneInitialization("unused", new AppProvisioner(), async (_file, args) => {
    calls.push(args);
    assert.deepEqual(args.slice(0, 2), ["-s", "127.0.0.1:12345"]);
    if (args.includes("ro.serialno")) return hardware;
    if (args.includes("connectivity")) return connectivity;
    if (args.includes("packages")) return "package:io.nekohasekai.sfa uid:10403";
    if (args.includes("curl")) { if (curlFails) throw new Error("private upstream error"); return response; }
    throw new Error("unexpected command");
  });
  await init.networkReady("127.0.0.1:12345", "RFC_TEST", "proxy");
  assert.ok(calls.some(args => args.includes("socks5h://127.0.0.1:7890") && args.includes("https://www.youtube.com/generate_204")));
  response = "200"; await assert.rejects(init.networkReady("127.0.0.1:12345", "RFC_TEST", "proxy"), /PHONE_LOCAL_PROXY_NOT_READY/);
  curlFails = true; await assert.rejects(init.networkReady("127.0.0.1:12345", "RFC_TEST", "proxy"), /PHONE_LOCAL_PROXY_NOT_READY/);
  connectivity = "NetworkAgentInfo{Transports: VPN Capabilities: INTERNET OwnerUid: 10405 }";
  await assert.rejects(init.networkReady("127.0.0.1:12345", "RFC_TEST", "proxy"), /PHONE_SECOND_VPN_ACTIVE/);
  hardware = "OTHER"; await assert.rejects(init.networkReady("127.0.0.1:12345", "RFC_TEST", "proxy"), /PHONE_HARDWARE_MISMATCH/);
});

test("prepared continuation delivers one scoped management-v2 profile with unchanged endpoint namespace and no private data in instructions", async () => {
  const { readFile } = await import("node:fs/promises"), { createHash } = await import("node:crypto");
  const root = await mkdtemp(join(tmpdir(), "sg-management-profile-")), saved = process.env.SG_APP_STORAGE_FILE;
  const files = new Map<string, Buffer>();
  class InstalledApps extends AppProvisioner {
    override async ensure(_serial: string, packageName: string, installMissing = true): Promise<AppReadiness> {
      assert.equal(installMissing, false); return { packageName, status: "installed" };
    }
  }
  try {
    const manifestPath = join(root, "manifest.json"), template = join(root, "sfa.json"), subscription = join(root, "subscription.yaml");
    await writeFile(template, JSON.stringify(config()), { mode: 0o600 });
    await writeFile(subscription, "proxies:\n - name: fixture\n   type: ss\n   server: fixture.invalid\n   password: fixture-private-password\n", { mode: 0o600 });
    await writeFile(manifestPath, JSON.stringify({ version: phoneInitializationVersion, deviceIds: [enrollment], centerTailnetIp: "100.95.244.67",
      authKeyExpiresAt: new Date(Date.now() + 3600000).toISOString(), sfaTemplate: template, subscriptionFile: subscription, proxyGroup: "fixture" }), { mode: 0o600 });
    process.env.SG_APP_STORAGE_FILE = "fixture-storage";
    const init = new PhoneInitialization(manifestPath, new InstalledApps(), async (file, args) => {
      if (file.endsWith("tailscale")) return "100.95.244.67";
      if (args.includes("ro.serialno")) return "RFC_TEST";
      const push = args.indexOf("push"); if (push >= 0) files.set(args[push + 2], await readFile(args[push + 1]));
      if (args.includes("sha256sum")) return createHash("sha256").update(files.get(args.at(-1)!)!).digest("hex") + "  file";
      return "";
    });
    const result = await init.prepare({ deviceId: enrollment, requestId: enrollment, serial: "127.0.0.1:12345", hardwareSerial: "RFC_TEST", verifyInstalledOnly: true });
    const filename = `/sdcard/Download/socialgrowth-${enrollment}/sg-${enrollment.slice(0, 18)}-management-v2.json`;
    const delivered = JSON.parse(files.get(filename)!.toString()) as ReturnType<typeof config>;
    assert.ok(delivered.inbounds[0].exclude_package.includes("com.socialgrowth.product"));
    assert.equal((delivered.endpoints[0] as unknown as { hostname: string }).hostname, `sg-${enrollment.slice(0, 18)}`);
    assert.equal(files.size, 2); assert.ok(result.instructions.includes(filename));
    assert.equal(result.instructions.includes("fixture-key-not-real"), false);
    assert.equal(result.instructions.includes("fixture-private-password"), false);
    assert.match(result.instructions, /check_phone_network\(stage="proxy"\)/);
    assert.match(result.instructions, /legacy profile/);
  } finally {
    if (saved === undefined) delete process.env.SG_APP_STORAGE_FILE; else process.env.SG_APP_STORAGE_FILE = saved;
    await rm(root, { recursive: true, force: true });
  }
});
