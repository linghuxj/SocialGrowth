import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { admissionGenerationSchema, phoneActionRequestSchema, timestampSchema, uuidSchema } from "@socialgrowth/product-contracts";
import {
  ActionPermissionError, acquirePhoneHolder, beginPhoneCall, confirmPhoneStopped, parsePhoneControlRecord, phoneHolderRequestSchema,
  recordPhoneCallResult, requestPhoneStop,
  type ActionAuthorityFacts, type PhoneControlRecord,
} from "./action-permission-core.js";

export class PhoneJournalError extends Error {
  constructor(readonly code: "INVALID_BOUNDARY" | "STALE_FACT" | "DATABASE_UNAVAILABLE") {
    super(`Phone journal rejected: ${code}`);
  }
}
const commandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("acquire_holder"), request: phoneHolderRequestSchema }),
  z.strictObject({ kind: z.literal("begin_call"), request: phoneActionRequestSchema }),
  z.strictObject({ kind: z.literal("request_stop"), stopRequestId: uuidSchema }),
  z.strictObject({ kind: z.literal("call_result"), receipt: z.strictObject({
    deviceId: uuidSchema, actionId: uuidSchema, holderId: uuidSchema, controlGeneration: admissionGenerationSchema, status: z.enum(["ended", "unknown"]),
  }) }),
  z.strictObject({ kind: z.literal("confirm_stopped"), evidence: z.strictObject({
    deviceId: uuidSchema, holderId: uuidSchema.nullable(), stopRequestId: uuidSchema, controlGeneration: admissionGenerationSchema,
    evidenceId: z.string().min(1).max(128), checkedAt: timestampSchema,
    allPathsFenced: z.boolean(), controllerReleased: z.boolean(), targetQuiescent: z.boolean(),
  }) }),
]);
const grantSchema = z.strictObject({
  deviceId: uuidSchema, holderId: uuidSchema, controlGeneration: admissionGenerationSchema,
  taskAttemptId: uuidSchema, authorizationId: uuidSchema,
  holderKind: z.enum(["executor", "recovery", "operator", "cleanup"]),
  purpose: phoneHolderRequestSchema.shape.purpose,
  operation: z.enum(["publish", "collect", "verify_result", "initialize", "withdraw", "recovery_check", "exit_cleanup", "operator_takeover"]),
  allowedKinds: z.array(phoneActionRequestSchema.shape.kind).min(1),
  leaseUntil: timestampSchema, validUntil: timestampSchema, stopEvidenceId: z.string().min(1).max(128),
});
export type PhoneJournalCommand = z.infer<typeof commandSchema>;
export interface PhoneJournalResult { record: PhoneControlRecord; replayed: boolean }
const schema = "socialgrowth_product";
function invalid(): never { throw new PhoneJournalError("INVALID_BOUNDARY"); }
function stale(): never { throw new PhoneJournalError("STALE_FACT"); }
function scope(deviceId: string, expectedVersion: number, key: string): void {
  if (!uuidSchema.safeParse(deviceId).success || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0
    || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) invalid();
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest();

async function transaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient;
  try { client = await pool.connect(); }
  catch { throw new PhoneJournalError("DATABASE_UNAVAILABLE"); }
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='10s'");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); }
    catch { throw new PhoneJournalError("DATABASE_UNAVAILABLE"); }
    if (error instanceof PhoneJournalError || error instanceof ActionPermissionError) throw error;
    // No raw query, values, driver detail/cause or trusted authority payload.
    throw new PhoneJournalError("DATABASE_UNAVAILABLE");
  } finally { client.release(); }
}
async function clock(client: PoolClient): Promise<string> {
  const result = await client.query<{ now: Date }>("SELECT clock_timestamp() AS now");
  if (!result.rows[0]) throw new PhoneJournalError("DATABASE_UNAVAILABLE");
  return result.rows[0].now.toISOString();
}
async function lockDevice(client: PoolClient, deviceId: string): Promise<void> {
  // Device -> journal. This layer takes no provider/install/network locks after
  // taking these locks; a future authority broker must use one agreed lock order.
  const result = await client.query(`SELECT device_id FROM ${schema}.devices WHERE device_id=$1 FOR UPDATE`, [deviceId]);
  if (!result.rowCount) stale();
}
async function load(client: PoolClient, deviceId: string): Promise<PhoneControlRecord> {
  const result = await client.query<{ record: unknown }>(`SELECT record FROM ${schema}.phone_control_journals WHERE device_id=$1 FOR UPDATE`, [deviceId]);
  if (!result.rows[0]) stale();
  const record = parsePhoneControlRecord(result.rows[0].record);
  if (record.deviceId !== deviceId.toLowerCase()) stale();
  return record;
}
async function isReplay(client: PoolClient, deviceId: string, key: string, version: number, kind: string, payload: Buffer): Promise<boolean> {
  const result = await client.query<{ expected_version: string; kind: string; payload_digest: Buffer }>(
    `SELECT expected_version::text,kind,payload_digest FROM ${schema}.phone_control_commands WHERE device_id=$1 AND request_key=$2`, [deviceId, key],
  );
  const previous = result.rows[0];
  if (!previous) return false;
  if (previous.expected_version !== String(version) || previous.kind !== kind || !previous.payload_digest.equals(payload)) stale();
  return true;
}
async function recordCommand(client: PoolClient, record: PhoneControlRecord, key: string, expectedVersion: number, kind: string, payload: Buffer): Promise<void> {
  await client.query(
    `INSERT INTO ${schema}.phone_control_commands(device_id,request_key,expected_version,kind,payload_digest,applied_version) VALUES($1,$2,$3,$4,$5,$6)`,
    [record.deviceId, key, expectedVersion, kind, payload, record.version],
  );
  await client.query(
    `INSERT INTO ${schema}.audit_records(audit_record_id,actor_type,action,object_type,object_id,request_id,facts)
       VALUES($1,'system',$2,'phone_control',$3,$4,$5)`,
    [randomUUID(), `phone_control.${kind}`, record.deviceId, key,
      { version: record.version, controlGeneration: record.controlGeneration, disposition: record.disposition,
        inFlight: record.calls.filter(call => call.status !== "ended").length }],
  );
}

