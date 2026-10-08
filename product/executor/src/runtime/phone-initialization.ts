import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { parseDocument, stringify } from "yaml";
import { z } from "zod-v3";
import { AppProvisioner, type Command } from "./app-readiness.js";
import { requireFact } from "./contracts.js";

export { phoneInitializationVersion } from "@socialgrowth/product-contracts";
import { phoneInitializationVersion } from "@socialgrowth/product-contracts";
const path = z.string().refine(isAbsolute);
export const phoneInitializationConfig = z.object({
  version: z.literal(phoneInitializationVersion),
  deviceIds: z.array(z.string().uuid()).min(1),
  centerTailnetIp: z.string().regex(/^100\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.(?:25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})\.(?:25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})$/),
  authKeyExpiresAt: z.string().datetime(), sfaTemplate: path, subscriptionFile: path,
  proxyGroup: z.string().min(1).max(100), proxyNode: z.string().min(1).max(100).nullable().default(null),
  soakSeconds: z.number().int().min(300).max(3600).default(300),
}).strict();
type Json = Record<string, unknown>;
const object = (v: unknown): Json => { requireFact(v !== null && typeof v === "object" && !Array.isArray(v), "PHONE_CONFIG_INVALID"); return v as Json; };
const objects = (v: unknown): Json[] => { requireFact(Array.isArray(v), "PHONE_CONFIG_INVALID"); return (v as unknown[]).map(object); };
export async function readPrivatePreparationFile(file: string): Promise<Buffer> {
  const stat = await lstat(file);
  requireFact(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 && stat.size > 0 && stat.size <= 8 * 1024 * 1024,
    "PHONE_PRIVATE_FILE_INVALID");
  return readFile(file);
}

/** Validate the existing single-VPN template and isolate state for this enrollment.
 * No template key or subscription content is ever returned to the model/console. */
export function deviceSfaConfiguration(raw: unknown, centerIp: string, enrollmentId: string): Json {
  requireFact(z.string().uuid().safeParse(enrollmentId).success, "PHONE_SCOPE_INVALID");
  const config = object(structuredClone(raw)), endpoints = objects(config.endpoints);
  requireFact(endpoints.length === 1, "PHONE_ENDPOINT_INVALID");
  const endpoint = endpoints[0];
  requireFact(endpoint.type === "tailscale" && endpoint.tag === "phone-tailnet" && typeof endpoint.auth_key === "string" && endpoint.auth_key.length > 10
    && endpoint.accept_routes === false && endpoint.advertise_exit_node === false && endpoint.system_interface === false, "PHONE_ENDPOINT_INVALID");
  endpoint.hostname = `sg-${enrollmentId.slice(0, 18)}`;
  endpoint.state_directory = `tailscale-sg-${enrollmentId}`;
  const inbounds = objects(config.inbounds), tun = inbounds.find(v => v.type === "tun");
  requireFact(inbounds.length === 1 && tun?.auto_route === true && tun.strict_route === true
    && Array.isArray(tun.exclude_package) && tun.exclude_package.includes("com.follow.clash") && tun.exclude_package.includes("com.tailscale.ipn"), "PHONE_VPN_LOOP_UNSAFE");
  const outbounds = objects(config.outbounds), proxy = outbounds.find(v => v.tag === "phone-subscription");
  requireFact(outbounds.length === 2 && proxy?.type === "socks" && proxy.server === "127.0.0.1" && proxy.server_port === 7890
    && outbounds.some(v => v.type === "direct" && v.tag === "local-direct"), "PHONE_PROXY_INVALID");
  const route = object(config.route), rules = objects(route.rules);
  requireFact(rules.some(v => Array.isArray(v.ip_cidr) && v.ip_cidr.includes("100.64.0.0/10") && v.outbound === "phone-tailnet"), "PHONE_TAILNET_ROUTE_INVALID");
  const dns = object(config.dns);
  const dnsRules = objects(dns.rules ?? []);
  requireFact(dnsRules.some(v => v.server === "tailnet-dns" && v.preferred_by === "tailnet-dns"), "PHONE_TAILNET_DNS_INVALID");
  const incoming = rules.filter(v => Array.isArray(v.inbound) && v.inbound.includes("phone-tailnet"));
  requireFact(incoming.length === 2 && incoming[0].network === "tcp" && incoming[0].action === "route" && incoming[0].outbound === "local-direct"
    && JSON.stringify(incoming[0].source_ip_cidr) === JSON.stringify([`${centerIp}/32`])
    && JSON.stringify(incoming[0].port_range) === JSON.stringify(["32768:60999"]) && incoming[1].action === "reject"
    && rules[0] === incoming[0] && rules[1] === incoming[1] && route.final === "phone-subscription", "PHONE_CENTER_ACCESS_UNSAFE");
  const servers = objects(dns.servers);
  requireFact(servers.some(v => v.tag === "business-dns" && v.type === "https" && v.server === "223.5.5.5" && v.detour === "phone-subscription")
    && servers.some(v => v.type === "tailscale" && v.tag === "tailnet-dns" && v.endpoint === "phone-tailnet" && v.accept_default_resolvers === false && v.accept_search_domain === false)
    && servers.some(v => v.tag === "direct-dns") && dns.final === "business-dns" && endpoint.domain_resolver === "direct-dns", "PHONE_DNS_INVALID");
  return config;
}

