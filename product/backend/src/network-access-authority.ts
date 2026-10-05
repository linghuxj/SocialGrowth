import { readPilotNetworkSetupConfig, type PilotNetworkSetupConfig } from "./network-setup-config.js";
import { readTailnetNode, tailnetAddress, type TailnetWhoIsPort } from "./tailscale-source-verifier.js";

export interface PilotDeviceNetworkScope {
  deviceId: string;
  providerId: string;
  installationId: string;
  installationGeneration: string;
  ownershipVersion: string;
  factVersion: string;
}

export interface CurrentDeviceNetworkAuthority extends PilotDeviceNetworkScope {
  enrollmentId: null;
  enrollmentGeneration: null;
  enrollmentVersion: null;
  tailnetNodeId: string;
  tailnetNodeKey: string;
  tailnetAddress: string;
  networkRevision: null;
  observedAt: string;
  mode: "pilot_verified";
}

export interface PilotWhoIsPort extends TailnetWhoIsPort {}

export function findPilotDevice(config: PilotNetworkSetupConfig, scope: PilotDeviceNetworkScope) {
  return config.devices.find(device => device.deviceId === scope.deviceId
    && device.providerId === scope.providerId
    && device.installationId === scope.installationId
    && device.installationGeneration === scope.installationGeneration) ?? null;
}

/** Read-only test binding. It never writes an admission record or policy and
 * deliberately returns no formal network revision or permission. */
export class PilotDeviceNetworkAuthority {
  constructor(private readonly configPath: string, private readonly whois: PilotWhoIsPort) {}

  async readCurrent(scope: PilotDeviceNetworkScope, signal = AbortSignal.timeout(2500)): Promise<CurrentDeviceNetworkAuthority | null> {
    const observedAt = new Date().toISOString();
    try {
      const config = await readPilotNetworkSetupConfig(this.configPath);
      const binding = findPilotDevice(config, scope);
      if (!binding || !binding.nodeId || !binding.tailnetAddress
        || tailnetAddress(binding.tailnetAddress) !== binding.tailnetAddress || signal.aborted) return null;
      const raw = await this.whois.lookup(binding.tailnetAddress, signal);
      const node = readTailnetNode(raw, binding.tailnetAddress);
      const completedAt = Date.now(), startedAt = Date.parse(observedAt);
      if (signal.aborted || !node || node.nodeId !== binding.nodeId || completedAt - startedAt >= 2500) return null;
      return {
        ...scope, enrollmentId: null, enrollmentGeneration: null, enrollmentVersion: null,
        tailnetNodeId: node.nodeId, tailnetNodeKey: node.nodeKey, tailnetAddress: binding.tailnetAddress,
        networkRevision: null, observedAt, mode: "pilot_verified",
      };
    } catch { return null; }
  }
}
