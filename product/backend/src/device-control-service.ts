import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { deviceControlSnapshotSchema, installationSelfControlCommandRequestSchema, providerDeviceControlCommandRequestSchema } from "@socialgrowth/product-contracts";
import { InstallationAuthService } from "./installation-auth-service.js";
import { parsePhoneControlRecord, type PhoneControlRecord } from "./action-permission-core.js";
import { PhoneControlJournal } from "./phone-control-journal.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { ProviderAuthService } from "./provider-auth-service.js";

const s = "socialgrowth_product";
const responseRetentionMs = 24 * 60 * 60 * 1000;
type Intent = "active" | "pause_requested" | "paused" | "resume_requested" | "exit_pending" | "exited";
type Stop = "not_requested" | "requested" | "confirmed" | "unknown";
interface DeviceRow { device_id: string; fact_version: string; state: string }
interface IntentRow { request_id: string; action: string; occurred_at: Date }
interface CachedCommand { request_digest: Buffer; response_available_until: Date; response_body: unknown; status: string }

const unavailable = () => new ProductTransactionError("INTERNAL_ERROR", "Device control is unavailable", true);
const denied = () => new ProductTransactionError("AUTHORIZATION_DENIED", "Current device control authority is unavailable");
const stale = () => new ProductTransactionError("FACT_VERSION_STALE", "Current device control facts changed; inspect current state", true);
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest();

async function databaseNow(client: PoolClient): Promise<Date> {
  const row = (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0];
  if (!row?.now) throw unavailable();
  return row.now;
}

async function currentDeviceControl(client: PoolClient, device: DeviceRow) {
  const journalRow = (await client.query<{ record: unknown }>(`SELECT record FROM ${s}.phone_control_journals WHERE device_id=$1`, [device.device_id])).rows[0];
  let record: PhoneControlRecord | null = null;
  if (journalRow) {
    record = parsePhoneControlRecord(journalRow.record);
    if (record.deviceId !== device.device_id) throw unavailable();
  }
  const latest = (await client.query<IntentRow>(`SELECT request_id,action,occurred_at FROM ${s}.audit_records
    WHERE object_type='device' AND object_id=$1 AND action IN
      ('provider_device_control.pause_requested','provider_device_control.resume_requested','installation_device_control.pause_requested')
    ORDER BY occurred_at DESC,audit_record_id DESC LIMIT 1`, [device.device_id])).rows[0] ?? null;
  const intent: Intent = device.state === "exit_pending" || device.state === "exited"
    ? device.state
    : latest?.action.endsWith("resume_requested") ? "resume_requested"
      : latest?.action.endsWith("pause_requested") ? record?.disposition === "stopped" ? "paused" : "pause_requested"
        : device.state === "paused" ? record?.disposition === "stopped" ? "paused" : "pause_requested"
          : "active";
  const stop: Stop = !record || record.disposition === "enabled" ? "not_requested"
    : record.disposition === "stopped" ? "confirmed"
      : record.calls.some(call => call.status === "unknown") ? "unknown" : "requested";
  return deviceControlSnapshotSchema.parse({
    contractVersion: "2026-09-29.identity-v1", deviceId: device.device_id,
    requestId: latest?.request_id ?? null, intent, controlVersion: record?.version ?? null,
    controlGeneration: record?.controlGeneration ?? null, stop,
    unresolvedActionCount: record?.calls.filter(call => call.status !== "ended").length ?? 0,
    checkedAt: (await databaseNow(client)).toISOString(),
  });
}

async function currentDevice(client: PoolClient, deviceId: string, providerId?: string, installationId?: string, lock = false): Promise<DeviceRow> {
  const target = providerId
    ? `a.provider_id=$2 AND a.device_id=$1 AND a.ended_at IS NULL`
    : `a.installation_id=$2 AND a.device_id=$1 AND a.ended_at IS NULL`;
  const values = [deviceId, providerId ?? installationId];
  const result = await client.query<DeviceRow>(`SELECT d.device_id,d.fact_version::text,d.state
      FROM ${s}.device_associations a JOIN ${s}.devices d ON d.device_id=a.device_id
      WHERE ${target}${lock ? " FOR UPDATE OF a,d" : ""}`, values);
  const row = result.rows[0];
  if (!row) throw denied();
  return row;
}

async function currentInstallationDevice(client: PoolClient, installationId: string, lock = false): Promise<DeviceRow> {
  const row = (await client.query<DeviceRow>(`SELECT d.device_id,d.fact_version::text,d.state FROM ${s}.device_associations a
    JOIN ${s}.devices d ON d.device_id=a.device_id WHERE a.installation_id=$1 AND a.ended_at IS NULL${lock ? " FOR UPDATE OF a,d" : ""}`, [installationId])).rows[0];
  if (!row) throw denied();
  return row;
}

