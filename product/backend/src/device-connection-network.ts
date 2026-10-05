export interface PilotDeviceNetworkScope {
  deviceId: string;
  providerId: string;
  installationId: string;
  installationGeneration: string;
  ownershipVersion: string;
  factVersion: string;
}

export interface CurrentDeviceNetwork {
  deviceId: string;
  providerId: string;
  installationId: string;
  installationGeneration: string;
  ownershipVersion: string;
  factVersion: string;
  tailnetNodeId: string;
  tailnetNodeKey: string;
  tailnetAddress: string;
  observedAt: string;
  mode: "pilot_verified" | "formal_admitted";
  enrollmentId: string | null;
  enrollmentGeneration: string | null;
  enrollmentVersion: number | null;
  networkRevision: number | null;
}

/** A live WhoIs-backed authority. Null is fail-closed and never means connected. */
export interface DeviceConnectionNetworkAuthority {
  readCurrent(scope: PilotDeviceNetworkScope, signal?: AbortSignal): Promise<CurrentDeviceNetwork | null>;
}
