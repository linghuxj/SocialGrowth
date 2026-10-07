import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { artemisPreflightAssignmentSchema, artemisPreflightObservationSchema, uuidSchema,
  type ArtemisPreflightAssignment, type ArtemisPreflightJournal, type PreflightObservation } from "@socialgrowth/product-contracts";
const s = "socialgrowth_product";
const unavailable = () => new Error("ARTEMIS_JOURNAL_UNAVAILABLE");
interface Row { assignment: unknown; fingerprint: string; trace_id: string | null }
// Internal port, not an HTTP endpoint or device grant. Production composition
// still needs a central authoritative Task reader and EVERY-action physical
// fence. Journal persistence alone must never enable main/worker execution.
export class PostgresArtemisPreflightJournal implements ArtemisPreflightJournal {
  constructor(private readonly pool: Pool) {}
  private binding(raw: unknown, digest: string) {
    const parsed = artemisPreflightAssignmentSchema.safeParse(raw); if (!parsed.success) throw unavailable(); const assignment = parsed.data;
    if (!/^[a-f0-9]{64}$/.test(digest) || createHash("sha256").update(JSON.stringify(assignment)).digest("hex") !== digest
      || assignment.task.taskAttemptId !== assignment.task.taskAttemptId.toLowerCase()) throw unavailable();
    return assignment;
  }
  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    let c: PoolClient; try { c = await this.pool.connect(); } catch { throw unavailable(); }
    try { await c.query("BEGIN"); await c.query("SET LOCAL lock_timeout='5s'"); await c.query("SET LOCAL statement_timeout='10s'"); const value = await fn(c); await c.query("COMMIT"); return value; }
    catch { try { await c.query("ROLLBACK"); } catch { /* uncertain result stays uncertain */ } throw unavailable(); }
    finally { c.release(); }
  }
  private async row(c: PoolClient, id: string, digest: string) {
    const row = (await c.query<Row>(`SELECT assignment,fingerprint,trace_id FROM ${s}.artemis_preflight_intents WHERE task_attempt_id=$1 FOR UPDATE`, [id])).rows[0];
    if (row) { if (row.fingerprint !== digest) throw unavailable(); this.binding(row.assignment, digest); }
    return row;
  }
  async claim(raw: ArtemisPreflightAssignment, digest: string) {
    const a = this.binding(raw, digest);
    return this.tx(async c => {
      const inserted = await c.query(`INSERT INTO ${s}.artemis_preflight_intents(task_attempt_id,fingerprint,assignment) VALUES($1,$2,$3) ON CONFLICT(task_attempt_id) DO NOTHING`, [a.task.taskAttemptId, digest, a]);
      const row = await this.row(c, a.task.taskAttemptId, digest); if (!row) throw unavailable();
      return inserted.rowCount === 1 ? { state: "new" as const } : { state: "existing" as const, traceId: row.trace_id };
    });
  }
  async read(raw: ArtemisPreflightAssignment, digest: string) {
    const a = this.binding(raw, digest);
    return this.tx(async c => { const row = await this.row(c, a.task.taskAttemptId, digest); return row ? { traceId: row.trace_id } : null; });
  }
  async bindTrace(attempt: string, digest: string, trace: string) {
    const a = uuidSchema.safeParse(attempt), t = uuidSchema.safeParse(trace); if (!a.success || !t.success) throw unavailable();
    const id = a.data.toLowerCase(), traceId = t.data.toLowerCase();
    await this.tx(async c => { const row = await this.row(c, id, digest); if (!row || row.trace_id !== null && row.trace_id !== traceId) throw unavailable();
      if (row.trace_id === null) await c.query(`UPDATE ${s}.artemis_preflight_intents SET trace_id=$2,bound_at=clock_timestamp() WHERE task_attempt_id=$1`, [id, traceId]);
    });
  }
  async record(attempt: string, digest: string, raw: PreflightObservation) {
    const a = uuidSchema.safeParse(attempt), o = artemisPreflightObservationSchema.safeParse(raw); if (!a.success || !o.success) throw unavailable();
    const id = a.data.toLowerCase(), observation = o.data;
    await this.tx(async c => { const row = await this.row(c, id, digest);
      // Lost bind ACK may report launch_unknown/null while a trace is already
      // durably bound. Append that uncertainty without erasing the binding.
      if (!row || observation.traceId !== null && observation.traceId.toLowerCase() !== row.trace_id) throw unavailable();
      await c.query(`INSERT INTO ${s}.artemis_preflight_observations(observation_id,task_attempt_id,fingerprint,record) VALUES($1,$2,$3,$4)`, [randomUUID(), id, digest, observation]);
    });
  }
}
