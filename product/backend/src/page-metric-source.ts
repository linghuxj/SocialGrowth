import { createHash } from "node:crypto";
import { z } from "zod";
import type { Pool } from "pg";
import { uuidSchema, metricSnapshotSchema } from "@socialgrowth/product-contracts";
import type { TrustedMetricReportResolver } from "./metric-snapshot-store.js";
import { OperatorAuthService } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";

const s = "socialgrowth_product";
const derivedId = (value: string) => { const h = createHash("sha256").update(value).digest("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };
export const pageMetricSourceId = derivedId("socialgrowth:artemis:facebook.page.metrics.v1");
const metric = z.object({ key: z.enum(["views", "reach", "reactions", "comments", "shares"]), label: z.string().nullable(), unit: z.string().nullable(),
  sourceDefinition: z.string().nullable(), value: z.string().nullable(), availability: z.enum(["available", "missing", "delayed"]),
  missingReason: z.enum(["permission_unavailable", "source_unavailable", "no_data", "unknown_cutoff", "unknown_coverage"]).nullable(),
  measurement: z.enum(["cumulative", "interval"]), coverage: z.object({ startsAt: z.string(), endsAt: z.string() }).nullable(),
  statisticsCutoffAt: z.string().nullable(), sourceTimeZone: z.string().nullable() });
const collection = z.object({ operationId: uuidSchema, projectId: uuidSchema, identityId: uuidSchema, accountId: uuidSchema,
  state: z.enum(["running", "completed", "failed", "unknown"]), pageId: z.string().regex(/^[0-9]{5,32}$/), pageUrl: z.url(), pageName: z.string(),
  collectedAt: z.string().nullable(), evidenceVerified: z.boolean(), evidenceRefs: z.array(uuidSchema), traceId: uuidSchema.nullable(), errorCode: z.string().nullable(),
  facts: z.object({ pageId: z.string(), pageUrl: z.string(), pageName: z.string(), managementVerified: z.literal(true),
    finalSubmitClicked: z.literal(false), mutationsPerformed: z.literal(0), screenTitle: z.string(), metrics: z.array(metric).min(1).max(5) }).nullable() });

/** Authenticated native-source resolver; operator requests contain only IDs.
 * Values are read from the archived Artemis operation, never accepted from Web. */
export class PageMetricSource implements TrustedMetricReportResolver {
  constructor(private pool: Pool, private auth: OperatorAuthService,
    private config: { url: string; token: string } | null) {}
  configured() { return this.config !== null; }
  private async request(path: string, init?: RequestInit) {
    if (!this.config) throw new ProductTransactionError("INTERNAL_ERROR", "手机效果采集尚未配置", true);
    const response = await fetch(new URL(`/api/runtime${path}`, this.config.url), { ...init,
      headers: { authorization: `Bearer ${this.config.token}`, "content-type": "application/json" }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new ProductTransactionError("FACT_VERSION_STALE", "请先完成 Page 身份绑定，并确认手机没有其他任务或未决占用", true);
    return response.json();
  }
  async scopeAllowed(projectId: string, identityId: string, accountId: string) {
    const result = await this.pool.query(`SELECT 1 FROM ${s}.project_identity_reservations ir
      JOIN ${s}.publishing_identities i ON i.identity_id=ir.identity_id AND i.account_id=ir.account_id AND i.platform=ir.platform
      JOIN ${s}.project_account_reservations ar ON ar.project_id=ir.project_id AND ar.account_id=ir.account_id
      WHERE ir.project_id=$1 AND ir.identity_id=$2 AND ir.account_id=$3 AND ir.platform='facebook' AND ir.state='pending_initialization'`, [projectId, identityId, accountId]);
    return result.rowCount === 1;
  }
  private async authorizeOperator(token: string, projectId: string, csrf?: string) {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); await this.auth.authenticateSessionInTransaction(client, token, csrf, csrf !== undefined);
      const rows = await client.query<{ identity_id: string; account_id: string }>(`SELECT identity_id,account_id FROM ${s}.project_identity_reservations WHERE project_id=$1 AND platform='facebook' AND state='pending_initialization'`, [projectId]);
      if (rows.rowCount !== 1) throw new ProductTransactionError("FACT_VERSION_STALE", "本项目需要唯一已保留的 Facebook Page 身份");
      await client.query("COMMIT"); return rows.rows[0]!;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async collect(token: string, csrf: string, projectId: string, operationId: string) {
    uuidSchema.parse(projectId); uuidSchema.parse(operationId);
    const target = await this.authorizeOperator(token, projectId, csrf);
    if (!await this.scopeAllowed(projectId, target.identity_id, target.account_id)) throw new ProductTransactionError("AUTHORIZATION_DENIED", "Page 账号预留已变化");
    return collection.parse(await this.request("/page-metrics", { method: "POST", body: JSON.stringify({ projectId, identityId: target.identity_id, operationId }) }));
  }
  async readLatest(token: string, projectId: string) {
    const target = await this.authorizeOperator(token, projectId);
    const jobs = z.array(collection).parse(await this.request("/page-metrics"));
    return jobs.find(job => job.projectId === projectId && job.identityId === target.identity_id && job.accountId === target.account_id) ?? null;
  }
  reports(row: z.infer<typeof collection>) {
    if (row.state !== "completed" || !row.facts || !row.collectedAt || !row.traceId || !row.evidenceVerified || row.evidenceRefs.length < 3
      || row.facts.pageId !== row.pageId || row.facts.pageUrl !== row.pageUrl || row.facts.pageName !== row.pageName) return [];
    return row.facts.metrics.map(item => metricSnapshotSchema.parse({ snapshotId: derivedId(`${row.operationId}:${item.key}:snapshot`),
      sourceId: pageMetricSourceId, sourceReportId: derivedId(`${row.operationId}:${item.key}`), definitionId: derivedId(JSON.stringify([item.key, item.label, item.unit, item.sourceDefinition, item.measurement])),
      projectId: row.projectId, identityId: row.identityId, platform: "facebook", subject: { kind: "account" }, revision: 1, replacesSnapshotId: null,
      measurement: item.measurement, ...(item.label ? { metricDefinition: { name: item.label, unit: item.unit,
        description: `平台 Page 汇总：${item.label}；不是该项目单条切片的效果。`,
        sourceDefinition: item.sourceDefinition ?? `原始界面“${row.facts!.screenTitle}”未显示计算定义；仅保留观察值。` } } : {}),
      value: item.value, availability: item.availability, missingReason: item.missingReason, sourceTimeZone: item.sourceTimeZone,
      coverage: item.coverage, statisticsCutoffAt: item.statisticsCutoffAt, collectedAt: row.collectedAt }));
  }
  async resolve(request: { sourceId: string; sourceReportId: string }, signal: AbortSignal) {
    if (request.sourceId !== pageMetricSourceId || signal.aborted) return null;
    const jobs = z.array(collection).parse(await this.request("/page-metrics"));
    for (const job of jobs) {
      const snapshot = this.reports(job).find(report => report.sourceReportId === request.sourceReportId);
      if (snapshot && await this.scopeAllowed(snapshot.projectId, snapshot.identityId, job.accountId)) return { accountId: job.accountId, snapshot };
    }
    return null;
  }
}
