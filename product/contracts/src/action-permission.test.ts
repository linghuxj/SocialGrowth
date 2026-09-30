import assert from "node:assert/strict";
import test from "node:test";
import { controlProtocolVersion, phoneActionRequestSchema } from "./action-permission.js";

test("CT-06 action request uses an independent strict version and lossless generation", () => {
  const id = "018f47ac-7a69-7db4-a572-8c62f3650191";
  const request = { protocolVersion: controlProtocolVersion, deviceId: id, holderId: id,
    controlGeneration: "9007199254740993", authorizationId: id, taskAttemptId: id, actionId: id,
    purpose: "business", kind: "read_screen" };
  assert.equal(phoneActionRequestSchema.parse(request).controlGeneration, request.controlGeneration);
  for (const patch of [{ protocolVersion: "wrong" }, { controlGeneration: 1 }, { controlGeneration: "0" },
    { purpose: "unrestricted" }, { kind: "shell" }, { permissionGranted: true }, { deviceId: "self-reported" }]) {
    assert.equal(phoneActionRequestSchema.safeParse({ ...request, ...patch }).success, false);
  }
});
