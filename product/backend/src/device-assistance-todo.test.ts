import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { contractVersion } from "@socialgrowth/product-contracts";
import { assistanceEventSchema, assistanceNoteRequestSchema } from "./device-assistance-todo.js";
test("internal assistance intake requires a stable explicit occurrence, never ordinary changes, error text or client authority", () => {
  const input = { eventId: randomUUID(), occurrenceId: randomUUID(), deviceId: randomUUID(), expectedDeviceVersion: 0, kind: "network_access_help" };
  assert.deepEqual(assistanceEventSchema.parse(input), input);
  assert.deepEqual(assistanceEventSchema.parse({ ...input, deviceId: input.deviceId.toUpperCase() }), input);
  for (const patch of [{ kind: "endpoint_changed" }, { occurrenceId: "same-error-text" }, { responsibleOperatorId: randomUUID() },
    { projectId: randomUUID() }, { permissionGranted: true }, { expectedDeviceVersion: Number.MAX_SAFE_INTEGER + 1 }, { expectedDeviceVersion: -1 }]) assert.equal(assistanceEventSchema.safeParse({ ...input, ...patch }).success, false);
});
test("operator assistance note cannot express closure, resume, reassignment, notifications or verification success", () => {
  const input = { metadata: { contractVersion, requestId: "request-todo-fixture", idempotencyKey: "todo-fixture-key-0001" }, todoId: randomUUID(), expectedFactVersion: 1, kind: "reported_processed", text: "已处理，请重新核验当前设备" };
  assert.deepEqual(assistanceNoteRequestSchema.parse(input), input);
  for (const patch of [{ kind: "resolved" }, { kind: "resume" }, { verified: true }, { recipientEmail: "fixture@example.invalid" }, { initialResponsibleOperatorId: randomUUID() },
    { text: "" }, { text: " padded " }, { text: "line\nline" }, { text: "a".repeat(151) }, { expectedFactVersion: -1 }]) assert.equal(assistanceNoteRequestSchema.safeParse({ ...input, ...patch }).success, false);
});
