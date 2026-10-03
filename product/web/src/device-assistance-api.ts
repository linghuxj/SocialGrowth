import {
  contractVersion, listDeviceAssistanceTodosResponseSchema, listDeviceAssistanceNotesResponseSchema,
  listDeviceAssistanceImpactsResponseSchema,
  recordDeviceAssistanceNoteRequestSchema, recordDeviceAssistanceNoteResponseSchema,
  type DeviceAssistanceImpact, type DeviceAssistanceTodoSummary,
} from "@socialgrowth/product-contracts";
import { newIdempotencyKey, prepareOperatorPost, readOperatorResource, type ProductApiError } from "./operator-api.js";

export type AssistanceTodo = DeviceAssistanceTodoSummary;
export interface AssistanceNote { noteId: string; actorId: string; kind: "note" | "reported_processed"; text: string; recordedAt: string }
export interface AssistanceTodosPage { todos: AssistanceTodo[]; nextAfterTodoId: string | null }
export interface AssistanceNotesPage { todo: AssistanceTodo; notes: AssistanceNote[]; nextAfterNoteId: string | null }
export interface AssistanceImpactsPage { todoId: string; impacts: DeviceAssistanceImpact[]; nextAfterDeviceId: string | null }
export type AssistanceNoteKind = "note" | "reported_processed";

export function listAssistanceTodos(afterTodoId?: string): Promise<AssistanceTodosPage> {
  const query = new URLSearchParams({ pageSize: "20" });
  if (afterTodoId) query.set("afterTodoId", afterTodoId);
  return readOperatorResource(`/api/operator/assistance-todos?${query}`, listDeviceAssistanceTodosResponseSchema);
}

export function listAssistanceNotes(todoId: string, afterNoteId?: string): Promise<AssistanceNotesPage> {
  const query = new URLSearchParams({ pageSize: "50" });
  if (afterNoteId) query.set("afterNoteId", afterNoteId);
  return readOperatorResource(`/api/operator/assistance-todos/${encodeURIComponent(todoId)}/notes?${query}`, listDeviceAssistanceNotesResponseSchema);
}

export function listAssistanceImpacts(todoId: string, afterDeviceId?: string): Promise<AssistanceImpactsPage> {
  const query = new URLSearchParams({ pageSize: "20" });
  if (afterDeviceId) query.set("afterDeviceId", afterDeviceId);
  return readOperatorResource(`/api/operator/assistance-todos/${encodeURIComponent(todoId)}/impacts?${query}`, listDeviceAssistanceImpactsResponseSchema);
}

export interface PreparedAssistanceNote { key: string; body: string; submit: () => Promise<unknown> }
export function prepareAssistanceNote(todo: AssistanceTodo, kind: AssistanceNoteKind, text: string): PreparedAssistanceNote {
  const key = newIdempotencyKey();
  const body = JSON.stringify(recordDeviceAssistanceNoteRequestSchema.parse({
    metadata: { contractVersion, requestId: `request-${crypto.randomUUID()}`, idempotencyKey: key },
    todoId: todo.todoId, expectedFactVersion: todo.factVersion, kind, text,
  }));
  const submit = prepareOperatorPost(`/api/operator/assistance-todos/${todo.todoId}/notes`, body, recordDeviceAssistanceNoteResponseSchema);
  return { key, body, submit };
}

export function isDefinitiveAssistanceRejection(error: unknown): error is ProductApiError {
  return error instanceof Error && "response" in error && "status" in error
    && (error as ProductApiError).response.error.retryable === false
    && ((error as ProductApiError).status === 400 || (error as ProductApiError).status === 409);
}
