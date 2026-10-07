import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { listDeviceAssistanceTodosResponseSchema, recordDeviceAssistanceNoteRequestSchema, recordDeviceAssistanceNoteResponseSchema, uuidSchema } from "@socialgrowth/product-contracts";
import { DeviceAssistanceTodoStore } from "./device-assistance-todo-store.js";
import { OperatorAuthService } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
const querySchema = z.strictObject({ afterTodoId: uuidSchema.nullable(), pageSize: z.int().min(1).max(50) });
const schema = "socialgrowth_product";
interface Row { todo_id: string; occurrence_id: string; provider_id: string; initial_responsible_operator_id: string; kind: string; status: string; fact_version: string; impact_count: string; note_count: string; notification_status: string; created_at: Date; updated_at: Date }
export class DeviceAssistanceFeedService {
  constructor(private readonly pool: Pool, private readonly auth: OperatorAuthService) {}
  async recordNote(token: string, csrf: string, input: unknown) {
    const parsed = recordDeviceAssistanceNoteRequestSchema.safeParse(input);
    if (!parsed.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid assistance note");
    // Reuse the proven transactional command: no second read transaction after
    // commit could turn an accepted note into a misleading definitive 401.
    const v = await new DeviceAssistanceTodoStore(this.pool, this.auth).recordNote(token, csrf, parsed.data);
    const result = recordDeviceAssistanceNoteResponseSchema.safeParse({ todo: { todoId: v.todoId, occurrenceId: v.occurrenceId, providerId: v.providerId,
      initialResponsibleOperatorId: v.initialResponsibleOperatorId, originScope: "unassigned_device", kind: v.kind, status: v.status, factVersion: v.factVersion,
      impactCount: v.impacts.length, noteCount: v.notes.length, notificationStatus: v.notification.status, createdAt: v.createdAt, updatedAt: v.updatedAt } });
    // Invalid persisted projection is not bad user input. The command may have
    // committed already: retain its original key and return a safe unknown result.
    if (!result.success) throw new ProductTransactionError("INTERNAL_ERROR", "Assistance note result unavailable", true);
    return result.data;
  }
  async list(token: string, input: unknown) {
    const parsed = querySchema.safeParse(input);
    if (!parsed.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid assistance page query");
    const r = parsed.data; r.afterTodoId = r.afterTodoId?.toLowerCase() ?? null;
    let client: PoolClient;
    try { client = await this.pool.connect(); } catch { throw new ProductTransactionError("INTERNAL_ERROR", "Assistance feed unavailable", true); }
    try {
      await client.query("BEGIN"); await client.query("SET LOCAL lock_timeout='5s'"); await client.query("SET LOCAL statement_timeout='10s'");
      await client.query(`LOCK TABLE ${schema}.operators IN SHARE ROW EXCLUSIVE MODE`);
      const actor = await this.auth.authenticateSessionInTransaction(client, token);
      if (r.afterTodoId && !(await client.query(`SELECT 1 FROM ${schema}.device_assistance_todos WHERE todo_id=$1`, [r.afterTodoId])).rowCount) throw new ProductTransactionError("FACT_VERSION_STALE", "Assistance page cursor no longer exists");
      // The cursor is resolved to its full database timestamp, not its displayed
      // millisecond Date. Actor ownership is responsibility, never visibility.
      const rows = (await client.query<Row>(`SELECT t.*,
        (SELECT count(*) FROM ${schema}.device_assistance_impacts i WHERE i.todo_id=t.todo_id)::text AS impact_count,
        (SELECT count(*) FROM ${schema}.device_assistance_notes n WHERE n.todo_id=t.todo_id)::text AS note_count,
        (SELECT status FROM ${schema}.device_assistance_notification_intents s WHERE s.todo_id=t.todo_id) AS notification_status
        FROM ${schema}.device_assistance_todos t WHERE $1::uuid IS NULL OR (t.created_at,t.todo_id)>
          (SELECT c.created_at,c.todo_id FROM ${schema}.device_assistance_todos c WHERE c.todo_id=$1)
        ORDER BY t.created_at,t.todo_id LIMIT $2`, [r.afterTodoId, r.pageSize + 1])).rows;
      const page = rows.slice(0, r.pageSize), result = listDeviceAssistanceTodosResponseSchema.parse({ todos: page.map(v => ({
        todoId: v.todo_id, occurrenceId: v.occurrence_id, providerId: v.provider_id, initialResponsibleOperatorId: v.initial_responsible_operator_id,
        originScope: "unassigned_device", kind: v.kind, status: v.status, factVersion: Number(v.fact_version), impactCount: Number(v.impact_count), noteCount: Number(v.note_count),
        notificationStatus: v.notification_status, createdAt: v.created_at.toISOString(), updatedAt: v.updated_at.toISOString(),
      })), nextAfterTodoId: rows.length > r.pageSize ? page.at(-1)!.todo_id : null });
      if (!(await client.query(`SELECT 1 FROM ${schema}.operator_sessions WHERE session_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()`, [actor.sessionId])).rowCount) throw new ProductTransactionError("AUTHENTICATION_REQUIRED", "Operator session expired");
      await client.query("COMMIT"); return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { throw new ProductTransactionError("INTERNAL_ERROR", "Assistance feed unavailable", true); }
      if (error instanceof ProductTransactionError) throw error;
      throw new ProductTransactionError("INTERNAL_ERROR", "Assistance feed unavailable", true);
    } finally { client.release(); }
  }
}