/** Preserve approved nodes; constrain the local core to loopback, single-VPN use. */
export function subscriptionConfiguration(raw: Buffer): Buffer {
  const document = parseDocument(raw.toString("utf8"), { prettyErrors: false, uniqueKeys: true, strict: true, logLevel: "silent" });
  requireFact(document.errors.length === 0 && document.warnings.length === 0, "PHONE_SUBSCRIPTION_INVALID");
  let value: unknown;
  try { value = document.toJS({ maxAliasCount: 0 }); } catch { requireFact(false, "PHONE_SUBSCRIPTION_INVALID"); }
  const config = object(value), proxies = objects(config.proxies);
  requireFact(proxies.length > 0 && proxies.length <= 2000 && proxies.every(v => typeof v.name === "string" && typeof v.type === "string")
    && new Set(proxies.map(v => v.name)).size === proxies.length, "PHONE_SUBSCRIPTION_INVALID");
  requireFact(config["proxy-providers"] === undefined && config["rule-providers"] === undefined, "PHONE_SUBSCRIPTION_REMOTE_ASSETS_NOT_SUPPORTED");
  config["mixed-port"] = 7890; config["allow-lan"] = false; config["bind-address"] = "127.0.0.1"; config.mode = "global";
  config.tun = { enable: false };
  for (const key of ["port", "socks-port", "redir-port", "tproxy-port", "listeners", "external-controller-tls", "external-controller-unix", "external-controller-pipe", "external-ui-url"])
    delete config[key];
  config["external-controller"] = "127.0.0.1:9090";
  return Buffer.from(stringify(config));
}

export class PhoneInitialization {
  constructor(private readonly manifestPath: string, private readonly apps = new AppProvisioner(), private readonly command: Command = async (file, args) =>
    (await promisify(execFile)(file, args, { timeout: 120000, maxBuffer: 8 * 1024 * 1024 })).stdout.trim()) {}

