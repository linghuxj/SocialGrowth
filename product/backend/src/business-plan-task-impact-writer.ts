import type { PoolClient } from "pg";
import { ProductTransactionError } from "./product-transaction-error.js";

const s = "socialgrowth_product";
type Reason = "project_scope_changed" | "material_revision_changed" | "project_lifecycle_intent_changed" | "material_withdrawn";

async function append(c: PoolClient, input: {
  projectId: string;
  reason: Reason;
  sourceVersion: number;
  observedProjectVersion: number;
  variantId?: string;
  observedMaterialRevision?: number;
}) {
  const values: unknown[] = [input.projectId];
  const variantFilter = input.variantId ? "AND t.variant_id=$2" : "";
  if (input.variantId) values.push(input.variantId);
  const tasks = await c.query<{ task_id: string }>(
    `SELECT t.task_id FROM ${s}.business_plan_tasks t
      WHERE t.project_id=$1 ${variantFilter} ORDER BY t.task_id`, values);

  for (const task of tasks.rows) {
    const outbox = (await c.query<{ project_id: string; current_impact_revision: string }>(
      `SELECT project_id,current_impact_revision::text FROM ${s}.business_plan_outbox WHERE task_id=$1 FOR UPDATE`, [task.task_id])).rows[0];
    if (!outbox || outbox.project_id !== input.projectId) throw unavailable();
    const prior = (await c.query<{ impact_revision: string; observed_project_version: string; observed_material_revision: string | null }>(
      `SELECT impact_revision::text,observed_project_version::text,observed_material_revision::text
         FROM ${s}.business_plan_outbox_impacts WHERE task_id=$1 AND reason=$2 AND source_version=$3`,
      [task.task_id, input.reason, input.sourceVersion])).rows[0];
    if (prior) {
      if (Number(prior.observed_project_version) !== input.observedProjectVersion
        || (prior.observed_material_revision === null ? null : Number(prior.observed_material_revision)) !== (input.observedMaterialRevision ?? null)
        || Number(prior.impact_revision) > Number(outbox.current_impact_revision)) throw unavailable();
      continue;
    }

    const expected = Number(outbox.current_impact_revision);
    if (!Number.isSafeInteger(expected) || expected >= Number.MAX_SAFE_INTEGER) throw unavailable();
    const next = expected + 1;
    const advanced = await c.query(
      `UPDATE ${s}.business_plan_outbox SET current_impact_revision=$2
        WHERE task_id=$1 AND project_id=$3 AND current_impact_revision=$4
          AND purpose='current_check_reference' AND state='pending_current_checks'
          AND execution_allowed=false AND publication_allowed=false`,
      [task.task_id, next, input.projectId, expected]);
    if (advanced.rowCount !== 1) throw unavailable();
    const inserted = await c.query(
      `INSERT INTO ${s}.business_plan_outbox_impacts(task_id,impact_revision,reason,source_version,observed_project_version,observed_material_revision)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [task.task_id, next, input.reason, input.sourceVersion, input.observedProjectVersion, input.observedMaterialRevision ?? null]);
    if (inserted.rowCount !== 1) throw unavailable();
  }
  return tasks.rowCount;
}

function unavailable(): ProductTransactionError {
  return new ProductTransactionError("INTERNAL_ERROR", "Task impact reference could not be recorded", true);
}

export function appendProjectScopeChanged(c: PoolClient, projectId: string, projectVersion: number) {
  return append(c, { projectId, reason: "project_scope_changed", sourceVersion: projectVersion, observedProjectVersion: projectVersion });
}

export function appendMaterialRevisionChanged(c: PoolClient, input: {
  projectId: string;
  variantId: string;
  projectVersion: number;
  materialRevision: number;
}) {
  return append(c, { projectId: input.projectId, variantId: input.variantId, reason: "material_revision_changed",
    sourceVersion: input.materialRevision, observedProjectVersion: input.projectVersion, observedMaterialRevision: input.materialRevision });
}

export function appendProjectLifecycleIntentChanged(c: PoolClient, input: {
  projectId: string;
  lifecycleRevision: number;
  projectVersion: number;
}) {
  return append(c, { projectId: input.projectId, reason: "project_lifecycle_intent_changed",
    sourceVersion: input.lifecycleRevision, observedProjectVersion: input.projectVersion });
}

export function appendMaterialWithdrawn(c: PoolClient, input: {
  projectId: string;
  variantId: string;
  projectVersion: number;
  materialRevision: number;
}) {
  return append(c, { projectId: input.projectId, variantId: input.variantId, reason: "material_withdrawn",
    sourceVersion: input.materialRevision, observedProjectVersion: input.projectVersion, observedMaterialRevision: input.materialRevision });
}
