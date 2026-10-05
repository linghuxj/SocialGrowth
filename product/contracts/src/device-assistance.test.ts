import assert from "node:assert/strict";
import test from "node:test";
import { deviceAssistanceTodoSummarySchema, listDeviceAssistanceTodosResponseSchema, recordDeviceAssistanceNoteRequestSchema, recordDeviceAssistanceNoteResponseSchema, providerDeviceAssistanceTodoSummarySchema, listProviderDeviceAssistanceTodosResponseSchema, listDeviceAssistanceNotesResponseSchema, listDeviceAssistanceImpactsResponseSchema, operatorAssistanceTodoDetailResponseSchema } from "./device-assistance.js";
import { contractVersion } from "./common.js";
const id = "00000000-0000-4000-8000-00000000000a";
const summary = { todoId: id, occurrenceId: id, providerId: id, initialResponsibleOperatorId: id, originScope: "unassigned_device", kind: "network_access_help", status: "awaiting_recheck", factVersion: 1,
  impactCount: 1, noteCount: 1, notificationStatus: "awaiting_configuration", createdAt: "2026-09-30T00:00:00Z", updatedAt: "2026-09-30T00:00:00Z" };
test("assistance note command is bounded, strict and cannot claim verification or recipient authority", () => {
  const input = { metadata: { contractVersion, requestId: "note-request", idempotencyKey: "note-command-0001" }, todoId: id, expectedFactVersion: 1, kind: "reported_processed", text: "已处理，等待真实复核" };
  assert.deepEqual(recordDeviceAssistanceNoteRequestSchema.parse(input), input);
  for (const patch of [{ kind: "verified" }, { text: "x".repeat(151) }, { text: " padded " }, { text: "two\nlines" }, { actorId: id }, { recipient: "fixture@example.test" }, { expectedFactVersion: -1 }]) assert.equal(recordDeviceAssistanceNoteRequestSchema.safeParse({ ...input, ...patch }).success, false);
  assert.deepEqual(recordDeviceAssistanceNoteResponseSchema.parse({ todo: summary }), { todo: summary });
  for (const patch of [{ status: "resolved" }, { noteCount: 0 }, { permissionGranted: true }]) assert.equal(recordDeviceAssistanceNoteResponseSchema.safeParse({ todo: { ...summary, ...patch } }).success, false);
});
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
test("all assistance response shapes share representable calendar years without losing fraction or offset ordering", () => {
  const shapes = [deviceAssistanceTodoSummarySchema, listDeviceAssistanceTodosResponseSchema, recordDeviceAssistanceNoteResponseSchema];
  for (const time of ["0001-01-01T00:00:00Z", "9999-12-31T23:59:59Z", "0000-01-01T00:00:00Z", "10000-01-01T00:00:00Z"]) {
    const value = { ...summary, createdAt: time, updatedAt: time }, inputs = [value, { todos: [value], nextAfterTodoId: null }, { todo: value }];
    shapes.forEach((schema, i) => assert.equal(schema.safeParse(inputs[i]).success, time.startsWith("0001") || time.startsWith("9999")));
  }
  const first = "2026-09-30T00:00:00.12345678901234567890Z", later = "2026-09-30T01:00:00.12345678901234567891+01:00";
  assert.equal(deviceAssistanceTodoSummarySchema.safeParse({ ...summary, createdAt: first, updatedAt: later }).success, true);
  assert.equal(deviceAssistanceTodoSummarySchema.safeParse({ ...summary, createdAt: later, updatedAt: first }).success, false);
});
test("provider summary preserves aggregate progress but excludes operator responsibility and private history", () => {
  const value = { todoId: id, originScope: summary.originScope, kind: summary.kind, status: summary.status, factVersion: summary.factVersion, impactCount: 1, noteCount: 1, createdAt: summary.createdAt, updatedAt: summary.updatedAt };
  assert.deepEqual(providerDeviceAssistanceTodoSummarySchema.parse(value), value);
  for (const patch of [{ providerId: id }, { initialResponsibleOperatorId: id }, { text: "internal" }, { notificationStatus: "sent" }, { noteCount: 0 }, { createdAt: "0000-01-01T00:00:00Z" }]) assert.equal(providerDeviceAssistanceTodoSummarySchema.safeParse({ ...value, ...patch }).success, false);
  const impact = { deviceId: id, deviceLabel: "Main phone", recordedDeviceVersion: 7 };
  const withImpact = { ...value, impacts: [impact] };
  assert.deepEqual(listProviderDeviceAssistanceTodosResponseSchema.parse({ todos: [withImpact], nextAfterTodoId: id }).todos[0]?.impacts, [impact]);
  for (const patch of [{ impacts: [{ ...impact, rawError: "private" }] }, { impacts: [{ ...impact, recordedDeviceVersion: -1 }] }, { impacts: [{ ...impact, deviceLabel: "" }] }, { impacts: [impact, { ...impact, deviceId: id.toUpperCase() }] }]) {
    assert.equal(listProviderDeviceAssistanceTodosResponseSchema.safeParse({ todos: [{ ...withImpact, ...patch }], nextAfterTodoId: id }).success, false);
  }
  assert.equal(listProviderDeviceAssistanceTodosResponseSchema.safeParse({ todos: [withImpact, { ...withImpact, todoId: id.toUpperCase() }], nextAfterTodoId: null }).success, false);
  assert.equal(listProviderDeviceAssistanceTodosResponseSchema.safeParse({ todos: [], nextAfterTodoId: id }).success, false);
});
test("operator notes page preserves bounded recorded notes and consistent current count/cursor", () => {
  const note = { noteId: id, actorId: id, kind: "reported_processed", text: "需要真实复核", recordedAt: summary.updatedAt }, value = { todo: summary, notes: [note], nextAfterNoteId: id };
  assert.deepEqual(listDeviceAssistanceNotesResponseSchema.parse(value), value);
  for (const patch of [{ notes: [note, { ...note, noteId: id.toUpperCase() }] }, { notes: [], nextAfterNoteId: id }, { notes: [{ ...note, kind: "verified" }] }, { notes: [{ ...note, permissionGranted: true }] }, { notes: [{ ...note, recordedAt: "0000-01-01T00:00:00Z" }] }, { notes: [{ ...note, recordedAt: "2026-09-29T23:59:59.999999999Z" }] }, { notes: [{ ...note, recordedAt: "2026-09-30T00:00:00.000000001Z" }] }, { notes: [note], todo: { ...summary, status: "open", noteCount: 0 } }]) assert.equal(listDeviceAssistanceNotesResponseSchema.safeParse({ ...value, ...patch }).success, false);
});
test("operator todo detail is read-only projection and only trusted result status can say recovered", () => {
  const value = { todo: summary, recheck: { status: "verified_recovered", blockers: [], checkedAt: summary.updatedAt } };
  assert.deepEqual(operatorAssistanceTodoDetailResponseSchema.parse(value), value);
  for (const patch of [
    { status: "resolved" },
    { ...value.recheck, status: "verified_recovered", blockers: ["still_paused"] },
    { ...value.recheck, status: "verified_recovered", checkedAt: null },
    { ...value.recheck, status: "unknown", blockers: [] },
    { ...value.recheck, status: "still_blocked", checkedAt: null },
    { status: "pending", blockers: [], permissionGranted: true },
    { status: "pending", blockers: Array(33).fill("blocked") },
    { status: "pending", blockers: ["x".repeat(121)] },
  ]) assert.equal(operatorAssistanceTodoDetailResponseSchema.safeParse({ ...value, recheck: patch }).success, false);
  assert.equal(operatorAssistanceTodoDetailResponseSchema.safeParse({ todo: summary, recheck: { status: "not_requested", blockers: [], checkedAt: null } }).success, true);
});
test("operator impact pages expose only historical facts in strict device cursor order", () => {
  const impact = { deviceId: id, recordedDeviceVersion: 9, recordedAt: summary.createdAt };
  const value = { todoId: id, impacts: [impact], nextAfterDeviceId: id };
  assert.deepEqual(listDeviceAssistanceImpactsResponseSchema.parse(value), value);
  for (const patch of [
    { impacts: [{ ...impact, associationId: id }] },
    { impacts: [{ ...impact, currentState: "active" }] },
    { impacts: [{ ...impact, recordedDeviceVersion: -1 }] },
    { impacts: [impact, { ...impact, deviceId: "00000000-0000-4000-8000-00000000000b" }, { ...impact, deviceId: "00000000-0000-4000-8000-000000000001" }] },
    { impacts: [], nextAfterDeviceId: id },
    { impacts: Array(51).fill(impact) },
  ]) assert.equal(listDeviceAssistanceImpactsResponseSchema.safeParse({ ...value, ...patch }).success, false);
  assert.equal(listDeviceAssistanceImpactsResponseSchema.safeParse({ todoId: id, impacts: [], nextAfterDeviceId: null }).success, true);
});