async function findCachedCommand(client: PoolClient, operation: string, principalType: "provider" | "installation", principalId: string, idempotencyKey: string, requestDigest: Buffer, now: Date) {
  const inserted = await client.query(`INSERT INTO ${s}.idempotency_requests
    (idempotency_request_id,operation,principal_type,principal_id,idempotency_key,request_digest,status,created_at,response_available_until)
    VALUES($1,$2,$3,$4,$5,$6,'processing',$7,$8)
    ON CONFLICT(operation,principal_type,principal_id,idempotency_key) DO NOTHING`,
  [randomUUID(),operation,principalType,principalId,idempotencyKey,requestDigest,now,new Date(now.getTime()+responseRetentionMs)]);
  if (inserted.rowCount === 1) return null;
  const cached = (await client.query<CachedCommand>(`SELECT request_digest,response_available_until,response_body,status FROM ${s}.idempotency_requests
    WHERE operation=$1 AND principal_type=$2 AND principal_id=$3 AND idempotency_key=$4 FOR UPDATE`,
  [operation,principalType,principalId,idempotencyKey])).rows[0];
  if (!cached || !cached.request_digest.equals(requestDigest)) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Idempotency key was already used for another request");
  if (cached.status !== "succeeded") throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "The original request is still processing", true);
  if (cached.response_available_until <= now || cached.response_body === null) throw new ProductTransactionError("IDEMPOTENCY_RESULT_EXPIRED", "The original request result expired; inspect current state");
  return cached;
}

async function completeCommand(client: PoolClient, operation: string, principalType: "provider" | "installation", principalId: string, idempotencyKey: string, snapshot: unknown, deviceId: string) {
  await client.query(`UPDATE ${s}.idempotency_requests SET status='succeeded',response_status=200,response_body=$5,result_object_type='device',result_object_id=$6
    WHERE operation=$1 AND principal_type=$2 AND principal_id=$3 AND idempotency_key=$4`, [operation,principalType,principalId,idempotencyKey,snapshot,deviceId]);
}

export class DeviceControlService {
  private readonly journal: PhoneControlJournal;
  constructor(private readonly pool: Pool, private readonly providerAuth: ProviderAuthService, private readonly installationAuth: InstallationAuthService) {
    this.journal = new PhoneControlJournal(pool);
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient;
    try { client = await this.pool.connect(); } catch { throw unavailable(); }
    try {
      await client.query("BEGIN"); await client.query("SET LOCAL lock_timeout='5s'"); await client.query("SET LOCAL statement_timeout='10s'");
      const result = await work(client); await client.query("COMMIT"); return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { throw unavailable(); }
      if (error instanceof ProductTransactionError) throw error;
      throw unavailable();
    } finally { client.release(); }
  }

  async providerRead(token: string, deviceId: string) {
    return this.transaction(async client => {
      const principal = await this.providerAuth.authenticateSessionInTransaction(client, token);
      const device = await currentDevice(client, deviceId, principal.providerId, undefined, true);
      return currentDeviceControl(client, device);
    });
  }

  async installationRead(token: string) {
    return this.transaction(async client => {
      const principal = await this.installationAuth.authenticate(token, client);
      // Resolve the target from the signed installation identity; no caller target is accepted.
      const device = await currentInstallationDevice(client, principal.installationId, true);
      return currentDeviceControl(client, device);
    });
  }

  async providerCommand(token: string, deviceId: string, kind: "pause" | "resume", raw: unknown) {
    const parsed = providerDeviceControlCommandRequestSchema.parse(raw), request = parsed.metadata;
    return this.transaction(async client => {
      const principal = await this.providerAuth.authenticateSessionInTransaction(client, token);
      const device = await currentDevice(client, deviceId, principal.providerId, undefined, true);
      const now = await databaseNow(client), operation = `provider_device_control.${kind}`;
      const cached = await findCachedCommand(client, operation, "provider", principal.providerId, request.idempotencyKey, digest(parsed), now);
      const snapshot = await currentDeviceControl(client, device);
      if (cached) return deviceControlSnapshotSchema.parse({ ...snapshot, requestId: request.requestId });
      if (device.state === "exit_pending" || device.state === "exited") throw denied();
      if (kind === "pause") {
        if (device.state !== "paused") {
          await client.query(`UPDATE ${s}.devices SET state='paused',fact_version=fact_version+1,updated_at=$2 WHERE device_id=$1`, [device.device_id,now]);
          device.state = "paused";
        }
        await this.ensureStopped(client, device.device_id, `provider_${request.idempotencyKey}`, randomUUID());
      } else {
        if (device.state !== "paused") throw stale();
        const row = (await client.query<{ record: unknown }>(`SELECT record FROM ${s}.phone_control_journals WHERE device_id=$1 FOR UPDATE`, [device.device_id])).rows[0];
        const record = row ? parsePhoneControlRecord(row.record) : null;
        if (!record || record.deviceId !== device.device_id || record.disposition !== "stopped" || record.holderId !== null || record.calls.some(call => call.status !== "ended")) throw stale();
      }
      await client.query(`INSERT INTO ${s}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts)
        VALUES($1,'provider',$2,$3,'device',$4,$5,$6)`, [randomUUID(),principal.providerId,`${operation}_requested`,device.device_id,request.requestId,
        { intent: kind === "pause" ? "pause_requested" : "resume_requested" }]);
      const latestDevice = { ...device };
      const result = deviceControlSnapshotSchema.parse({ ...(await currentDeviceControl(client, latestDevice)), requestId: request.requestId });
      await completeCommand(client,operation,"provider",principal.providerId,request.idempotencyKey,result,device.device_id);
      return result;
    });
  }

