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
