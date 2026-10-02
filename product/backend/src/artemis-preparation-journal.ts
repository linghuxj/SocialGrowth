import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { artemisPreparationAssignmentSchema, artemisPreparationObservationSchema, accountPreparationIntentSchema, uuidSchema,
  type ArtemisPreparationAssignment, type ArtemisPreparationJournal, type ArtemisPreparationObservation } from "@socialgrowth/product-contracts";
import { canonicalMaterial } from "./material-registry-core.js";
const s = "socialgrowth_product", unavailable = () => new Error("PREPARATION_JOURNAL_UNAVAILABLE");
interface Row { assignment: unknown; fingerprint: string; trace_id: string | null }
// Internal port only. Central task FK and intent persistence do not implement
// physical permissions. No AppModule/worker registration or ambient SDK access.
export class PostgresArtemisPreparationJournal implements ArtemisPreparationJournal {
  constructor(private readonly pool: Pool) {}
  private assignment(raw: unknown, fingerprint: string) {
    const p = artemisPreparationAssignmentSchema.safeParse(raw); if (!p.success) throw unavailable();
    if (!/^[a-f0-9]{64}$/.test(fingerprint) || createHash("sha256").update(JSON.stringify(p.data)).digest("hex") !== fingerprint
      || [p.data.taskId, p.data.taskAttemptId, p.data.input.projectId, p.data.input.accountId, p.data.input.deviceId].some(id => id !== id.toLowerCase())) throw unavailable();
    return p.data;
  }
  private async tx<T>(fn: (c: PoolClient) => Promise<T>) {
    let c: PoolClient; try { c = await this.pool.connect(); } catch { throw unavailable(); }
    try { await c.query("BEGIN"); await c.query("SET LOCAL lock_timeout='5s'"); await c.query("SET LOCAL statement_timeout='10s'"); const value = await fn(c); await c.query("COMMIT"); return value; }
    catch { try { await c.query("ROLLBACK"); } catch { /* retain uncertainty */ } throw unavailable(); }
    finally { c.release(); }
  }
  private async row(c: PoolClient, attempt: string, fingerprint: string) {
    const row = (await c.query<Row>(`SELECT assignment,fingerprint,trace_id FROM ${s}.artemis_preparation_intents WHERE task_attempt_id=$1 FOR UPDATE`, [attempt])).rows[0];
    if (row) { if (row.fingerprint !== fingerprint) throw unavailable(); this.assignment(row.assignment, fingerprint); } return row;
  }
  private async current(c: PoolClient, a: ArtemisPreparationAssignment) {
    // Same ordering as the preparation producer, no external call under lock.
    await c.query(`SELECT version FROM ${s}.resource_reservation_guard FOR UPDATE`);
    const project = (await c.query<{ phase: string }>(`SELECT phase FROM ${s}.projects WHERE project_id=$1 FOR UPDATE`, [a.input.projectId])).rows[0];
    const task = (await c.query<{ project_id: string; task_version: string; intent: unknown; intent_digest: string; state: string; next_operation_id: string | null; selected_account_id: string | null; selected_device_id: string | null }>(`SELECT * FROM ${s}.account_preparation_tasks WHERE task_id=$1 FOR UPDATE`, [a.taskId])).rows[0];
    if (!task || project?.phase !== "preparing" || task.project_id !== a.input.projectId || Number(task.task_version) !== a.taskVersion
      || task.state !== "waiting_executor" || task.next_operation_id !== a.operationId || task.selected_account_id !== a.input.accountId || task.selected_device_id !== a.input.deviceId) throw unavailable();
    const intent = accountPreparationIntentSchema.parse(task.intent);
    if (createHash("sha256").update(canonicalMaterial(intent)).digest("hex") !== task.intent_digest
      || intent.parentLoginRef !== a.input.parentLoginRef || canonicalMaterial(intent.target) !== canonicalMaterial(a.input.target)
      || intent.mode !== a.input.mode || intent.scopeRef !== a.input.requestedScope.scopeRef
      || intent.allowTrustedInstall !== a.input.requestedScope.allowTrustedInstall || intent.allowIdentityCreation !== a.input.requestedScope.allowIdentityCreation) throw unavailable();
    const scoped = (await c.query(`SELECT 1 FROM ${s}.project_account_reservations a JOIN ${s}.project_device_reservations d ON d.project_id=a.project_id WHERE a.project_id=$1 AND a.account_id=$2 AND d.device_id=$3`, [a.input.projectId, a.input.accountId, a.input.deviceId])).rowCount;
    if (scoped !== 1) throw unavailable();
  }
  async claim(raw: ArtemisPreparationAssignment, fingerprint: string) {
    const a = this.assignment(raw, fingerprint);
    return this.tx(async c => {
      await this.current(c, a);
      if ((await c.query(`SELECT 1 FROM ${s}.artemis_preparation_intents WHERE assignment->'input'->>'deviceId'=$1 AND task_attempt_id<>$2 LIMIT 1`, [a.input.deviceId, a.taskAttemptId])).rowCount) throw unavailable();
      const inserted = await c.query(`INSERT INTO ${s}.artemis_preparation_intents(task_attempt_id,task_id,task_version,operation_id,fingerprint,assignment) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(task_attempt_id) DO NOTHING`, [a.taskAttemptId, a.taskId, a.taskVersion, a.operationId, fingerprint, a]);
      const row = await this.row(c, a.taskAttemptId, fingerprint); if (!row) throw unavailable();
      return inserted.rowCount === 1 ? { state: "new" as const } : { state: "existing" as const, traceId: row.trace_id };
    });
  }
  async read(raw: ArtemisPreparationAssignment, fingerprint: string) {
    const a = this.assignment(raw, fingerprint);
    return this.tx(async c => { const row = await this.row(c, a.taskAttemptId, fingerprint); return row ? { traceId: row.trace_id } : null; });
  }
  async bindTrace(attempt: string, fingerprint: string, rawTrace: string) {
    const id = uuidSchema.parse(attempt).toLowerCase(), trace = uuidSchema.parse(rawTrace).toLowerCase();
    await this.tx(async c => { const row = await this.row(c, id, fingerprint); if (!row || (row.trace_id !== null && row.trace_id !== trace)) throw unavailable();
      if (row.trace_id === null) await c.query(`UPDATE ${s}.artemis_preparation_intents SET trace_id=$2,bound_at=clock_timestamp() WHERE task_attempt_id=$1`, [id, trace]); });
  }
  async record(attempt: string, fingerprint: string, raw: ArtemisPreparationObservation) {
    const id = uuidSchema.parse(attempt).toLowerCase(), observation = artemisPreparationObservationSchema.parse(raw);
    await this.tx(async c => { const row = await this.row(c, id, fingerprint); if (!row || (observation.traceId !== null && observation.traceId.toLowerCase() !== row.trace_id)) throw unavailable();
      await c.query(`INSERT INTO ${s}.artemis_preparation_observations(observation_id,task_attempt_id,fingerprint,record) VALUES($1,$2,$3,$4)`, [randomUUID(), id, fingerprint, observation]); });
  }
}
