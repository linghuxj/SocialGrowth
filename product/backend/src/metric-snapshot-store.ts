import type { Pool } from "pg";
import { projectFeedbackResponseSchema, uuidSchema, type ProjectFeedbackResponse } from "@socialgrowth/product-contracts";
import { OperatorAuthService } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { appendMetricSnapshot, MetricSnapshotError, parseMetricHistory, parseMetricSnapshot,
  type MetricSnapshot } from "./metric-snapshot-core.js";

const s = "socialgrowth_product";
const id = uuidSchema.transform(value => value.toLowerCase());
const unavailable = () => new ProductTransactionError("INTERNAL_ERROR", "Metric snapshot source is unavailable", true);
const denied = () => new ProductTransactionError("AUTHORIZATION_DENIED", "Metric snapshot is outside the authorized account scope");
const invalid = () => new ProductTransactionError("INPUT_INVALID", "Metric snapshot report is invalid");

export interface MetricReportRequest { sourceId: string; sourceReportId: string }
export interface AuthorizedMetricReport { accountId: string; snapshot: unknown }

// A real adapter must authenticate the platform/source report and resolve its
// authorized account server-side. No operator route accepts metric values.
export interface TrustedMetricReportResolver {
  resolve(input: MetricReportRequest, signal: AbortSignal): Promise<AuthorizedMetricReport | null>;
}

// Internal persistence seam only. The default resolver is absent, so no
// imported UUID or operator/model payload can create an observation.
export class MetricSnapshotStore {
  constructor(private readonly pool: Pool, private readonly resolver: TrustedMetricReportResolver | null = null,
    private readonly auth: OperatorAuthService | null = null) {}

  async readProjectFeedback(sessionToken: string, projectIdInput: string): Promise<ProjectFeedbackResponse> {
    const projectId = id.parse(projectIdInput);
    if (!this.auth) throw new ProductTransactionError("INTERNAL_ERROR", "Metric feedback projection is unavailable", true);
    let c;
    try { c = await this.pool.connect(); } catch { throw unavailable(); }
    try {
      await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await c.query("SET LOCAL lock_timeout='5s'");
      await c.query("SET LOCAL statement_timeout='10s'");
      await this.auth.authenticateSessionInTransaction(c, sessionToken);
      const project = await c.query<{ observed_at: Date }>(`SELECT clock_timestamp() AS observed_at FROM ${s}.projects WHERE project_id=$1`, [projectId]);
      if (!project.rows[0]) throw denied();
      const observedAt = project.rows[0].observed_at.toISOString();
      const rows = await c.query<{ source_id: string; source_report_id: string; current_revision: string; payload: unknown }>(
        `SELECT h.source_id,h.source_report_id,rh.current_revision::text,h.payload
           FROM ${s}.metric_snapshot_history h
           JOIN ${s}.metric_snapshot_report_heads rh USING(source_id,source_report_id)
           JOIN ${s}.project_identity_reservations pir ON pir.identity_id=h.identity_id AND pir.project_id=h.project_id
           JOIN ${s}.project_account_reservations par ON par.account_id=h.account_id AND par.project_id=h.project_id
          WHERE h.project_id=$1
          ORDER BY h.source_id,h.source_report_id,h.revision`, [projectId]);
      const histories = new Map<string, { currentRevision: number; payloads: unknown[] }>();
      for (const row of rows.rows) {
        const key = `${row.source_id.toLowerCase()}/${row.source_report_id.toLowerCase()}`;
        const entry = histories.get(key) ?? { currentRevision: Number(row.current_revision), payloads: [] };
        if (entry.currentRevision !== Number(row.current_revision)) throw invalid();
        entry.payloads.push(row.payload);
        histories.set(key, entry);
      }
      const metrics = [];
      for (const entry of histories.values()) {
        const history = parseMetricHistory(entry.payloads);
        if ((history.at(-1)?.revision ?? 0) !== entry.currentRevision) throw invalid();
        const current = history.at(-1);
        if (current) metrics.push(current);
      }
      const sourceState = metrics.length ? "available" : this.resolver ? "unknown" : "not_configured";
      const response = projectFeedbackResponseSchema.parse({ projectId, observedAt, sourceState,
        sourceReasonCode: metrics.length ? null : this.resolver ? "no_authoritative_report" : "source_not_configured", metrics,
        contentAttribution: { state: "unknown", reason: "verified_task_publication_source_missing" } });
      await c.query("COMMIT");
      return response;
    } catch (error) {
      try { await c.query("ROLLBACK"); } catch { throw unavailable(); }
      if (error instanceof ProductTransactionError) throw error;
      if (error instanceof MetricSnapshotError) throw invalid();
      throw unavailable();
    } finally { c.release(); }
  }

