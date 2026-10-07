import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import { productErrorResponseSchema } from "@socialgrowth/product-contracts";
import { DeviceAssistanceNotesController } from "./device-assistance-notes.controller.js";
import type { DeviceAssistanceNotesService } from "./device-assistance-notes-service.js";
const id = "abcdefab-0000-4000-8000-000000000001", token = "C".repeat(43), request = { headers: { cookie: `__Host-sg_operator_session=${token}` } };
test("todo detail HTTP uses the current operator cookie and rejects malformed identities", async () => {
  let calls = 0;
  const value = { todo: { todoId: id }, recheck: { status: "not_requested", blockers: [], checkedAt: null } };
  const controller = new DeviceAssistanceNotesController({ detail: async (t: string, todo: string) => {
    calls++; assert.equal(t, token); assert.equal(todo, id); return value;
  } } as unknown as DeviceAssistanceNotesService);
  assert.deepEqual(await controller.detail(id, request), value);
  await assert.rejects(controller.detail("bad", request), (e: unknown) => e instanceof HttpException && e.getStatus() === 400);
  assert.equal(calls, 1);
});
test("notes HTTP requires strict todo/query and current operator cookie, never accepts caller actor", async () => {
  let calls = 0;
  const controller = new DeviceAssistanceNotesController({ list: async (t: string, todo: string, query: unknown) => { calls++; assert.equal(t, token); assert.equal(todo, id); assert.deepEqual(query, { afterNoteId: null, pageSize: 20 }); return "non-UI-test-only"; } } as unknown as DeviceAssistanceNotesService);
  assert.equal(await controller.list(id, {}, request), "non-UI-test-only");
  for (const query of [{ actorId: id }, { pageSize: "51" }, { pageSize: ["1", "2"] }, { afterNoteId: "bad" }]) await assert.rejects(controller.list(id, query, request), (e: unknown) => e instanceof HttpException && e.getStatus() === 400);
  await assert.rejects(controller.list("bad", {}, request), (e: unknown) => e instanceof HttpException && e.getStatus() === 400); assert.equal(calls, 1);
});
test("notes HTTP masks storage faults rather than echoing note bodies or credentials", async () => {
  const controller = new DeviceAssistanceNotesController({ list: async () => { throw new Error("fixture-private-note-or-token"); } } as unknown as DeviceAssistanceNotesService);
  await assert.rejects(controller.list(id, {}, request), (e: unknown) => e instanceof HttpException && productErrorResponseSchema.parse(e.getResponse()).error.code === "INTERNAL_ERROR" && !JSON.stringify(e.getResponse()).includes("fixture-private"));
});
test("impact HTTP forwards only strict bounded device cursor and active operator session", async () => {
  let calls = 0;
  const controller = new DeviceAssistanceNotesController({
    listImpacts: async (t: string, todo: string, query: unknown) => {
      calls++; assert.equal(t, token); assert.equal(todo, id); assert.deepEqual(query, { afterDeviceId: null, pageSize: 20 });
      return { todoId: id, impacts: [], nextAfterDeviceId: null };
    },
  } as unknown as DeviceAssistanceNotesService);
  assert.deepEqual(await controller.listImpacts(id, {}, request), { todoId: id, impacts: [], nextAfterDeviceId: null });
  for (const query of [{ afterNoteId: id }, { pageSize: "51" }, { pageSize: ["1", "2"] }, { afterDeviceId: "bad" }]) {
    await assert.rejects(controller.listImpacts(id, query, request), (e: unknown) => e instanceof HttpException && e.getStatus() === 400);
  }
  assert.equal(calls, 1);
});