  async installationPause(token: string, raw: unknown) {
    const parsed = installationSelfControlCommandRequestSchema.parse(raw), request = parsed.metadata;
    return this.transaction(async client => {
      const initial = await this.installationAuth.authenticate(token, client);
      const association = (await client.query<{ association_id: string; device_id: string; provider_id: string }>(`SELECT association_id,device_id,provider_id FROM ${s}.device_associations
        WHERE installation_id=$1 AND ended_at IS NULL`, [initial.installationId])).rows[0];
      if (!association) throw denied();
      const owner = (await client.query<{ status: string }>(`SELECT status FROM ${s}.providers WHERE provider_id=$1 FOR UPDATE`, [association.provider_id])).rows[0];
      if (!owner || owner.status !== "active") throw denied();
      await client.query(`SELECT installation_id FROM ${s}.installations WHERE installation_id=$1 FOR UPDATE`, [initial.installationId]);
      const current = await this.installationAuth.authenticate(token, client);
      if (current.installationId !== initial.installationId || current.installationGeneration !== initial.installationGeneration) throw stale();
      const lockedAssociation = (await client.query<{ association_id: string; device_id: string; provider_id: string }>(`SELECT association_id,device_id,provider_id FROM ${s}.device_associations
        WHERE installation_id=$1 AND ended_at IS NULL FOR UPDATE`, [current.installationId])).rows[0];
      if (!lockedAssociation || lockedAssociation.association_id !== association.association_id || lockedAssociation.device_id !== association.device_id || lockedAssociation.provider_id !== association.provider_id) throw stale();
      const device = (await client.query<DeviceRow>(`SELECT device_id,fact_version::text,state FROM ${s}.devices WHERE device_id=$1 FOR UPDATE`, [association.device_id])).rows[0];
      if (!device || !["associated_pending_access","access_ready","paused"].includes(device.state)) throw denied();
      const session = (await client.query<{ session_id: string }>(`SELECT session_id FROM ${s}.installation_sessions WHERE installation_id=$1 AND token_digest=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE`,
        [current.installationId,createHash("sha256").update(token).digest()])).rows[0];
      if (!session) throw denied();
      const now = await databaseNow(client), operation = "installation_device_control.pause";
      const cached = await findCachedCommand(client,operation,"installation",current.installationId,request.idempotencyKey,digest(parsed),now);
      const snapshot = await currentDeviceControl(client,device);
      if (cached) return deviceControlSnapshotSchema.parse({ ...snapshot, requestId: request.requestId });
      if (device.state !== "paused") {
        await client.query(`UPDATE ${s}.devices SET state='paused',fact_version=fact_version+1,updated_at=$2 WHERE device_id=$1`,[device.device_id,now]);
        device.state = "paused";
      }
      await this.ensureStopped(client,device.device_id,`installation_${request.idempotencyKey}`,randomUUID());
      await client.query(`INSERT INTO ${s}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts)
        VALUES($1,'installation',$2,'installation_device_control.pause_requested','device',$3,$4,$5)`,[randomUUID(),current.installationId,device.device_id,request.requestId,{intent:"pause_requested",sessionId:session.session_id}]);
      const result=deviceControlSnapshotSchema.parse({...(await currentDeviceControl(client,device)),requestId:request.requestId});
      await completeCommand(client,operation,"installation",current.installationId,request.idempotencyKey,result,device.device_id);
      return result;
    });
  }

  private async ensureStopped(client: PoolClient, deviceId: string, keyPart: string, stopRequestId: string) {
    const row = (await client.query<{ record: unknown }>(`SELECT record FROM ${s}.phone_control_journals WHERE device_id=$1 FOR UPDATE`,[deviceId])).rows[0];
    if (!row) {
      await this.journal.initializeInTransaction(client,deviceId,stopRequestId,`control_init_${digest(keyPart).toString("hex")}`);
      return;
    }
    const record = parsePhoneControlRecord(row.record);
    if (record.deviceId !== deviceId) throw unavailable();
    if (record.disposition === "enabled") {
      await this.journal.applyInTransaction(client,deviceId,record.version,`control_stop_${digest(keyPart).toString("hex")}`,{kind:"request_stop",stopRequestId});
    }
    // stop_requested/stopped and any running/unknown calls stay occupied.
  }
}