  async ingestCurrent(input: unknown, signal = new AbortController().signal): Promise<{ changed: boolean; snapshot: MetricSnapshot }> {
    const request = parseMetricReportRequest(input);
    if (!this.resolver) throw unavailable();
    let resolved: AuthorizedMetricReport | null;
    try { resolved = await this.resolver.resolve(request, signal); } catch { throw unavailable(); }
    if (!resolved || signal.aborted) throw unavailable();
    let accountId: string, snapshot: MetricSnapshot;
    try { accountId = id.parse(resolved.accountId); snapshot = parseMetricSnapshot(resolved.snapshot); }
    catch { throw invalid(); }
    if (snapshot.sourceId !== request.sourceId || snapshot.sourceReportId !== request.sourceReportId || snapshot.subject.kind !== "account") throw denied();
    if (signal.aborted) throw unavailable();

    let c;
    try { c = await this.pool.connect(); } catch { throw unavailable(); }
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout='5s'");
      await c.query("SET LOCAL statement_timeout='10s'");
      const authorized = (await c.query(`SELECT i.account_id FROM ${s}.publishing_identities i
        JOIN ${s}.project_account_reservations r ON r.account_id=i.account_id AND r.project_id=$3
        JOIN ${s}.project_identity_reservations ir ON ir.identity_id=i.identity_id AND ir.account_id=i.account_id
          AND ir.platform=i.platform AND ir.project_id=$3 AND ir.state='pending_initialization'
        WHERE i.identity_id=$1 AND i.account_id=$2 AND i.platform=$4 FOR SHARE OF i,r,ir`,
      [snapshot.identityId, accountId, snapshot.projectId, snapshot.platform])).rowCount === 1;
      if (!authorized) throw denied();

      await c.query(`INSERT INTO ${s}.metric_snapshot_report_heads(source_id,source_report_id,account_id,project_id,identity_id,platform,definition_id,measurement,current_revision)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,0) ON CONFLICT(source_id,source_report_id) DO NOTHING`,
      [snapshot.sourceId, snapshot.sourceReportId, accountId, snapshot.projectId, snapshot.identityId, snapshot.platform, snapshot.definitionId, snapshot.measurement]);
      const head = (await c.query<{ account_id: string; project_id: string; identity_id: string; platform: string; definition_id: string; measurement: string; current_revision: string }>(
        `SELECT account_id,project_id,identity_id,platform,definition_id,measurement,current_revision::text FROM ${s}.metric_snapshot_report_heads
        WHERE source_id=$1 AND source_report_id=$2 FOR UPDATE`, [snapshot.sourceId, snapshot.sourceReportId])).rows[0];
      if (!head || head.account_id !== accountId || head.project_id !== snapshot.projectId || head.identity_id !== snapshot.identityId
        || head.platform !== snapshot.platform || head.definition_id !== snapshot.definitionId || head.measurement !== snapshot.measurement) throw denied();
      const rows = await c.query<{ payload: unknown }>(`SELECT payload FROM ${s}.metric_snapshot_history WHERE source_id=$1 AND source_report_id=$2 ORDER BY revision`,
        [snapshot.sourceId, snapshot.sourceReportId]);
      const history = parseMetricHistory(rows.rows.map(row => row.payload));
      if (Number(head.current_revision) !== (history.at(-1)?.revision ?? 0)) throw invalid();
      const appended = appendMetricSnapshot(history, snapshot);
      if (appended.changed) {
        const oldRevision = Number(head.current_revision);
        if (!Number.isSafeInteger(oldRevision) || snapshot.revision !== oldRevision + 1) throw invalid();
        const updated = await c.query(`UPDATE ${s}.metric_snapshot_report_heads SET current_revision=$3,updated_at=clock_timestamp()
          WHERE source_id=$1 AND source_report_id=$2 AND current_revision=$4`,
        [snapshot.sourceId, snapshot.sourceReportId, snapshot.revision, oldRevision]);
        if (updated.rowCount !== 1) throw new ProductTransactionError("FACT_VERSION_STALE", "Metric report changed concurrently");
        await c.query(`INSERT INTO ${s}.metric_snapshot_history(snapshot_id,source_id,source_report_id,revision,account_id,project_id,identity_id,platform,definition_id,measurement,payload)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [snapshot.snapshotId, snapshot.sourceId, snapshot.sourceReportId, snapshot.revision, accountId, snapshot.projectId,
          snapshot.identityId, snapshot.platform, snapshot.definitionId, snapshot.measurement, snapshot]);
      }
      if (signal.aborted) throw unavailable();
      await c.query("COMMIT");
      return { changed: appended.changed, snapshot: appended.history.at(-1)! };
    } catch (error) {
      try { await c.query("ROLLBACK"); } catch { throw unavailable(); }
      if (error instanceof ProductTransactionError) throw error;
      if (error instanceof MetricSnapshotError) throw invalid();
      throw unavailable();
    } finally { c.release(); }
  }
}

function parseMetricReportRequest(input: unknown): MetricReportRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid();
  const row = input as Record<string, unknown>;
  if (Object.keys(row).sort().join(",") !== "sourceId,sourceReportId") throw invalid();
  try { return { sourceId: id.parse(row.sourceId), sourceReportId: id.parse(row.sourceReportId) }; }
  catch { throw invalid(); }
}