  async managementTarget(enrollmentId: string, wirelessPort: number, hardwareSerial: string): Promise<{ address: string; serial: string; nodeKey: string }> {
    const status = object(JSON.parse(await this.command("/usr/local/bin/tailscale", ["status", "--json"])));
    const peers = Object.values(object(status.Peer)).map(object).filter(p => p.HostName === `sg-${enrollmentId.slice(0, 18)}` && p.Online === true);
    requireFact(peers.length === 1, "PHONE_MANAGEMENT_NODE_UNCONFIRMED");
    const ips = peers[0].TailscaleIPs;
    requireFact(Array.isArray(ips), "PHONE_MANAGEMENT_NODE_UNCONFIRMED");
    const address = ips.find(v => typeof v === "string" && phoneInitializationConfig.shape.centerTailnetIp.safeParse(v).success);
    requireFact(typeof address === "string" && typeof peers[0].PublicKey === "string", "PHONE_MANAGEMENT_NODE_UNCONFIRMED");
    const serial = `${address}:${wirelessPort}`;
    await this.command("adb", ["connect", serial]);
    requireFact(await this.command("adb", ["-s", serial, "shell", "getprop", "ro.serialno"]) === hardwareSerial, "PHONE_HARDWARE_MISMATCH");
    return { address: address as string, serial, nodeKey: peers[0].PublicKey as string };
  }
  async prepare(target: { deviceId: string; serial: string; hardwareSerial: string; requestId: string }): Promise<{ instructions: string; soakSeconds: number; cleanup: () => Promise<void> }> {
    const manifest = phoneInitializationConfig.parse(JSON.parse((await readPrivatePreparationFile(this.manifestPath)).toString()));
    requireFact(manifest.deviceIds.includes(target.deviceId), "PHONE_INITIALIZATION_NOT_AUTHORIZED");
    requireFact(Date.parse(manifest.authKeyExpiresAt) > Date.now() + 30 * 60_000, "PHONE_AUTH_KEY_EXPIRED");
    requireFact(!manifest.proxyNode || !/^(?:DIRECT|REJECT)$/i.test(manifest.proxyNode), "PHONE_PROXY_NODE_INVALID");
    requireFact(await this.command("/usr/local/bin/tailscale", ["ip", "-4"]) === manifest.centerTailnetIp, "PHONE_CENTER_CHANGED");
    const sfa = deviceSfaConfiguration(JSON.parse((await readPrivatePreparationFile(manifest.sfaTemplate)).toString()), manifest.centerTailnetIp, target.requestId);
    const subscription = subscriptionConfiguration(await readPrivatePreparationFile(manifest.subscriptionFile));
    const adb = (args: string[]) => this.command("adb", ["-s", target.serial, ...args]);
    requireFact(await adb(["shell", "getprop", "ro.serialno"]) === target.hardwareSerial, "PHONE_HARDWARE_MISMATCH");
    // Inspect optional official Tailscale; never install or activate a second VPN.
    await this.command("adb", ["-s", target.serial, "shell", "pm", "list", "packages", "com.tailscale.ipn"]);
    for (const packageName of ["io.nekohasekai.sfa", "com.follow.clash", "com.facebook.katana", "com.google.android.youtube"])
      await this.apps.ensure(target.serial, packageName);
    requireFact(await adb(["shell", "getprop", "ro.serialno"]) === target.hardwareSerial, "PHONE_HARDWARE_MISMATCH");
    const local = await mkdtemp(join(tmpdir(), "sg-phone-preparation-"));
    const remote = `/sdcard/Download/socialgrowth-${target.requestId}`;
    const cleanup = async () => { await adb(["shell", "rm", "-rf", remote]); };
    try {
      await writeFile(join(local, "network.json"), JSON.stringify(sfa), { mode: 0o600 });
      await writeFile(join(local, "subscription.yaml"), subscription, { mode: 0o600 });
      await adb(["shell", "mkdir", "-p", remote]);
      await adb(["push", join(local, "network.json"), `${remote}/network.json`]);
      await adb(["push", join(local, "subscription.yaml"), `${remote}/subscription.yaml`]);
    } catch (error) { await cleanup().catch(() => {}); throw error; }
    finally { await rm(local, { recursive: true, force: true }); subscription.fill(0); }
    return { soakSeconds: manifest.soakSeconds, cleanup,
      instructions: `Trusted apps have been verified/installed on this exact phone. Import ONLY supplied local files using ordinary file pickers: ${remote}/subscription.yaml in FlClash and ${remote}/network.json in SFA. These files contain secrets: do not open editors, previews, share, copy, export, read contents, or include credentials in notes/screenshots. Preserve unrelated profiles. Use FlClash local proxy port 7890, VPN OFF, Global mode; select group ${JSON.stringify(manifest.proxyGroup)}. ${manifest.proxyNode ? `Use ONLY approved node ${JSON.stringify(manifest.proxyNode)}.` : "Use only a proxy or proxy group from the supplied profile with an observed successful finite delay; never DIRECT, REJECT, an expired/quota notice entry, or an arbitrary new node. A failed check is a blocker, not permission for repeated node switches."} Confirm core running. SFA profile name sg-${target.requestId.slice(0, 18)}; use this profile as sole VPN, never activate official Tailscale, never exit node. Request owner assistance for Android VPN consent or unknown permissions and wait; never approve system VPN consent for the owner. Preserve SocialGrowth foreground service and wireless-debug pairing. Confirm running SFA and FlClash core independently at actual screens. Then read a fresh Facebook online response and observe public YouTube playback time advance at least 20 seconds. Login/consent needed by FB/YT is a blocker, no login or account changes. Each of these FOUR actual screen milestones requires an independent checkpoint while visible. No business actions, publication or acceptance claim. Stop UNCONFIRMED on loss of transport. Use system Home to switch apps, never swipe services away or use Back to close FlClash. Return exact JSON {"resultCode":"CONNECTIVITY_SETUP_COMPLETED" or "UNCONFIRMED","loginSubmitCount":0,"finalSubmitClicked":false}, save the same JSON in connectivity-test-result. The controller checks hardware and transport afterward; this is a bounded networking check, not long-term stability acceptance.` };
  }
}
