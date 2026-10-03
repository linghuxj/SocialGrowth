import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { listProviderDeviceAssistanceTodosResponseSchema, uuidSchema } from "@socialgrowth/product-contracts";
import { ProviderAuthService } from "./provider-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
const query = z.strictObject({ afterTodoId: uuidSchema.nullable(), pageSize: z.int().min(1).max(50) });
const schema = "socialgrowth_product";
interface Row { todo_id: string; kind: string; status: string; fact_version: string; impact_count: string; note_count: string; notification_status: string | null; created_at: Date; updated_at: Date }
interface ImpactRow { todo_id: string; device_id: string; display_name: string; recorded_device_version: string }
export class ProviderAssistanceFeedService {
  constructor(private readonly pool: Pool, private readonly auth: ProviderAuthService) {}
  async list(token: string, input: unknown) {
    const parsed = query.safeParse(input);
    if (!parsed.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid assistance page query");
    const r = parsed.data; r.afterTodoId = r.afterTodoId?.toLowerCase() ?? null;
    let client: PoolClient;
    try { client = await this.pool.connect(); } catch { throw new ProductTransactionError("INTERNAL_ERROR", "Provider assistance unavailable", true); }
    try {
      await client.query("BEGIN"); await client.query("SET LOCAL lock_timeout='5s'"); await client.query("SET LOCAL statement_timeout='10s'");
      const actor = await this.auth.authenticateSessionInTransaction(client, token);
      if (r.afterTodoId && !(await client.query(`SELECT 1 FROM ${schema}.device_assistance_todos WHERE todo_id=$1 AND provider_id=$2`, [r.afterTodoId, actor.providerId])).rowCount) throw new ProductTransactionError("FACT_VERSION_STALE", "Assistance cursor is unavailable");
      const rows = (await client.query<Row>(`SELECT t.todo_id,t.kind,t.status,t.fact_version,t.created_at,t.updated_at,
        (SELECT count(*) FROM ${schema}.device_assistance_impacts i WHERE i.todo_id=t.todo_id)::text AS impact_count,
        (SELECT count(*) FROM ${schema}.device_assistance_notes n WHERE n.todo_id=t.todo_id)::text AS note_count,
        (SELECT status FROM ${schema}.device_assistance_notification_intents i WHERE i.todo_id=t.todo_id) AS notification_status
        FROM ${schema}.device_assistance_todos t WHERE t.provider_id=$2 AND ($1::uuid IS NULL OR (t.created_at,t.todo_id)>
          (SELECT c.created_at,c.todo_id FROM ${schema}.device_assistance_todos c WHERE c.todo_id=$1 AND c.provider_id=$2))
        ORDER BY t.created_at,t.todo_id LIMIT $3`, [r.afterTodoId, actor.providerId, r.pageSize + 1])).rows;
      const page = rows.slice(0, r.pageSize);
      if (page.some(v => v.notification_status !== "awaiting_configuration")) throw new ProductTransactionError("INTERNAL_ERROR", "Provider assistance unavailable", true);
      const impactRows = page.length === 0 ? [] : (await client.query<ImpactRow>(`SELECT i.todo_id,i.device_id,d.display_name,i.recorded_device_version::text
        FROM ${schema}.device_assistance_impacts i
        JOIN ${schema}.device_associations a ON a.device_id=i.device_id AND a.provider_id=$1 AND a.ended_at IS NULL
        JOIN ${schema}.devices d ON d.device_id=i.device_id
        WHERE i.provider_id=$1 AND i.todo_id=ANY($2::uuid[])
        ORDER BY i.todo_id,i.device_id`, [actor.providerId, page.map(v => v.todo_id)])).rows;
      const impactsByTodo = new Map<string, ImpactRow[]>();
      for (const impact of impactRows) {
        const current = impactsByTodo.get(impact.todo_id) ?? [];
        current.push(impact);
        impactsByTodo.set(impact.todo_id, current);
      }
      const result = listProviderDeviceAssistanceTodosResponseSchema.parse({ todos: page.map(v => ({ todoId: v.todo_id, originScope: "unassigned_device",
        kind: v.kind, status: v.status, factVersion: Number(v.fact_version), impactCount: Number(v.impact_count), noteCount: Number(v.note_count), createdAt: v.created_at.toISOString(), updatedAt: v.updated_at.toISOString(),
        impacts: (impactsByTodo.get(v.todo_id) ?? []).map(i => ({ deviceId: i.device_id, deviceLabel: i.display_name, recordedDeviceVersion: Number(i.recorded_device_version) })) })), nextAfterTodoId: rows.length > r.pageSize ? page.at(-1)!.todo_id : null });
      if (!(await client.query(`SELECT 1 FROM ${schema}.provider_sessions WHERE session_id=$1 AND provider_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp()`, [actor.sessionId, actor.providerId])).rowCount) throw new ProductTransactionError("AUTHENTICATION_REQUIRED", "Provider session expired");
      await client.query("COMMIT"); return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { throw new ProductTransactionError("INTERNAL_ERROR", "Provider assistance unavailable", true); }
      if (error instanceof ProductTransactionError) throw error;
      throw new ProductTransactionError("INTERNAL_ERROR", "Provider assistance unavailable", true);
    } finally { client.release(); }
  }
}
