import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import { commissionCursorSchema, listProviderCommissionsResponseSchema, providerCommissionRecordSchema, type ProviderCommissionRecord } from "@socialgrowth/product-contracts";
import { validateCommissionHistory, type CommissionSourceRow, type CommissionRevisionRow } from "./commission-income-journal.js";
import { ProviderAuthService } from "./provider-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
const querySchema = z.strictObject({ after: commissionCursorSchema.nullable(), pageSize: z.int().min(1).max(50) });
const s = "socialgrowth_product";
interface PageRow { source: CommissionSourceRow; history: CommissionRevisionRow[]; revision: string; account_identity_ref: string }
const projectionSQL = `SELECT row_to_json(src) source,v.revision::text revision,i.canonical_identity_ref account_identity_ref,
  (SELECT json_agg(h ORDER BY h.revision::bigint) FROM
    (SELECT revision::text,income,context,calculation,evaluated_at,recorded_by_operator_id FROM ${s}.commission_income_revisions history_row
      WHERE income_id=src.income_id ORDER BY history_row.revision LIMIT 1001) h) history
  FROM ${s}.commission_income_revisions v JOIN
    (SELECT income_id,source_id,source_record_id,identity_id,account_id,platform,current_revision::text FROM ${s}.commission_income_sources) src USING(income_id)
  JOIN ${s}.publishing_identities i ON i.identity_id=src.identity_id AND i.account_id=src.account_id AND i.platform=src.platform`;
function project(row: PageRow, providerId: string): ProviderCommissionRecord {
  const saved = validateCommissionHistory(row.source, row.history), entry = saved.revisions.find(v => String(v.income.revision) === row.revision);
  if (!entry || entry.calculation.status !== "provider_calculation" || entry.calculation.providerId !== providerId) throw new Error("invalid-projection");
  const { income, calculation } = entry;
  return providerCommissionRecordSchema.parse({ incomeId: income.incomeId, revision: income.revision, currentForIncome: row.source.current_revision === row.revision,
    identityId: income.identityId, accountIdentityRef: row.account_identity_ref, platform: income.platform, currency: income.currency, minorUnitScale: income.minorUnitScale,
    produced: income.produced!, receivedAt: income.receivedAt!, evaluatedAt: calculation.evaluatedAt, receivedRevenueMinorUnits: income.amountMinorUnits!,
    commissionMinorUnits: calculation.commissionMinorUnits!, appliedFraction: calculation.rateRef!.fraction, rateVersion: calculation.rateRef!.version,
    rounding: calculation.moneyPolicyRef!.rounding, moneyPolicyVersion: calculation.moneyPolicyRef!.version,
    calculationStage: "internal_calculation_only", paymentStatus: "not_recorded", paymentAllowed: false });
}
// Read-only current-authenticated projection. Historical internal calculations
// are not actual payables or payments, and archived revisions must not be summed.
export class ProviderCommissionFeedService {
  constructor(private readonly pool: Pool, private readonly auth: ProviderAuthService) {}
  async list(token: string, input: unknown) {
    const p = querySchema.safeParse(input); if (!p.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid commission page");
    const r = p.data; if (r.after) r.after.incomeId = r.after.incomeId.toLowerCase();
    let c: PoolClient; try { c = await this.pool.connect(); } catch { throw new ProductTransactionError("INTERNAL_ERROR", "Commission records unavailable", true); }
    try {
      await c.query("BEGIN"); await c.query("SET LOCAL lock_timeout='5s'"); await c.query("SET LOCAL statement_timeout='10s'");
      const actor = await this.auth.authenticateSessionInTransaction(c, token);
      // Do NOT take journal guard/source row locks after provider/session. All
      // source/revisions for a page are loaded in ONE statement snapshot below.
      if (r.after) {
        const cursor = (await c.query<PageRow>(`${projectionSQL}
          WHERE v.income_id=$1 AND v.revision=$2 AND v.calculation->>'providerId'=$3`, [r.after.incomeId, r.after.revision, actor.providerId])).rows[0];
        if (!cursor) throw new ProductTransactionError("FACT_VERSION_STALE", "Commission cursor unavailable");
        project(cursor, actor.providerId); // Complete history, even when the page is empty.
      }
      const rows = (await c.query<PageRow>(`${projectionSQL}
        WHERE v.calculation->>'providerId'=$1 AND ($2::uuid IS NULL OR (v.income_id,v.revision)>($2::uuid,$3::bigint))
        ORDER BY v.income_id,v.revision LIMIT $4`, [actor.providerId, r.after?.incomeId ?? null, r.after?.revision ?? null, r.pageSize + 1])).rows;
      const records = rows.map(row => project(row, actor.providerId)).slice(0, r.pageSize); // Validate overscan, not only returned rows.
      const last = records.at(-1), result = listProviderCommissionsResponseSchema.parse({ records,
        nextAfter: rows.length > r.pageSize && last ? { incomeId: last.incomeId, revision: last.revision } : null });
      if (!(await c.query(`SELECT 1 FROM ${s}.provider_sessions WHERE session_id=$1 AND provider_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp()`, [actor.sessionId, actor.providerId])).rowCount) {
        throw new ProductTransactionError("AUTHENTICATION_REQUIRED", "Provider session expired");
      }
      await c.query("COMMIT"); return result;
    } catch (e) {
      try { await c.query("ROLLBACK"); } catch { throw new ProductTransactionError("INTERNAL_ERROR", "Commission records unavailable", true); }
      if (e instanceof ProductTransactionError) throw e;
      throw new ProductTransactionError("INTERNAL_ERROR", "Commission records unavailable", true);
    } finally { c.release(); }
  }
}
