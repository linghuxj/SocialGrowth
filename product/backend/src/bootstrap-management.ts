import { isIP } from "node:net";
import type { Pool } from "pg";
import type { CurrentDeviceNetwork, DeviceConnectionNetworkAuthority, PilotDeviceNetworkScope } from "./device-connection-network.js";
import { readTailnetNode, tailnetAddress, type TailnetWhoIsPort } from "./tailscale-source-verifier.js";

/** A live network identity bound only after the already-paired ADB host has
 * verified the same hardware over this path. Not formal business admission. */
export class BootstrapManagement implements DeviceConnectionNetworkAuthority {
  constructor(private readonly pool: Pool, private readonly whois: TailnetWhoIsPort) {}
  async observe(address: string) {
    if (isIP(address) !== 4 || tailnetAddress(address) !== address) throw new Error("MANAGEMENT_ADDRESS_INVALID");
    const node = readTailnetNode(await this.whois.lookup(address, AbortSignal.timeout(2500)), address);
    if (!node) throw new Error("MANAGEMENT_NODE_UNAVAILABLE");
    return node;
  }
  async save(scope: PilotDeviceNetworkScope, address: string, node: { nodeId: string; nodeKey: string }, hardwareSerial: string): Promise<void> {
    await this.pool.query(`INSERT INTO socialgrowth_product.bootstrap_management_bindings
      (device_id,installation_id,installation_generation,ownership_version,node_id,node_key,address,hardware_serial)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(device_id) DO UPDATE SET installation_id=$2,installation_generation=$3,
      ownership_version=$4,node_id=$5,node_key=$6,address=$7,hardware_serial=$8,verified_at=clock_timestamp()`,
      [scope.deviceId,scope.installationId,scope.installationGeneration,scope.ownershipVersion,node.nodeId,node.nodeKey,address,hardwareSerial]);
  }
  async readCurrent(scope: PilotDeviceNetworkScope): Promise<CurrentDeviceNetwork | null> {
    try {
      const row = (await this.pool.query<{ node_id: string; node_key: string; address: string }>(
        `SELECT node_id,node_key,address FROM socialgrowth_product.bootstrap_management_bindings
         WHERE device_id=$1 AND installation_id=$2 AND installation_generation=$3 AND ownership_version=$4`,
        [scope.deviceId,scope.installationId,scope.installationGeneration,scope.ownershipVersion])).rows[0];
      if (!row) return null;
      const node = await this.observe(row.address);
      if (node.nodeId !== row.node_id || node.nodeKey !== row.node_key) return null;
      return { ...scope, mode: "managed_verified", tailnetNodeId: node.nodeId, tailnetNodeKey: node.nodeKey, tailnetAddress: row.address,
        observedAt: new Date().toISOString(), enrollmentId: null, enrollmentGeneration: null, enrollmentVersion: null, networkRevision: null };
    } catch { return null; }
  }
}
