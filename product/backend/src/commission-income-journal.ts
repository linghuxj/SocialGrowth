import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import { compareTimestamps, requestMetadataSchema, uuidSchema } from "@socialgrowth/product-contracts";
import { calculateCommission, parseCommissionContext, parseCommissionIncome } from "./commission-core.js";
import { OperatorAuthService, type OperatorSessionContext } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
const id = uuidSchema.transform(v => v.toLowerCase());
const inputSchema = z.strictObject({ metadata: requestMetadataSchema, incomeId: id, expectedCurrentRevision: z.int().min(0) });
const s = "socialgrowth_product";
export class CommissionJournalError extends Error {
  constructor(readonly code: "INPUT_INVALID" | "PRODUCER_UNAVAILABLE" | "SOURCE_CONFLICT" | "REVISION_STALE" | "CORRUPT_HISTORY" | "NOT_FOUND" | "DATABASE_UNAVAILABLE") { super(code); }
}
function fail(code: CommissionJournalError["code"]): never { throw new CommissionJournalError(code); }
export interface CommissionIncomeProducer {
  // Server-owned, DB-only, under the SAME journal guard and producer locks.
  // No client input/body, arbitrary source claims, network or model here.
  // Must load actual receipt, stable source mapping, ownership and uniform
  // historical policy. No production implementation is currently registered.
  read(c: PoolClient, incomeId: string): Promise<unknown>;
}
const producedSchema = z.strictObject({ income: z.unknown(), context: z.unknown() });
interface Source { income_id: string; source_id: string; source_record_id: string; identity_id: string; account_id: string; platform: string; current_revision: string }
interface Revision { revision: string; income: unknown; context: unknown; calculation: unknown; evaluated_at: string; recorded_by_operator_id: string }
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => `${JSON.stringify(k)}:${canonical(value)}`).join(",")}}`;
}
async function fresh(c: PoolClient, a: OperatorSessionContext): Promise<string> {
  const row = (await c.query<{ now: string }>(`WITH current_clock AS MATERIALIZED (SELECT clock_timestamp() t)
    SELECT to_char(t AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') now FROM ${s}.operator_sessions x CROSS JOIN current_clock
    WHERE x.session_id=$1 AND x.operator_id=$2 AND x.revoked_at IS NULL AND x.expires_at>t`, [a.sessionId, a.operator.operatorId])).rows[0];
  if (!row) throw new ProductTransactionError("AUTHENTICATION_REQUIRED", "Operator session expired"); return row.now;
}
function scopeMatches(source: Source, income: ReturnType<typeof parseCommissionIncome>): boolean {
  return source.income_id === income.incomeId && source.source_id === income.sourceId && source.source_record_id === income.sourceRecordId
    && source.identity_id === income.identityId && source.platform === income.platform;
}
async function load(c: PoolClient, incomeId: string) {
  const source = (await c.query<Source>(`SELECT *,current_revision::text FROM ${s}.commission_income_sources WHERE income_id=$1 FOR UPDATE`, [incomeId])).rows[0];
  if (!source) return null;
  const rows = (await c.query<Revision>(`SELECT revision::text,income,context,calculation,evaluated_at,recorded_by_operator_id
    FROM ${s}.commission_income_revisions WHERE income_id=$1 ORDER BY revision LIMIT 1001`, [incomeId])).rows;
  if (!rows.length || rows.length > 1000 || String(rows.length) !== source.current_revision) return fail("CORRUPT_HISTORY");
  let lastTime: string | null = null;
  const revisions = rows.map((row, i) => {
    try {
      const income = parseCommissionIncome(row.income), context = parseCommissionContext(row.context);
      const calculation = calculateCommission(income, context, row.evaluated_at);
      if (!scopeMatches(source, income) || row.revision !== String(i + 1) || income.revision !== i + 1
        || canonical(calculation) !== canonical(row.calculation) || (lastTime && compareTimestamps(row.evaluated_at, lastTime)! < 0)) return fail("CORRUPT_HISTORY");
      lastTime = row.evaluated_at;
      return { income, context, calculation, recordedByOperatorId: row.recorded_by_operator_id };
    } catch { return fail("CORRUPT_HISTORY"); }
  });
  return { source, revisions };
}
async function affected(c: PoolClient, sql: string, values: unknown[]): Promise<void> {
  if ((await c.query(sql, values)).rowCount !== 1) fail("DATABASE_UNAVAILABLE");
}
// INTERNAL authenticated journal only. No HTTP/provider projection, real
// income/receipt producer, payable total, payment or phone consumer.
export class CommissionIncomeJournal {
  constructor(private readonly pool: Pool, private readonly auth: OperatorAuthService, private readonly producer: CommissionIncomeProducer | null = null) {}
  private async tx<T>(token: string, csrf: string | null, fn: (c: PoolClient, a: OperatorSessionContext) => Promise<T>): Promise<T> {
    let c: PoolClient; try { c = await this.pool.connect(); } catch { return fail("DATABASE_UNAVAILABLE"); }
    try {
      await c.query("BEGIN"); await c.query("SET LOCAL lock_timeout='5s'"); await c.query("SET LOCAL statement_timeout='10s'");
      await c.query(`LOCK TABLE ${s}.operators IN SHARE ROW EXCLUSIVE MODE`);
      const a = await this.auth.authenticateSessionInTransaction(c, token, csrf ?? undefined, csrf !== null);
      if ((await c.query(`SELECT singleton FROM ${s}.commission_journal_guard WHERE singleton=true FOR UPDATE`)).rowCount !== 1) fail("CORRUPT_HISTORY");
      await fresh(c, a); const result = await fn(c, a); await fresh(c, a); await c.query("COMMIT"); return result;
    } catch (e) {
      try { await c.query("ROLLBACK"); } catch { return fail("DATABASE_UNAVAILABLE"); }
      if (e instanceof CommissionJournalError || e instanceof ProductTransactionError) throw e;
      return fail("DATABASE_UNAVAILABLE");
    } finally { c.release(); }
  }
  async read(token: string, incomeInput: unknown) {
    const p = id.safeParse(incomeInput); if (!p.success) return fail("INPUT_INVALID");
    return this.tx(token, null, async (c) => { const saved = await load(c, p.data); if (!saved) return fail("NOT_FOUND");
      return { currentRevision: saved.revisions.length, revisions: saved.revisions }; });
  }
  async reconcile(token: string, csrf: string, input: unknown) {
    const p = inputSchema.safeParse(input); if (!p.success) return fail("INPUT_INVALID");
    if (!this.producer) return fail("PRODUCER_UNAVAILABLE"); // BEFORE connect, no default trust of body data.
    const r = p.data, { requestId: _requestId, ...metadata } = r.metadata;
    const digest = createHash("sha256").update(JSON.stringify({ ...r, metadata })).digest();
    return this.tx(token, csrf, async (c, a) => {
      const old = (await c.query<{ payload_digest: Buffer; income_id: string }>(`SELECT payload_digest,income_id FROM ${s}.commission_income_commands WHERE actor_id=$1 AND request_key=$2`, [a.operator.operatorId, metadata.idempotencyKey])).rows[0];
      let saved = await load(c, r.incomeId);
      if (old) {
        if (!old.payload_digest.equals(digest) || old.income_id !== r.incomeId) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Income request key belongs to different inputs");
        if (!saved) return fail("CORRUPT_HISTORY");
        return { currentRevision: saved.revisions.length, current: saved.revisions.at(-1)!, replayed: true, changed: false };
      }
      let produced;
      try { const parsed = producedSchema.parse(structuredClone(await this.producer!.read(c, r.incomeId)));
        produced = { income: parseCommissionIncome(parsed.income), context: parseCommissionContext(parsed.context) }; }
      catch { return fail("PRODUCER_UNAVAILABLE"); }
      const { income, context } = produced;
      if (income.incomeId !== r.incomeId || income.identityId !== context.identityId || income.platform !== context.platform) return fail("SOURCE_CONFLICT");
      const registry = (await c.query<{ account_id: string }>(`SELECT account_id FROM ${s}.publishing_identities WHERE identity_id=$1 AND platform=$2 FOR SHARE`, [income.identityId, income.platform])).rows[0];
      if (!registry) return fail("SOURCE_CONFLICT"); // Registry/FK is NOT actual identity or ownership proof.
      const duplicate = (await c.query<{ income_id: string }>(`SELECT income_id FROM ${s}.commission_income_sources WHERE source_id=$1 AND source_record_id=$2`, [income.sourceId, income.sourceRecordId])).rows[0];
      if (duplicate && duplicate.income_id !== income.incomeId) return fail("SOURCE_CONFLICT");
      if (saved && (!scopeMatches(saved.source, income) || saved.source.account_id !== registry.account_id)) return fail("SOURCE_CONFLICT");
      const last = saved?.revisions.at(-1), unchanged = last && income.revision === last.income.revision && canonical(income) === canonical(last.income);
      if (!unchanged) {
        const currentRevision = saved?.revisions.length ?? 0;
        if (r.expectedCurrentRevision !== currentRevision || currentRevision >= 1000 || income.revision !== currentRevision + 1) return fail("REVISION_STALE");
        const now = await fresh(c, a);
        if (last && compareTimestamps(now, last.calculation.evaluatedAt)! < 0) return fail("REVISION_STALE");
        const calculation = calculateCommission(income, context, now);
        if (!saved) await affected(c, `INSERT INTO ${s}.commission_income_sources(income_id,source_id,source_record_id,identity_id,account_id,platform,current_revision)
          VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING income_id`, [income.incomeId, income.sourceId, income.sourceRecordId, income.identityId, registry.account_id, income.platform, income.revision]);
        else await affected(c, `UPDATE ${s}.commission_income_sources SET current_revision=$2 WHERE income_id=$1 AND current_revision=$3 RETURNING income_id`, [income.incomeId, income.revision, currentRevision]);
        await affected(c, `INSERT INTO ${s}.commission_income_revisions(income_id,revision,income,context,calculation,evaluated_at,recorded_by_operator_id)
          VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING income_id`, [income.incomeId, income.revision, income, context, calculation, now, a.operator.operatorId]);
        await affected(c, `INSERT INTO ${s}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts)
          VALUES($1,'operator',$2,'commission.income_reconciled','commission_income',$3,$4,$5) RETURNING audit_record_id`, [randomUUID(), a.operator.operatorId, income.incomeId, r.metadata.requestId, { revision: income.revision, status: calculation.status }]);
        saved = await load(c, r.incomeId); if (!saved) return fail("CORRUPT_HISTORY");
      }
      await affected(c, `INSERT INTO ${s}.commission_income_commands(actor_id,request_key,payload_digest,income_id) VALUES($1,$2,$3,$4) RETURNING income_id`, [a.operator.operatorId, metadata.idempotencyKey, digest, income.incomeId]);
      return { currentRevision: saved!.revisions.length, current: saved!.revisions.at(-1)!, replayed: false, changed: !unchanged };
    });
  }
}
