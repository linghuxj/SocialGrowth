import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { deviceAssistanceTodoSummarySchema, listDeviceAssistanceNotesResponseSchema, uuidSchema } from "@socialgrowth/product-contracts";
import { OperatorAuthService } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
const query = z.strictObject({ afterNoteId: uuidSchema.nullable(), pageSize: z.int().min(1).max(50) });
const schema = "socialgrowth_product";
interface TodoRow { todo_id: string; occurrence_id: string; provider_id: string; initial_responsible_operator_id: string; kind: string; status: string; fact_version: string; impact_count: string; note_count: string; notification_status: string; note_times_valid: boolean; created_at: Date; updated_at: Date }
interface NoteRow { note_id: string; actor_id: string; kind: string; text: string; recorded_at: Date }
export class DeviceAssistanceNotesService {
  constructor(private readonly pool: Pool, private readonly auth: OperatorAuthService) {}
  async list(token: string, todoId: string, input: unknown) {
    const parsed = query.safeParse(input), todo = uuidSchema.safeParse(todoId);
    if (!parsed.success || !todo.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid assistance notes query");
    const id = todo.data.toLowerCase(), r = parsed.data; r.afterNoteId = r.afterNoteId?.toLowerCase() ?? null;
    let client: PoolClient;
    try { client = await this.pool.connect(); } catch { throw new ProductTransactionError("INTERNAL_ERROR", "Assistance notes unavailable", true); }
    try {
      await client.query("BEGIN"); await client.query("SET LOCAL lock_timeout='5s'"); await client.query("SET LOCAL statement_timeout='10s'");
      await client.query(`LOCK TABLE ${schema}.operators IN SHARE ROW EXCLUSIVE MODE`);
      const actor = await this.auth.authenticateSessionInTransaction(client, token);
      const row = (await client.query<TodoRow>(`SELECT t.*,
        (SELECT count(*) FROM ${schema}.device_assistance_impacts i WHERE i.todo_id=t.todo_id)::text AS impact_count,
        (SELECT count(*) FROM ${schema}.device_assistance_notes n WHERE n.todo_id=t.todo_id)::text AS note_count,
        (SELECT status FROM ${schema}.device_assistance_notification_intents i WHERE i.todo_id=t.todo_id) AS notification_status,
        (t.updated_at>=t.created_at AND NOT EXISTS(SELECT 1 FROM ${schema}.device_assistance_notes n
          WHERE n.todo_id=t.todo_id AND (n.recorded_at<t.created_at OR n.recorded_at>t.updated_at))) AS note_times_valid
        FROM ${schema}.device_assistance_todos t WHERE t.todo_id=$1 FOR SHARE OF t`, [id])).rows[0];
      if (!row) throw new ProductTransactionError("FACT_VERSION_STALE", "Assistance item is unavailable");
      // Validate raw PostgreSQL instants before the driver Date projection loses
      // sub-millisecond precision. Check the whole item's history, not just a
      // displayed page, so an off-page corrupt note cannot masquerade as valid.
      if (row.note_times_valid !== true) throw new ProductTransactionError("INTERNAL_ERROR", "Assistance notes unavailable", true);
      const summary = deviceAssistanceTodoSummarySchema.parse({ todoId: row.todo_id, occurrenceId: row.occurrence_id, providerId: row.provider_id, initialResponsibleOperatorId: row.initial_responsible_operator_id,
        originScope: "unassigned_device", kind: row.kind, status: row.status, factVersion: Number(row.fact_version), impactCount: Number(row.impact_count), noteCount: Number(row.note_count), notificationStatus: row.notification_status, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() });
      if (r.afterNoteId && !(await client.query(`SELECT 1 FROM ${schema}.device_assistance_notes WHERE note_id=$1 AND todo_id=$2`, [r.afterNoteId, id])).rowCount) throw new ProductTransactionError("FACT_VERSION_STALE", "Assistance notes cursor is unavailable");
      const rows = (await client.query<NoteRow>(`SELECT n.note_id,n.actor_id,n.kind,n.text,n.recorded_at FROM ${schema}.device_assistance_notes n WHERE n.todo_id=$2 AND ($1::uuid IS NULL OR (n.recorded_at,n.note_id)>
        (SELECT c.recorded_at,c.note_id FROM ${schema}.device_assistance_notes c WHERE c.note_id=$1 AND c.todo_id=$2)) ORDER BY n.recorded_at,n.note_id LIMIT $3`, [r.afterNoteId, id, r.pageSize + 1])).rows;
      const page = rows.slice(0, r.pageSize), result = listDeviceAssistanceNotesResponseSchema.parse({ todo: summary, notes: page.map(n => ({ noteId: n.note_id, actorId: n.actor_id, kind: n.kind, text: n.text, recordedAt: n.recorded_at.toISOString() })), nextAfterNoteId: rows.length > r.pageSize ? page.at(-1)!.note_id : null });
      if (!(await client.query(`SELECT 1 FROM ${schema}.operator_sessions WHERE session_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()`, [actor.sessionId])).rowCount) throw new ProductTransactionError("AUTHENTICATION_REQUIRED", "Operator session expired");
      await client.query("COMMIT"); return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { throw new ProductTransactionError("INTERNAL_ERROR", "Assistance notes unavailable", true); }
      if (error instanceof ProductTransactionError) throw error;
      throw new ProductTransactionError("INTERNAL_ERROR", "Assistance notes unavailable", true);
    } finally { client.release(); }
  }
}
