import { z, ZodError } from "zod";
import type { InstallationAuthService } from "./installation-auth-service.js";
import { bearerTokenFrom } from "./product-http.js";
import { NetworkAdmissionStore } from "./network-admission-store.js";
import { readPilotAuthKeyFile, readPilotNetworkSetupConfig, PilotNetworkSetupConfigError } from "./network-setup-config.js";
import { AdmissionError } from "./network-admission-core.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { findPilotDevice, PilotDeviceNetworkAuthority, type PilotWhoIsPort } from "./network-access-authority.js";

export const networkSetupContractVersion = "android-network-setup-v1" as const;
const requestSchema = z.strictObject({ contractVersion: z.literal(networkSetupContractVersion) });
export type NetworkSetupRoute = "state" | "key";
export interface NetworkSetupHttpResult { status: number; body: unknown }

/** Installation-scoped pilot network setup. The shared AuthKey is disclosed
 * only by an explicit key request and is never stored or logged here. */
export class NetworkSetupApi {
  private readonly authority: PilotDeviceNetworkAuthority;
  constructor(private readonly store: NetworkAdmissionStore, private readonly auth: InstallationAuthService,
    private readonly configPath: string, whois: PilotWhoIsPort, private readonly authKeyPath: string | null = null) {
    this.authority = new PilotDeviceNetworkAuthority(configPath, whois);
  }

  async handle(route: NetworkSetupRoute, body: unknown, authorization: string | undefined): Promise<NetworkSetupHttpResult> {
    try {
      requestSchema.parse(body);
      const token = bearerTokenFrom(authorization, "Installation");
      const state = await this.store.authenticatedState(this.auth, token);
      let config;
      try { config = await readPilotNetworkSetupConfig(this.configPath); }
      catch (error) {
        if (error instanceof PilotNetworkSetupConfigError) {
          return route === "state"
            ? { status: 200, body: { contractVersion: networkSetupContractVersion, state: "blocked", blockerCode: error.code, node: null } }
            : { status: 503, body: { contractVersion: networkSetupContractVersion, error: { code: error.code } } };
        }
        throw error;
      }
      const scope = { ...state.scope, factVersion: state.scope.ownershipVersion };
      const binding = findPilotDevice(config, scope);
      if (!binding) {
        return route === "state"
          ? { status: 200, body: { contractVersion: networkSetupContractVersion, state: "blocked", blockerCode: "DEVICE_NOT_IN_PILOT_ALLOWLIST", node: null } }
          : { status: 403, body: { contractVersion: networkSetupContractVersion, error: { code: "DEVICE_NOT_IN_PILOT_ALLOWLIST" } } };
      }
      if (route === "key") {
        try {
          const authKey = await readPilotAuthKeyFile(this.authKeyPath, config.authKeyExpiresAt);
          return { status: 200, body: { contractVersion: networkSetupContractVersion, key: authKey.key,
            expiresAt: authKey.expiresAt, usage: "pilot_shared" } };
        } catch { return { status: 503, body: { contractVersion: networkSetupContractVersion,
          error: { code: "PILOT_AUTH_KEY_UNAVAILABLE" } } }; }
      }
      if (!binding.nodeId || !binding.tailnetAddress) {
        return { status: 200, body: { contractVersion: networkSetupContractVersion, state: "waiting_for_network",
          blockerCode: "PILOT_NODE_PIN_REQUIRED", node: null } };
      }
      const current = await this.authority.readCurrent(scope);
      if (!current) {
        return { status: 200, body: { contractVersion: networkSetupContractVersion, state: "waiting_for_network",
          blockerCode: "TAILNET_NODE_NOT_OBSERVED", node: null } };
      }
      return { status: 200, body: { contractVersion: networkSetupContractVersion, state: "connected",
        blockerCode: null, mode: current.mode, formalNetworkAdmission: false,
        node: { nodeId: current.tailnetNodeId, tailnetAddress: current.tailnetAddress } } };
    } catch (error) {
      if (error instanceof ZodError) return { status: 400, body: { contractVersion: networkSetupContractVersion, error: { code: "INPUT_INVALID" } } };
      if (error instanceof ProductTransactionError) {
        const status = error.code === "AUTHENTICATION_REQUIRED" || error.code === "INVALID_CREDENTIALS" ? 401 : 403;
        return { status, body: { contractVersion: networkSetupContractVersion, error: { code: status === 401 ? "AUTHENTICATION_REQUIRED" : "AUTHORITY_CHANGED" } } };
      }
      if (error instanceof AdmissionError) return { status: 403,
        body: { contractVersion: networkSetupContractVersion, error: { code: "AUTHORITY_CHANGED" } } };
      return { status: 500, body: { contractVersion: networkSetupContractVersion, error: { code: "INTERNAL_ERROR" } } };
    }
  }
}
