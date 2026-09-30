import assert from "node:assert/strict";
import test from "node:test";
import { deviceAssistanceTodoSummarySchema, listDeviceAssistanceTodosResponseSchema } from "./device-assistance.js";
const id = "00000000-0000-4000-8000-00000000000a";
const summary = { todoId: id, occurrenceId: id, providerId: id, initialResponsibleOperatorId: id, originScope: "unassigned_device", kind: "network_access_help", status: "awaiting_recheck", factVersion: 1,
  impactCount: 1, noteCount: 1, notificationStatus: "awaiting_configuration", createdAt: "2026-09-30T00:00:00Z", updatedAt: "2026-09-30T00:00:00Z" };
test("assistance feed projects pending history, never grants execution, claims notification or exposes credentials", () => {
  assert.deepEqual(deviceAssistanceTodoSummarySchema.parse(summary), summary);
  for (const patch of [{ permissionGranted: true }, { status: "resolved" }, { projectId: id }, { notificationStatus: "sent" }, { impactCount: 0 }, { noteCount: -1 }, { noteCount: 0 }, { updatedAt: "2026-09-29T00:00:00Z" }, { rawError: "fixture-secret" }]) assert.equal(deviceAssistanceTodoSummarySchema.safeParse({ ...summary, ...patch }).success, false);
});
test("assistance page cursor identifies the last row and summaries cannot repeat UUIDs across casing", () => {
  assert.deepEqual(listDeviceAssistanceTodosResponseSchema.parse({ todos: [], nextAfterTodoId: null }), { todos: [], nextAfterTodoId: null });
  assert.equal(listDeviceAssistanceTodosResponseSchema.safeParse({ todos: [summary], nextAfterTodoId: id }).success, true);
  for (const input of [{ todos: [], nextAfterTodoId: id }, { todos: [summary], nextAfterTodoId: "00000000-0000-4000-8000-000000000002" },
    { todos: [summary, { ...summary, todoId: id.toUpperCase() }], nextAfterTodoId: null }, { todos: Array(51).fill(summary), nextAfterTodoId: null }]) assert.equal(listDeviceAssistanceTodosResponseSchema.safeParse(input).success, false);
});
