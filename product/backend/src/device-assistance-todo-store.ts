import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { uuidSchema } from "@socialgrowth/product-contracts";
import { assistanceEventSchema, assistanceNoteRequestSchema, assistanceTodoViewSchema, type AssistanceTodoView } from "./device-assistance-todo.js";
import { TaskAssistanceRecheckStore } from "./task-assistance-recheck-store.js";
import { OperatorAuthService } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
const schema = "socialgrowth_product";
const stale = () => new ProductTransactionError("FACT_VERSION_STALE", "Assistance facts changed; re-read current records");
const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest();
interface TodoRow { todo_id: string; occurrence_id: string; provider_id: string; initial_responsible_operator_id: string; kind: string; status: string; fact_version: string; created_at: Date; updated_at: Date }
export class DeviceAssistanceTodoStore {
  constructor(private readonly pool: Pool, private readonly auth: OperatorAuthService) {}
  private async tx<T>(fn: (client: PoolClient) => Promise<T>) {
    let client: PoolClient;
    try { client = await this.pool.connect(); } catch { throw new ProductTransactionError("INTERNAL_ERROR", "Assistance service unavailable", true); }
    try {
      await client.query("BEGIN"); await client.query("SET LOCAL lock_timeout='5s'"); await client.query("SET LOCAL statement_timeout='10s'");
      // Shared metadata order with projects/reservations. Never lock an inviter
      // after a different actor without this metadata serialization barrier.
      await client.query(`LOCK TABLE ${schema}.operators IN SHARE ROW EXCLUSIVE MODE`);
      const result = await fn(client); await client.query("COMMIT"); return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { throw new ProductTransactionError("INTERNAL_ERROR", "Assistance service unavailable", true); }
      if (error instanceof ProductTransactionError) throw error;
      throw new ProductTransactionError("INTERNAL_ERROR", "Assistance service unavailable", true);
    } finally { client.release(); }
  }
  private async operatorTx<T>(token: string, csrf: string | null, fn: (client: PoolClient, actor: string) => Promise<T>): Promise<T> {
    return this.tx(async client => {
      const actor = await this.auth.authenticateSessionInTransaction(client, token, csrf ?? undefined, csrf !== null);
      const result = await fn(client, actor.operator.operatorId);
      if (!(await client.query(`SELECT 1 FROM ${schema}.operator_sessions WHERE session_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()`, [actor.sessionId])).rowCount) {
        throw new ProductTransactionError("AUTHENTICATION_REQUIRED", "Operator session expired");
      }
      return result;
    });
  }
  private async load(client: PoolClient, todoId: string): Promise<AssistanceTodoView> {
    const row = (await client.query<TodoRow>(`SELECT * FROM ${schema}.device_assistance_todos WHERE todo_id=$1 FOR UPDATE`, [todoId])).rows[0];
    if (!row) throw stale();
    const impacts = await client.query<{ device_id: string; association_id: string; recorded_device_version: string; recorded_at: Date }>(`SELECT * FROM ${schema}.device_assistance_impacts WHERE todo_id=$1 ORDER BY device_id`, [todoId]);
    const notes = await client.query<{ note_id: string; actor_id: string; kind: string; text: string; recorded_at: Date }>(`SELECT * FROM ${schema}.device_assistance_notes WHERE todo_id=$1 ORDER BY recorded_at,note_id`, [todoId]);
    const notification = (await client.query<{ status: string }>(`SELECT status FROM ${schema}.device_assistance_notification_intents WHERE todo_id=$1`, [todoId])).rows[0];
    return assistanceTodoViewSchema.parse({ todoId, occurrenceId: row.occurrence_id, providerId: row.provider_id, initialResponsibleOperatorId: row.initial_responsible_operator_id,
      kind: row.kind, status: row.status, factVersion: Number(row.fact_version), createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
      impacts: impacts.rows.map(v => ({ deviceId: v.device_id, associationId: v.association_id, recordedDeviceVersion: Number(v.recorded_device_version), recordedAt: v.recorded_at.toISOString() })),
      notes: notes.rows.map(v => ({ noteId: v.note_id, actorId: v.actor_id, kind: v.kind, text: v.text, recordedAt: v.recorded_at.toISOString() })), notification });
  }
  private async audit(client: PoolClient, todoId: string, actor: string | null, action: string, requestId: string, version: number) {
    await client.query(`INSERT INTO ${schema}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts)
      VALUES($1,$2,$3,$4,'device_assistance_todo',$5,$6,$7)`, [randomUUID(), actor ? "operator" : "system", actor, action, todoId, requestId, { factVersion: version }]);
  }
  // INTERNAL ONLY: an authenticated upstream human-required event producer must
  // assign eventId/occurrenceId, not an HTTP client/model/error text. Not wired.
  async ingestUnassignedDeviceEvent(input: unknown): Promise<AssistanceTodoView> {
    const parsed = assistanceEventSchema.safeParse(input);
    if (!parsed.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid assistance event");
    const r = parsed.data, hash = digest(r);
    return this.tx(async client => {
      if (!(await client.query(`SELECT singleton FROM ${schema}.resource_reservation_guard WHERE singleton=true FOR UPDATE`)).rowCount) throw stale();
      const command = (await client.query<{ todo_id: string; payload_digest: Buffer }>(`SELECT todo_id,payload_digest FROM ${schema}.device_assistance_events WHERE event_id=$1`, [r.eventId])).rows[0];
      if (command) {
        if (!command.payload_digest.equals(hash)) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Event identifier belongs to different facts");
        return this.load(client, command.todo_id); // No new notification or grant.
      }
      const locator = (await client.query<{ provider_id: string; installation_id: string }>(`SELECT provider_id,installation_id FROM ${schema}.device_associations WHERE device_id=$1 AND ended_at IS NULL`, [r.deviceId])).rows[0];
      if (!locator) throw stale();
      await client.query(`SELECT provider_id FROM ${schema}.providers WHERE provider_id=$1 FOR UPDATE`, [locator.provider_id]);
      await client.query(`SELECT installation_id FROM ${schema}.installations WHERE installation_id=$1 FOR UPDATE`, [locator.installation_id]);
      const authority = (await client.query<{ association_id: string; provider_id: string; initial_responsible_operator_id: string; fact_version: string }>(`SELECT a.association_id,a.provider_id,v.created_by_operator_id AS initial_responsible_operator_id,d.fact_version::text
        FROM ${schema}.device_associations a JOIN ${schema}.devices d ON d.device_id=a.device_id
        JOIN ${schema}.installations i ON i.installation_id=a.installation_id JOIN ${schema}.providers p ON p.provider_id=a.provider_id
        JOIN ${schema}.provider_invitation_consumptions c ON c.provider_id=a.provider_id JOIN ${schema}.provider_invitations v ON v.invitation_id=c.invitation_id
        WHERE a.device_id=$1 AND a.provider_id=$2 AND a.installation_id=$3 AND a.ended_at IS NULL
          AND i.status='active' AND p.status='active' AND d.state NOT IN ('unassociated','exit_pending','exited')
          AND NOT EXISTS(SELECT 1 FROM ${schema}.project_device_reservations reserved WHERE reserved.device_id=d.device_id)
        FOR UPDATE OF a,d`, [r.deviceId, locator.provider_id, locator.installation_id])).rows[0];
      if (!authority || Number(authority.fact_version) !== r.expectedDeviceVersion) throw stale();
      let current = (await client.query<TodoRow>(`SELECT * FROM ${schema}.device_assistance_todos WHERE provider_id=$1 AND occurrence_id=$2 FOR UPDATE`, [authority.provider_id, r.occurrenceId])).rows[0];
      if (!current) {
        current = (await client.query<TodoRow>(`INSERT INTO ${schema}.device_assistance_todos(todo_id,occurrence_id,provider_id,initial_responsible_operator_id) VALUES($1,$2,$3,$4) RETURNING *`, [randomUUID(), r.occurrenceId, authority.provider_id, authority.initial_responsible_operator_id])).rows[0]!;
        await client.query(`INSERT INTO ${schema}.device_assistance_notification_intents(todo_id) VALUES($1)`, [current.todo_id]);
      } else if (current.initial_responsible_operator_id !== authority.initial_responsible_operator_id) throw stale();
      const impact = (await client.query<{ association_id: string; recorded_device_version: string }>(`SELECT association_id,recorded_device_version::text FROM ${schema}.device_assistance_impacts WHERE todo_id=$1 AND device_id=$2`, [current.todo_id, r.deviceId])).rows[0];
      if (impact && (impact.association_id !== authority.association_id || Number(impact.recorded_device_version) !== r.expectedDeviceVersion)) throw stale();
      if (!impact) {
        if (Number(current.fact_version) === Number.MAX_SAFE_INTEGER) throw stale();
        await client.query(`INSERT INTO ${schema}.device_assistance_impacts(todo_id,provider_id,device_id,association_id,recorded_device_version) VALUES($1,$2,$3,$4,$5)`, [current.todo_id, authority.provider_id, r.deviceId, authority.association_id, r.expectedDeviceVersion]);
        await client.query(`UPDATE ${schema}.device_assistance_todos SET status='open',fact_version=fact_version+1,updated_at=clock_timestamp() WHERE todo_id=$1`, [current.todo_id]);
        await this.audit(client, current.todo_id, null, "todo.impact_added", r.eventId, Number(current.fact_version) + 1);
      }
      await client.query(`INSERT INTO ${schema}.device_assistance_events(event_id,payload_digest,todo_id) VALUES($1,$2,$3)`, [r.eventId, hash, current.todo_id]);
      return this.load(client, current.todo_id);
    });
  }
  async read(token: string, todoId: string): Promise<AssistanceTodoView> {
    if (!uuidSchema.safeParse(todoId).success) throw new ProductTransactionError("INPUT_INVALID", "Invalid assistance identifier");
    return this.operatorTx(token, null, client => this.load(client, todoId.toLowerCase()));
  }
  async recordNote(token: string, csrf: string, input: unknown): Promise<AssistanceTodoView> {
    const parsed = assistanceNoteRequestSchema.safeParse(input);
    if (!parsed.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid assistance note");
    const r = parsed.data, { requestId: _requestId, ...metadata } = r.metadata, hash = digest({ ...r, metadata });
    return this.operatorTx(token, csrf, async (client, actor) => {
      const command = (await client.query<{ todo_id: string; payload_digest: Buffer }>(`SELECT todo_id,payload_digest FROM ${schema}.device_assistance_commands WHERE actor_id=$1 AND request_key=$2`, [actor, metadata.idempotencyKey])).rows[0];
      if (command) {
        if (!command.payload_digest.equals(hash) || command.todo_id !== r.todoId) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Note key belongs to different inputs");
        return this.load(client, command.todo_id);
      }
      const current = await this.load(client, r.todoId);
      if (current.factVersion !== r.expectedFactVersion || current.factVersion === Number.MAX_SAFE_INTEGER) throw stale();
      const noteId = randomUUID();
      await client.query(`INSERT INTO ${schema}.device_assistance_notes(note_id,todo_id,actor_id,kind,text) VALUES($1,$2,$3,$4,$5)`, [noteId, r.todoId, actor, r.kind, r.text]);
      if (r.kind === "reported_processed") await TaskAssistanceRecheckStore.requestForReportedNote(client, r.todoId, noteId);
      await client.query(`UPDATE ${schema}.device_assistance_todos SET status=$2,fact_version=fact_version+1,updated_at=clock_timestamp() WHERE todo_id=$1`, [r.todoId, r.kind === "reported_processed" ? "awaiting_recheck" : current.status]);
      await this.audit(client, r.todoId, actor, "todo.note_recorded", r.metadata.requestId, current.factVersion + 1);
      await client.query(`INSERT INTO ${schema}.device_assistance_commands(actor_id,request_key,payload_digest,todo_id) VALUES($1,$2,$3,$4)`, [actor, metadata.idempotencyKey, hash, r.todoId]);
      return this.load(client, r.todoId);
    });
  }
}
