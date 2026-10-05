import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { InstallationAuthService } from "./installation-auth-service.js";
import { ProviderAuthService } from "./provider-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { DeviceConnectionAdb, type AdbTarget } from "./device-connection-adb.js";
import { tailnetAddress } from "./tailscale-source-verifier.js";
import type { CurrentDeviceNetwork, DeviceConnectionNetworkAuthority, PilotDeviceNetworkScope } from "./device-connection-network.js";

const schema = "socialgrowth_product";
export const deviceConnectionProtocolVersion = "device-connection-v1" as const;
const metadataSchema = z.strictObject({ protocolVersion: z.literal(deviceConnectionProtocolVersion), requestId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/) });
const stateRequestSchema = metadataSchema;
const reportEndpointSchema = z.strictObject({ status: z.enum(["candidate", "withdrawn", "unknown"]), port: z.number().int().min(1).max(65535).nullable() })
  .refine(v => (v.status === "candidate") === (v.port !== null));
const reportRequestSchema = metadataSchema.extend({ sourceEpoch: z.string().uuid(),
  sequence: z.string().regex(/^[1-9][0-9]{0,18}$/), observedAt: z.string().datetime({ offset: true }),
  connect: reportEndpointSchema, pairing: reportEndpointSchema });
const epochRequestSchema = metadataSchema;
const providerStateRequestSchema = metadataSchema.extend({ deviceId: z.string().uuid() });
const pairRequestSchema = metadataSchema.extend({ idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/), deviceId: z.string().uuid(),
  expectedFactVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), pairingCode: z.string().regex(/^\d{6}$/) });

type DeviceScope = PilotDeviceNetworkScope & { deviceState: string; associationId: string };
interface ConnectionRow {
  device_id: string; provider_id: string; installation_id: string; association_id: string; authority_mode: string; network_binding_digest: Buffer;
  source_epoch: string; source_generation: string; endpoint_revision: string; source_sequence: string;
  last_report_request_id: string | null; last_report_digest: Buffer | null;
  connect_status: "candidate" | "withdrawn" | "unknown"; connect_port: number | null;
  pairing_status: "candidate" | "withdrawn" | "unknown"; pairing_port: number | null;
  endpoint_observed_at: Date | null; endpoint_received_at: Date | null;
  pairing_state: "not_started" | "awaiting_code" | "pairing" | "paired" | "expired" | "unknown";
  pairing_expires_at: Date | null; pairing_attempt_id: string | null;
  connection_state: "not_connected" | "connecting" | "connected" | "stale" | "unknown";
  connected_endpoint_revision: string | null; connected_at: Date | null; blocker_code: string | null;
}
interface PairAttemptRow { device_id: string; installation_id: string; expected_fact_version: string; network_binding_digest: Buffer; attempt_id: string; status: "processing" | "paired" | "connected" | "unknown" | "blocked"; blocker_code: string | null }

const stale = () => new ProductTransactionError("FACT_VERSION_STALE", "Device connection facts changed; inspect current status");
const denied = () => new ProductTransactionError("AUTHORIZATION_DENIED", "Device connection is unavailable");
const unavailable = () => new ProductTransactionError("INTERNAL_ERROR", "Device connection service is unavailable", true);
function digest(value: unknown): Buffer { return createHash("sha256").update(JSON.stringify(value), "utf8").digest(); }
function freshTime(value: string | Date | null, maximumAgeMs = 15_000): boolean {
  const at = typeof value === "string" ? Date.parse(value) : value?.getTime() ?? NaN, now = Date.now();
  return Number.isFinite(at) && at <= now && now - at <= maximumAgeMs;
}
// Android and center clocks can differ slightly even with automatic time.
// Bound skew and clamp persisted observations to receipt time, so a future
// client timestamp never extends endpoint validity.
function freshDeviceObservation(value: string, now: number): boolean {
  const at = Date.parse(value);
  return Number.isFinite(at) && at <= now + 5000 && now - at <= 15_000;
}
function freshNetwork(network: CurrentDeviceNetwork | null, scope: DeviceScope): network is CurrentDeviceNetwork {
  return !!network && network.deviceId === scope.deviceId && network.providerId === scope.providerId
    && network.installationId === scope.installationId && network.installationGeneration === scope.installationGeneration
    && network.ownershipVersion === scope.ownershipVersion && network.factVersion === scope.factVersion
    && (network.mode === "pilot_verified" || network.mode === "formal_admitted")
    && tailnetAddress(network.tailnetAddress) === network.tailnetAddress && freshTime(network.observedAt, 3000)
    && /^[A-Za-z0-9_-]{1,128}$/.test(network.tailnetNodeId)
    && /^nodekey:[a-f0-9]{64}$/.test(network.tailnetNodeKey);
}
function bindingDigest(network: CurrentDeviceNetwork): Buffer {
  return digest({ deviceId: network.deviceId, providerId: network.providerId, installationId: network.installationId,
    installationGeneration: network.installationGeneration, ownershipVersion: network.ownershipVersion, factVersion: network.factVersion,
    mode: network.mode, tailnetNodeId: network.tailnetNodeId, tailnetNodeKey: network.tailnetNodeKey,
    tailnetAddress: network.tailnetAddress, enrollmentId: network.enrollmentId, enrollmentGeneration: network.enrollmentGeneration,
    enrollmentVersion: network.enrollmentVersion, networkRevision: network.networkRevision });
}
async function transaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN"); await client.query("SET LOCAL lock_timeout='5s'"); await client.query("SET LOCAL statement_timeout='10s'");
    const result = await operation(client); await client.query("COMMIT"); return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { throw unavailable(); }
    if (error instanceof ProductTransactionError) throw error;
    throw unavailable();
  } finally { client.release(); }
}
function portsMatch(status: string, port: number | null): boolean { return (status === "candidate") === (port !== null); }