// Internal storage primitive, deliberately NOT a permission service. Trusted
// facts/evidence may never come from HTTP bodies. No current caller consumes this
// as permission or performs ADB. Fresh authoritative fact loading and the
// physical start/stop fence remain required before a real worker can use it.
export class PhoneControlJournal {
  constructor(private readonly pool: Pool) {}

  async initialize(deviceId: string, stopRequestId: string, key: string): Promise<PhoneJournalResult> {
    scope(deviceId, 0, key);
    if (!uuidSchema.safeParse(stopRequestId).success) invalid();
    const id = deviceId.toLowerCase(), payload = digest({ deviceId: id, stopRequestId });
    return transaction(this.pool, async client => {
      await lockDevice(client, id);
      if (await isReplay(client, id, key, 0, "initialize", payload)) return { record: await load(client, id), replayed: true };
      const exists = await client.query(`SELECT 1 FROM ${schema}.phone_control_journals WHERE device_id=$1`, [id]);
      if (exists.rowCount) stale();
      // First contact is blocked, NOT an implicit stopped/ready/owner grant.
      const record: PhoneControlRecord = {
        deviceId: id, version: 0, controlGeneration: "1", holderId: null, disposition: "stop_requested",
        stopRequestId, stopEvidenceId: null, calls: [],
      };
      parsePhoneControlRecord(record);
      await client.query(
        `INSERT INTO ${schema}.phone_control_journals(device_id,version,control_generation,disposition,holder_id,record) VALUES($1,0,'1','stop_requested',NULL,$2)`, [id, record],
      );
      await recordCommand(client, record, key, 0, "initialize", payload);
      return { record, replayed: false };
    });
  }

