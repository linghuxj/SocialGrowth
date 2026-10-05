import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { z } from "zod";
import { tailnetAddress } from "./tailscale-source-verifier.js";

const pilotDeviceSchema = z.strictObject({
  deviceId: z.string().uuid(),
  providerId: z.string().uuid(),
  installationId: z.string().uuid(),
  installationGeneration: z.string().regex(/^[1-9][0-9]{0,18}$/),
  nodeId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).nullable(),
  tailnetAddress: z.string().max(64).refine(value => tailnetAddress(value) === value).nullable(),
}).superRefine((device, context) => {
  if ((device.nodeId === null) !== (device.tailnetAddress === null)) {
    context.addIssue({ code: "custom", path: ["nodeId"], message: "Node ID and Tailnet address must be pinned together" });
  }
});
const configSchema = z.strictObject({
  authKeyExpiresAt: z.string().datetime({ offset: true }).nullable(),
  devices: z.array(pilotDeviceSchema).max(50),
}).superRefine((config, context) => {
  const deviceIds = new Set<string>(), nodeIds = new Set<string>(), addresses = new Set<string>();
  config.devices.forEach((device, index) => {
    if (deviceIds.has(device.deviceId) || (device.nodeId !== null && nodeIds.has(device.nodeId))
      || (device.tailnetAddress !== null && addresses.has(device.tailnetAddress))) {
      context.addIssue({ code: "custom", path: ["devices", index], message: "Pilot device bindings must be unique" });
    }
    deviceIds.add(device.deviceId);
    if (device.nodeId !== null) nodeIds.add(device.nodeId);
    if (device.tailnetAddress !== null) addresses.add(device.tailnetAddress);
  });
});

export type PilotNetworkSetupConfig = z.infer<typeof configSchema>;
export interface PilotAuthKey { key: string; expiresAt: string }
export class PilotNetworkSetupConfigError extends Error {
  constructor(readonly code: "PILOT_CONFIG_UNAVAILABLE") { super(code); }
}

/** Private, owner-only test configuration. Nothing is cached or logged. */
export async function readPilotNetworkSetupConfig(path: string): Promise<PilotNetworkSetupConfig> {
  try {
    const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await fd.stat();
      if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || stat.size > 32_768) throw new Error();
      return configSchema.parse(JSON.parse(await fd.readFile("utf8")));
    } finally { await fd.close(); }
  } catch { throw new PilotNetworkSetupConfigError("PILOT_CONFIG_UNAVAILABLE"); }
}

/** The fixed pilot key is separate from the node allowlist, optional, and read
 * only when an authenticated installation explicitly requests it. */
export async function readPilotAuthKeyFile(path: string | null, expiresAt: string | null, now = Date.now()): Promise<PilotAuthKey> {
  if (!path || !expiresAt || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now) {
    throw new PilotNetworkSetupConfigError("PILOT_CONFIG_UNAVAILABLE");
  }
  try {
    const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await fd.stat();
      if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || stat.size > 512) throw new Error();
      const key = (await fd.readFile("utf8")).trim();
      if (!/^tskey-auth-[A-Za-z0-9_-]{20,240}$/.test(key)) throw new Error();
      return { key, expiresAt };
    } finally { await fd.close(); }
  } catch { throw new PilotNetworkSetupConfigError("PILOT_CONFIG_UNAVAILABLE"); }
}