/** Provider/install APIs for network-pilot remote ADB setup. `pilot_verified`
 * remains distinct from formal admission and never grants business permission. */
export class DeviceConnectionApi {
  private readonly connectRetries = new Map<string, { target: string; nextAt: number }>();
  constructor(private readonly pool: Pool, private readonly installationAuth: InstallationAuthService,
    private readonly providerAuth: ProviderAuthService, private readonly network: DeviceConnectionNetworkAuthority | null,
    private readonly adb: DeviceConnectionAdb | null) {}

  onModuleDestroy(): void { this.adb?.close(); }

  async installationState(token: string, raw: unknown) {
    const request = stateRequestSchema.parse(raw), scope = await this.installationScope(token);
    return this.projectState(request.requestId, scope);
  }

  async providerState(token: string, raw: unknown) {
    const request = providerStateRequestSchema.parse(raw), scope = await this.providerScope(token, request.deviceId);
    return this.projectState(request.requestId, scope);
  }

  async beginEpoch(token: string, raw: unknown) {
    const request = epochRequestSchema.parse(raw), scope = await this.installationScope(token);
    const network = await this.readNetwork(scope);
    if (!network) throw denied();
    const targetDigest = bindingDigest(network), requestDigest = digest({ protocolVersion: request.protocolVersion, deviceId: scope.deviceId,
      installationId: scope.installationId, installationGeneration: scope.installationGeneration });
    return transaction(this.pool, async client => {
      const current = await this.installationScopeInTransaction(client, token);
      if (!sameScope(current, scope)) throw stale();
      const previousRequest = (await client.query<{ source_epoch: string; source_generation: string; request_digest: Buffer; endpoint_revision: string }>(
        `SELECT q.source_epoch,q.source_generation,q.request_digest,s.endpoint_revision::text FROM ${schema}.device_connection_epoch_requests q
         JOIN ${schema}.device_connection_states s ON s.device_id=q.device_id WHERE q.installation_id=$1 AND q.request_id=$2`,
        [scope.installationId, request.requestId])).rows[0];
      if (previousRequest) {
        if (!previousRequest.request_digest.equals(requestDigest)) throw stale();
        const state = await this.connectionRow(client, scope.deviceId, true);
        if (!state || state.source_epoch !== previousRequest.source_epoch || !state.network_binding_digest.equals(targetDigest)) throw stale();
        return this.epochResponse(scope.deviceId, state.source_epoch, Number(state.endpoint_revision));
      }
      const old = await this.connectionRow(client, scope.deviceId, true), epoch = randomUUID();
      const generation = BigInt(old?.source_generation ?? "0") + 1n;
      if (generation > BigInt(Number.MAX_SAFE_INTEGER)) throw stale();
      const preservePairing = old && old.installation_id === scope.installationId && old.network_binding_digest.equals(targetDigest)
        && ["paired", "pairing", "unknown"].includes(old.pairing_state);
      const endpointRevision = Number(old?.endpoint_revision ?? 0) + 1;
      if (!Number.isSafeInteger(endpointRevision)) throw stale();
      if (old) {
        await client.query(`UPDATE ${schema}.device_connection_states SET provider_id=$2,installation_id=$3,association_id=$4,authority_mode=$5,network_binding_digest=$6,
          source_epoch=$7,source_generation=$8,epoch_request_id=$9,endpoint_revision=$10,source_sequence='0',last_report_request_id=NULL,last_report_digest=NULL,
          connect_status='unknown',connect_port=NULL,pairing_status='unknown',pairing_port=NULL,endpoint_observed_at=NULL,endpoint_received_at=NULL,
          pairing_state=$11,pairing_expires_at=NULL,pairing_attempt_id=$12,connection_state=$13,connected_endpoint_revision=NULL,connected_at=NULL,
          blocker_code=$14,updated_at=clock_timestamp() WHERE device_id=$1`,
          [scope.deviceId, scope.providerId, scope.installationId, scope.associationId, network.mode, targetDigest, epoch, generation.toString(), request.requestId,
            endpointRevision, preservePairing ? old.pairing_state === "paired" ? "paired" : "unknown" : "not_started", preservePairing ? old.pairing_attempt_id : null,
            preservePairing ? old.pairing_state === "paired" ? "stale" : "unknown" : "not_connected",
            preservePairing ? old.pairing_state === "paired" ? "CONNECT_ENDPOINT_PENDING" : "ADB_PAIR_RESULT_UNKNOWN" : null]);
      } else {
        await client.query(`INSERT INTO ${schema}.device_connection_states(device_id,provider_id,installation_id,association_id,authority_mode,network_binding_digest,
          source_epoch,source_generation,epoch_request_id,endpoint_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [scope.deviceId, scope.providerId, scope.installationId, scope.associationId, network.mode, targetDigest, epoch, generation.toString(), request.requestId, endpointRevision]);
      }
      await client.query(`INSERT INTO ${schema}.device_connection_epoch_requests(installation_id,request_id,device_id,source_epoch,source_generation,request_digest)
        VALUES($1,$2,$3,$4,$5,$6)`, [scope.installationId, request.requestId, scope.deviceId, epoch, generation.toString(), requestDigest]);
      return this.epochResponse(scope.deviceId, epoch, endpointRevision);
    });
  }

  async report(token: string, raw: unknown) {
    const request = reportRequestSchema.parse(raw), scope = await this.installationScope(token);
    const network = await this.readNetwork(scope);
    if (!network) throw denied();
    const targetDigest = bindingDigest(network), reportDigest = digest({ ...request, requestId: undefined });
    const now = new Date();
    if (!freshDeviceObservation(request.observedAt, now.getTime())) throw stale();
    const result = await transaction(this.pool, async client => {
      const current = await this.installationScopeInTransaction(client, token);
      if (!sameScope(current, scope)) throw stale();
      const state = await this.connectionRow(client, scope.deviceId, true);
      if (!state || state.source_epoch !== request.sourceEpoch || !state.network_binding_digest.equals(targetDigest)) throw stale();
      if (!portsMatch(request.connect.status, request.connect.port) || !portsMatch(request.pairing.status, request.pairing.port)) throw stale();
      const received = (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]?.now;
      if (!received || !freshDeviceObservation(request.observedAt, received.getTime())) throw stale();
      const incomingSequence = BigInt(request.sequence), currentSequence = BigInt(state.source_sequence);
      if (incomingSequence === currentSequence && state.last_report_request_id === request.requestId && state.last_report_digest?.equals(reportDigest)) {
        return { duplicate: true, revision: Number(state.endpoint_revision) };
      }
      if (incomingSequence <= currentSequence) throw stale();
      const changed = state.connect_status !== request.connect.status || state.connect_port !== request.connect.port
        || state.pairing_status !== request.pairing.status || state.pairing_port !== request.pairing.port;
      const revision = Number(state.endpoint_revision) + (changed ? 1 : 0);
      const pairingState = state.pairing_state === "paired" ? "paired"
        : ["pairing", "unknown"].includes(state.pairing_state) ? state.pairing_state
          : request.pairing.status === "candidate" ? "awaiting_code" : "not_started";
      const connectionState = state.pairing_state === "paired" && request.connect.status === "candidate"
        ? changed || state.connection_state !== "connected" ? "stale" : "connected" : "not_connected";
      const connectedRevision = connectionState === "connected" ? state.connected_endpoint_revision : null;
      const connectedAt = connectionState === "connected" ? state.connected_at : null;
      await client.query(`UPDATE ${schema}.device_connection_states SET source_sequence=$2,last_report_request_id=$3,last_report_digest=$4,
        connect_status=$5,connect_port=$6,pairing_status=$7,pairing_port=$8,endpoint_observed_at=$9,endpoint_received_at=$10,endpoint_revision=$11,
        pairing_state=$12,pairing_expires_at=$13,connection_state=$14,connected_endpoint_revision=$15,connected_at=$16,
        blocker_code=$17,updated_at=clock_timestamp() WHERE device_id=$1`,
        [scope.deviceId, request.sequence, request.requestId, reportDigest, request.connect.status, request.connect.port,
          request.pairing.status, request.pairing.port, new Date(Math.min(Date.parse(request.observedAt), received.getTime(), Date.now())), received, revision, pairingState,
          pairingState === "awaiting_code" ? new Date(received.getTime() + 60_000) : null,
          connectionState, connectedRevision, connectedAt, connectionState === "stale" ? "CONNECT_ENDPOINT_PENDING" : null]);
      return { duplicate: false, revision };
    });
    if (!result.duplicate) await this.reconnectCurrent(scope.deviceId);
    return { protocolVersion: deviceConnectionProtocolVersion, deviceId: scope.deviceId, sourceEpoch: request.sourceEpoch,
      sequence: request.sequence, acceptedAt: now.toISOString(), endpointRevision: result.revision };
  }

  async pair(token: string, raw: unknown) {
    const request = pairRequestSchema.parse(raw), providerScope = await this.providerScope(token, request.deviceId);
    if (Number(providerScope.factVersion) !== request.expectedFactVersion) throw stale();
    const release = await this.lockDevice(providerScope.deviceId);
    try {
      const current = await this.providerScope(token, request.deviceId);
      if (!sameScope(current, providerScope) || current.deviceState === "paused" || ["exit_pending", "exited", "unassociated"].includes(current.deviceState)) throw denied();
      const network = await this.readNetwork(current);
      if (!network) throw denied();
      const digestValue = bindingDigest(network);
      const state = await this.currentConnectionState(current.deviceId);
      const existing = await this.pairAttempt(providerScope.providerId, request.idempotencyKey);
      if (existing && (existing.device_id !== current.deviceId || existing.installation_id !== current.installationId
        || existing.expected_fact_version !== current.factVersion || !existing.network_binding_digest.equals(digestValue))) throw stale();
      if (existing) return this.pairResponse(request.requestId, providerScope.deviceId, existing, null, request.expectedFactVersion);
      if (!state || state.connect_status !== "candidate" || state.pairing_status !== "candidate"
        || !state.connect_port || !state.pairing_port || !freshTime(state.endpoint_observed_at)
        || !state.pairing_expires_at || state.pairing_expires_at.getTime() <= Date.now()
        || state.authority_mode !== network.mode || !state.network_binding_digest.equals(digestValue)) throw denied();
      if (state.pairing_state === "paired") {
        return this.pairResponse(request.requestId, providerScope.deviceId, null, await this.currentConnectionState(providerScope.deviceId), request.expectedFactVersion);
      }
      if (["pairing", "unknown"].includes(state.pairing_state)) throw denied();
      if ((await this.pool.query(`SELECT attempt_id FROM ${schema}.device_connection_pair_attempts
        WHERE device_id=$1 AND installation_id=$2 AND status IN ('processing','unknown') LIMIT 1`,
        [current.deviceId,current.installationId])).rows.length) throw denied();
      if (!this.adb) throw denied();
      const attemptId = randomUUID();
      await transaction(this.pool, async client => {
        const latestScope = await this.providerScopeInTransaction(client, token, request.deviceId);
        if (!sameScope(latestScope, current) || Number(latestScope.factVersion) !== request.expectedFactVersion) throw stale();
        const latest = await this.connectionRow(client, current.deviceId, true);
        if (!latest || latest.source_epoch !== state.source_epoch || Number(latest.endpoint_revision) !== Number(state.endpoint_revision)
          || !latest.network_binding_digest.equals(digestValue) || !freshTime(latest.endpoint_observed_at)) throw stale();
        const duplicate = await client.query<{ attempt_id: string }>(`SELECT attempt_id FROM ${schema}.device_connection_pair_attempts WHERE provider_id=$1 AND idempotency_key=$2`,
          [current.providerId, request.idempotencyKey]);
        if (duplicate.rows[0]) throw stale();
        await client.query(`INSERT INTO ${schema}.device_connection_pair_attempts(attempt_id,provider_id,device_id,installation_id,request_id,idempotency_key,
          expected_fact_version,endpoint_revision,network_binding_digest,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'processing')`,
          [attemptId, current.providerId, current.deviceId, current.installationId, request.requestId, request.idempotencyKey,
            request.expectedFactVersion, Number(latest.endpoint_revision), digestValue]);
        await client.query(`UPDATE ${schema}.device_connection_states SET pairing_state='pairing',pairing_attempt_id=$2,connection_state='unknown',
          connected_endpoint_revision=NULL,connected_at=NULL,blocker_code='PAIRING_IN_PROGRESS',pairing_expires_at=clock_timestamp()+interval '60 seconds',updated_at=clock_timestamp() WHERE device_id=$1`,
          [current.deviceId, attemptId]);
      });

      const target: AdbTarget = { address: network.tailnetAddress, pairingPort: state.pairing_port, connectPort: state.connect_port };
      const paired = await this.adb!.pair(target, request.pairingCode);
      if (paired !== "paired") {
        await this.finishPairAttempt(attemptId, "unknown", "ADB_PAIR_RESULT_UNKNOWN", false);
        const unknown = await this.pairAttemptById(attemptId);
        return this.pairResponse(request.requestId, current.deviceId, unknown, await this.currentConnectionState(current.deviceId), request.expectedFactVersion);
      }
      await this.finishPairAttempt(attemptId, "paired", null, true);
      const freshScope = await this.providerScope(token, request.deviceId), freshNetwork = await this.readNetwork(freshScope);
      const latest = await this.currentConnectionState(current.deviceId);
      if (!sameScope(freshScope, current) || freshScope.deviceState === "paused" || !freshNetwork || !freshTime(freshNetwork.observedAt, 3000)
        || !bindingDigest(freshNetwork).equals(digestValue) || !latest || latest.source_epoch !== state.source_epoch
        || Number(latest.endpoint_revision) !== Number(state.endpoint_revision) || latest.connect_status !== "candidate" || !latest.connect_port
        || !freshTime(latest.endpoint_observed_at)) {
        const attempt = await this.pairAttemptById(attemptId);
        return this.pairResponse(request.requestId, current.deviceId, attempt, latest, request.expectedFactVersion);
      }
      const connected = await this.adb!.connectAndVerify(freshNetwork.tailnetAddress, latest.connect_port);
      const verifyScope = await this.providerScope(token, request.deviceId), verifyNetwork = await this.readNetwork(verifyScope);
      const finalState = await this.completeConnection(attemptId, current, verifyScope, verifyNetwork, latest, connected.state === "connected");
      const completed = await this.pairAttemptById(attemptId);
      return this.pairResponse(request.requestId, current.deviceId, completed, finalState, request.expectedFactVersion);
    } finally { await release(); }
  }

  private async projectState(requestId: string, scope: DeviceScope) {
    const [network, row] = await Promise.all([this.readNetwork(scope), this.currentConnectionState(scope.deviceId)]);
    const matchingRow = row && row.installation_id === scope.installationId && row.association_id === scope.associationId
      && row.provider_id === scope.providerId && row.network_binding_digest.equals(network ? bindingDigest(network) : Buffer.alloc(32)) ? row : null;
    const pairingState = matchingRow?.pairing_state === "pairing" && (!matchingRow.pairing_expires_at || matchingRow.pairing_expires_at.getTime() <= Date.now()) ? "unknown"
      : matchingRow?.pairing_state === "awaiting_code" && (!matchingRow.pairing_expires_at || matchingRow.pairing_expires_at.getTime() <= Date.now())
      ? "expired" : matchingRow?.pairing_state ?? "not_started";
    const networkState = network?.mode === "formal_admitted" ? "admitted" : network?.mode ?? "blocked";
    const blockerCode = ["exit_pending", "exited", "unassociated", "paused"].includes(scope.deviceState) ? "DEVICE_NOT_ACTIVE"
      : !network ? "NETWORK_AUTHORITY_UNAVAILABLE"
        : matchingRow?.blocker_code ?? (pairingState === "awaiting_code" ? null : "PAIRING_REQUIRED");
    return { protocolVersion: deviceConnectionProtocolVersion, requestId, deviceId: scope.deviceId, networkState,
      pairingState, connectionState: !["associated_pending_access", "access_ready"].includes(scope.deviceState) ? "not_connected"
        : matchingRow?.connection_state === "connected" && (!freshTime(matchingRow.endpoint_observed_at) || !freshTime(matchingRow.connected_at)) ? "stale"
          : matchingRow?.connection_state ?? "not_connected", blockerCode,
      factVersion: Number(scope.factVersion), pairingExpiresAt: matchingRow?.pairing_expires_at?.toISOString() ?? null,
      endpointObservedAt: matchingRow?.endpoint_observed_at?.toISOString() ?? null };
  }

  private epochResponse(deviceId: string, sourceEpoch: string, endpointRevision: number) {
    return { protocolVersion: deviceConnectionProtocolVersion, deviceId, sourceEpoch, endpointRevision, sequence: "0" };
  }

  private pairResponse(requestId: string, deviceId: string, attempt: PairAttemptRow | null, state: ConnectionRow | null, factVersion: number) {
    const pairingState = attempt ? ["paired", "connected"].includes(attempt.status) ? "paired" : attempt.status === "processing" ? "pairing" : "unknown"
      : state?.pairing_state ?? "unknown";
    const connectionState = attempt ? attempt.status === "connected" ? "connected" : "unknown" : state?.connection_state ?? "unknown";
    const blockerCode = attempt?.blocker_code ?? state?.blocker_code ?? null;
    return { protocolVersion: deviceConnectionProtocolVersion, requestId, deviceId, pairingState, connectionState, blockerCode,
      factVersion };
  }

  private async readNetwork(scope: DeviceScope): Promise<CurrentDeviceNetwork | null> {
    if (!this.network || !["associated_pending_access", "access_ready"].includes(scope.deviceState)) return null;
    try {
      const result = await this.network.readCurrent({ ...scope, factVersion: scope.ownershipVersion }, AbortSignal.timeout(2500));
      return freshNetwork(result, { ...scope, factVersion: scope.ownershipVersion }) ? result : null;
    } catch { return null; }
  }

  private async installationScope(token: string): Promise<DeviceScope> {
    return transaction(this.pool, client => this.installationScopeInTransaction(client, token));
  }
  private async installationScopeInTransaction(client: PoolClient, token: string): Promise<DeviceScope> {
    const initial = await this.installationAuth.authenticate(token, client);
    const locator = (await client.query<{ provider_id: string }>(`SELECT provider_id FROM ${schema}.device_associations WHERE installation_id=$1 AND ended_at IS NULL`,
      [initial.installationId])).rows[0];
    if (!locator) throw denied();
    const provider = (await client.query<{ status: string }>(`SELECT status FROM ${schema}.providers WHERE provider_id=$1 FOR UPDATE`, [locator.provider_id])).rows[0];
    await client.query(`SELECT installation_id FROM ${schema}.installations WHERE installation_id=$1 FOR UPDATE`, [initial.installationId]);
    const current = await this.installationAuth.authenticate(token, client);
    if (current.installationId !== initial.installationId || current.installationGeneration !== initial.installationGeneration || provider?.status !== "active") throw denied();
    const row = (await client.query<{ device_id: string; provider_id: string; association_id: string; device_state: string; fact_version: string; installation_generation: string; installation_status: string }>(
      `SELECT d.device_id,d.fact_version::text,d.state AS device_state,a.provider_id,a.association_id,i.generation::text AS installation_generation,i.status AS installation_status
       FROM ${schema}.device_associations a JOIN ${schema}.devices d ON d.device_id=a.device_id JOIN ${schema}.installations i ON i.installation_id=a.installation_id
       WHERE a.installation_id=$1 AND a.ended_at IS NULL FOR UPDATE OF a,d`, [current.installationId])).rows[0];
    if (!row || row.installation_generation !== current.installationGeneration.toString() || row.installation_status !== "active") throw denied();
    return { deviceId: row.device_id, providerId: row.provider_id, installationId: current.installationId,
      installationGeneration: row.installation_generation, ownershipVersion: row.fact_version, factVersion: row.fact_version, associationId: row.association_id, deviceState: row.device_state };
  }
  private async providerScope(token: string, deviceId: string): Promise<DeviceScope> {
    return transaction(this.pool, client => this.providerScopeInTransaction(client, token, deviceId));
  }
  private async providerScopeInTransaction(client: PoolClient, token: string, deviceId: string): Promise<DeviceScope> {
    const auth = await this.providerAuth.authenticateSessionInTransaction(client, token);
    const row = (await client.query<{ installation_id: string; installation_generation: string; association_id: string; device_state: string;
      fact_version: string; installation_status: string }>(`SELECT a.installation_id,i.generation::text AS installation_generation,a.association_id,d.state AS device_state,
       d.fact_version::text,i.status AS installation_status FROM ${schema}.device_associations a JOIN ${schema}.devices d ON d.device_id=a.device_id
       JOIN ${schema}.installations i ON i.installation_id=a.installation_id WHERE a.provider_id=$1 AND a.device_id=$2 AND a.ended_at IS NULL FOR SHARE OF a,d,i`,
      [auth.providerId, deviceId])).rows[0];
    if (!row || row.installation_status !== "active") throw denied();
    return { deviceId, providerId: auth.providerId, installationId: row.installation_id, installationGeneration: row.installation_generation,
      ownershipVersion: row.fact_version, factVersion: row.fact_version, associationId: row.association_id, deviceState: row.device_state } as DeviceScope;
  }

  private async connectionRow(client: PoolClient, deviceId: string, lock = false): Promise<ConnectionRow | null> {
    const row = (await client.query<ConnectionRow>(`SELECT * FROM ${schema}.device_connection_states WHERE device_id=$1${lock ? " FOR UPDATE" : ""}`, [deviceId])).rows[0];
    return row ?? null;
  }
  private async currentConnectionState(deviceId: string): Promise<ConnectionRow | null> {
    try { const result = await this.pool.query<ConnectionRow>(`SELECT * FROM ${schema}.device_connection_states WHERE device_id=$1`, [deviceId]); return result.rows[0] ?? null; }
    catch { throw unavailable(); }
  }
  private async pairAttempt(providerId: string, key: string): Promise<PairAttemptRow | null> {
    try { return (await this.pool.query<PairAttemptRow>(`SELECT device_id,installation_id,expected_fact_version::text,network_binding_digest,attempt_id,status,blocker_code FROM ${schema}.device_connection_pair_attempts WHERE provider_id=$1 AND idempotency_key=$2`, [providerId,key])).rows[0] ?? null; }
    catch { throw unavailable(); }
  }
  private async pairAttemptById(id: string): Promise<PairAttemptRow> {
    try { const row = (await this.pool.query<PairAttemptRow>(`SELECT device_id,installation_id,expected_fact_version::text,network_binding_digest,attempt_id,status,blocker_code FROM ${schema}.device_connection_pair_attempts WHERE attempt_id=$1`, [id])).rows[0]; if (!row) throw unavailable(); return row; }
    catch { throw unavailable(); }
  }
  private async finishPairAttempt(id: string, status: PairAttemptRow["status"], blocker: string | null, paired: boolean) {
    await transaction(this.pool, async client => {
      const attempt = (await client.query<PairAttemptRow & { device_id: string }>(`SELECT attempt_id,device_id,status,blocker_code FROM ${schema}.device_connection_pair_attempts WHERE attempt_id=$1 FOR UPDATE`, [id])).rows[0];
      if (!attempt) throw unavailable();
      await client.query(`UPDATE ${schema}.device_connection_pair_attempts SET status=$2,blocker_code=$3,updated_at=clock_timestamp() WHERE attempt_id=$1`, [id,status,blocker]);
      if (paired) await client.query(`UPDATE ${schema}.device_connection_states SET pairing_state='paired',pairing_expires_at=NULL,connection_state='stale',
        connected_endpoint_revision=NULL,connected_at=NULL,blocker_code='CONNECT_ENDPOINT_PENDING',updated_at=clock_timestamp() WHERE device_id=$1 AND pairing_attempt_id=$2`, [attempt.device_id,id]);
      else await client.query(`UPDATE ${schema}.device_connection_states SET pairing_state='unknown',connection_state='unknown',blocker_code=$2,updated_at=clock_timestamp() WHERE device_id=$1 AND pairing_attempt_id=$3`,
        [attempt.device_id,blocker,id]);
    });
  }

  private async reconnectCurrent(deviceId: string): Promise<void> {
    if (!this.adb) return;
    const release = await this.lockDevice(deviceId);
    try {
      const state = await this.currentConnectionState(deviceId);
      if (!state || state.pairing_state === "pairing" || state.connect_status !== "candidate" || !state.connect_port
        || !freshTime(state.endpoint_observed_at)) return;
      const scope = await this.providerScopeByIdentity(state.provider_id, deviceId);
      if (!scope || scope.deviceState === "paused") return;
      const network = await this.readNetwork(scope);
      if (!network || !bindingDigest(network).equals(state.network_binding_digest)) return;
      await this.adb.renewTransport(network.tailnetAddress, state.connect_port);
      const target = `${state.source_epoch}/${state.connect_port}`;
      const retry = this.connectRetries.get(deviceId);
      if (retry?.target === target && Date.now() < retry.nextAt) return;
      this.connectRetries.set(deviceId, { target, nextAt: Date.now() + 30_000 });
      const result = await this.adb.connectAndVerify(network.tailnetAddress, state.connect_port);
      this.connectRetries.set(deviceId, { target, nextAt: Date.now() + (result.state === "connected" ? 8000 : 30_000) });
      const latestScope = await this.providerScopeByIdentity(state.provider_id, deviceId), latestNetwork = latestScope ? await this.readNetwork(latestScope) : null;
      const latest = await this.currentConnectionState(deviceId);
      if (!latestScope || !latestNetwork || !latest || latest.source_epoch !== state.source_epoch || latest.endpoint_revision !== state.endpoint_revision
        || latest.connect_port !== state.connect_port || latest.pairing_state === "pairing" || !bindingDigest(latestNetwork).equals(state.network_binding_digest)) return;
      await transaction(this.pool, async client => {
        const locked = await this.connectionRow(client, deviceId, true);
        if (!locked || locked.source_epoch !== state.source_epoch || locked.endpoint_revision !== state.endpoint_revision
          || locked.connect_port !== state.connect_port || locked.pairing_state === "pairing") return;
        const isConnected = result.state === "connected";
        await client.query(`UPDATE ${schema}.device_connection_states SET connection_state=$2,connected_endpoint_revision=$3,connected_at=$4,blocker_code=$5,
          pairing_state=CASE WHEN $2='connected' THEN 'paired' ELSE pairing_state END,verified_hardware_serial=$6,updated_at=clock_timestamp() WHERE device_id=$1`,
          [deviceId, isConnected ? "connected" : "unknown", isConnected ? Number(locked.endpoint_revision) : null, isConnected ? new Date() : null,
            isConnected ? null : "CENTER_ADB_UNAVAILABLE", result.state === "connected" ? result.hardwareSerial : null]);
        if (isConnected) await client.query(`UPDATE ${schema}.device_connection_pair_attempts SET status='connected',blocker_code=NULL,updated_at=clock_timestamp()
          WHERE device_id=$1 AND installation_id=$2 AND status IN ('processing','unknown','paired') AND network_binding_digest=$3`,
          [deviceId,latestScope.installationId,state.network_binding_digest]);
      });
    } finally { await release(); }
  }
  private async providerScopeByIdentity(providerId: string, deviceId: string): Promise<DeviceScope | null> {
    try {
      const row = (await this.pool.query<{ installation_id: string; installation_generation: string; association_id: string; device_state: string; fact_version: string }>(
        `SELECT a.installation_id,i.generation::text AS installation_generation,a.association_id,d.state AS device_state,d.fact_version::text FROM ${schema}.device_associations a
         JOIN ${schema}.installations i ON i.installation_id=a.installation_id JOIN ${schema}.devices d ON d.device_id=a.device_id
         JOIN ${schema}.providers p ON p.provider_id=a.provider_id WHERE a.provider_id=$1 AND a.device_id=$2 AND a.ended_at IS NULL AND i.status='active' AND p.status='active'`,
        [providerId, deviceId])).rows[0];
      return row ? { deviceId, providerId, installationId: row.installation_id, installationGeneration: row.installation_generation,
        ownershipVersion: row.fact_version, factVersion: row.fact_version, associationId: row.association_id, deviceState: row.device_state } as DeviceScope : null;
    } catch { return null; }
  }
  private async completeConnection(attemptId: string, original: DeviceScope, scope: DeviceScope, network: CurrentDeviceNetwork | null, old: ConnectionRow, connected: boolean): Promise<ConnectionRow | null> {
    const stillCurrent = sameScope(original, scope) && network && freshNetwork(network, scope) && bindingDigest(network).equals(old.network_binding_digest);
    return transaction(this.pool, async client => {
      const attempt = (await client.query<{ device_id: string }>(`SELECT device_id FROM ${schema}.device_connection_pair_attempts WHERE attempt_id=$1 FOR UPDATE`, [attemptId])).rows[0];
      const row = attempt ? await this.connectionRow(client, attempt.device_id, true) : null;
      if (!attempt || !row || row.source_epoch !== old.source_epoch || row.endpoint_revision !== old.endpoint_revision || !stillCurrent
        || row.pairing_state !== "paired" || row.connect_port !== old.connect_port) {
        await client.query(`UPDATE ${schema}.device_connection_pair_attempts SET status='unknown',blocker_code='DEVICE_SCOPE_CHANGED',updated_at=clock_timestamp() WHERE attempt_id=$1`, [attemptId]);
        return row;
      }
      await client.query(`UPDATE ${schema}.device_connection_pair_attempts SET status=$2,blocker_code=$3,updated_at=clock_timestamp() WHERE attempt_id=$1`,
        [attemptId, connected ? "connected" : "paired", connected ? null : "CENTER_ADB_UNAVAILABLE"]);
      await client.query(`UPDATE ${schema}.device_connection_states SET connection_state=$2,connected_endpoint_revision=$3,connected_at=$4,
        blocker_code=$5,updated_at=clock_timestamp() WHERE device_id=$1`, [attempt.device_id, connected ? "connected" : "unknown",
        connected ? Number(row.endpoint_revision) : null, connected ? new Date() : null, connected ? null : "CENTER_ADB_UNAVAILABLE"]);
      return this.connectionRow(client, attempt.device_id);
    });
  }
  private async lockDevice(deviceId: string): Promise<() => Promise<void>> {
    const client = await this.pool.connect();
    try {
      const result = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked", [`device-connection:${deviceId}`]);
      if (!result.rows[0]?.locked) throw unavailable();
      return async () => { try { await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [`device-connection:${deviceId}`]); } finally { client.release(); } };
    } catch { client.release(); throw unavailable(); }
  }
}

function sameScope(left: DeviceScope, right: DeviceScope): boolean {
  return left.deviceId === right.deviceId && left.providerId === right.providerId && left.installationId === right.installationId
    && left.installationGeneration === right.installationGeneration && left.ownershipVersion === right.ownershipVersion
    && left.factVersion === right.factVersion && (left as DeviceScope & { associationId?: string }).associationId === (right as DeviceScope & { associationId?: string }).associationId;
}