  async apply(deviceId: string, expectedVersion: number, key: string, input: unknown, trustedFacts?: ActionAuthorityFacts): Promise<PhoneJournalResult> {
    scope(deviceId, expectedVersion, key);
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success) invalid();
    const command = parsed.data, payload = digest(command), id = deviceId.toLowerCase();
    return transaction(this.pool, async client => {
      await lockDevice(client, id);
      const record = await load(client, id);
      if (await isReplay(client, id, key, expectedVersion, command.kind, payload)) {
        // Lost response must NEVER hand out permission to repeat a phone call.
        // Return current state (including a newer pause), not a historical grant.
        return { record, replayed: true };
      }
      if (record.version !== expectedVersion) stale();
      const now = await clock(client);
      let next: PhoneControlRecord;
      switch (command.kind) {
        case "acquire_holder": {
          if (!trustedFacts) invalid();
          next = acquirePhoneHolder(record, trustedFacts, command.request, now);
          const { protocolVersion: _protocol, ...identity } = command.request;
          const grant = grantSchema.parse({ ...identity,
            holderKind: trustedFacts.holder.kind, operation: trustedFacts.task.operation,
            allowedKinds: trustedFacts.task.allowedKinds, leaseUntil: trustedFacts.holder.leaseUntil,
            validUntil: trustedFacts.task.validUntil, stopEvidenceId: record.stopEvidenceId });
          const inserted = await client.query(
            `INSERT INTO ${schema}.phone_control_holder_grants(holder_id,device_id,control_generation,granted_version,record)
               VALUES($1,$2,$3,$4,$5) ON CONFLICT(holder_id) DO NOTHING`,
            [next.holderId, id, next.controlGeneration, next.version, grant],
          );
          if (inserted.rowCount !== 1) stale();
          break;
        }
        case "begin_call":
          if (!trustedFacts) invalid();
          next = beginPhoneCall(record, trustedFacts, command.request, now);
          // Current facts may narrow a grant, but cannot expand its original
          // scope or renew an expired lease without a confirmed stop/new holder.
          {
            const saved = await client.query<{ record: unknown }>(
              `SELECT record FROM ${schema}.phone_control_holder_grants WHERE holder_id=$1 AND device_id=$2`, [record.holderId, id]);
            const grant = grantSchema.safeParse(saved.rows[0]?.record);
            if (!grant.success) stale();
            const g = grant.data, f = trustedFacts, r = command.request;
            if (g.holderId !== r.holderId || g.deviceId !== r.deviceId || g.controlGeneration !== r.controlGeneration
              || g.taskAttemptId !== r.taskAttemptId || g.authorizationId !== r.authorizationId || g.purpose !== r.purpose
              || g.holderKind !== f.holder.kind || g.operation !== f.task.operation || !g.allowedKinds.includes(r.kind)
              || Date.parse(now) >= Date.parse(g.leaseUntil) || Date.parse(now) >= Date.parse(g.validUntil)
              || Date.parse(f.holder.leaseUntil) > Date.parse(g.leaseUntil) || Date.parse(f.task.validUntil) > Date.parse(g.validUntil)) stale();
          }
          break;
        case "request_stop": next = requestPhoneStop(record, command.stopRequestId); break;
        case "call_result": next = recordPhoneCallResult(record, command.receipt, now); break;
        case "confirm_stopped": next = confirmPhoneStopped(record, command.evidence, now); break;
      }
      parsePhoneControlRecord(next);
      const changed = await client.query(
        `UPDATE ${schema}.phone_control_journals SET version=$2,control_generation=$3,disposition=$4,holder_id=$5,record=$6 WHERE device_id=$1 AND version=$7`,
        [id, next.version, next.controlGeneration, next.disposition, next.holderId, next, expectedVersion],
      );
      if (changed.rowCount !== 1) stale();
      await recordCommand(client, next, key, expectedVersion, command.kind, payload);
      return { record: next, replayed: false };
    });
  }

  // State read only: never an action grant, lease renewal or reset.
  async read(deviceId: string): Promise<PhoneControlRecord> {
    if (!uuidSchema.safeParse(deviceId).success) invalid();
    try {
      const result = await this.pool.query<{ record: unknown }>(`SELECT record FROM ${schema}.phone_control_journals WHERE device_id=$1`, [deviceId]);
      if (!result.rows[0]) stale();
      const record = parsePhoneControlRecord(result.rows[0].record);
      if (record.deviceId !== deviceId.toLowerCase()) stale();
      return record;
    } catch (error) {
      if (error instanceof PhoneJournalError || error instanceof ActionPermissionError) throw error;
      throw new PhoneJournalError("DATABASE_UNAVAILABLE");
    }
  }
}
