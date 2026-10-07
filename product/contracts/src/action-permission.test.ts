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

test("credential writes and login submission persist a narrow, action-specific target", () => {
  const id = "018f47ac-7a69-7db4-a572-8c62f3650191";
  const base = { protocolVersion: controlProtocolVersion, deviceId: id, holderId: id,
    controlGeneration: "1", authorizationId: id, taskAttemptId: id, actionId: id, purpose: "business" };
  assert.equal(phoneActionRequestSchema.safeParse({ ...base, kind: "write_input", fieldRef: "login" }).success, true);
  assert.equal(phoneActionRequestSchema.safeParse({ ...base, kind: "write_input", fieldRef: "password" }).success, true);
  assert.equal(phoneActionRequestSchema.safeParse({ ...base, kind: "write_input" }).success, false);
  assert.equal(phoneActionRequestSchema.safeParse({ ...base, kind: "write_input", fieldRef: "otp" }).success, false);
  assert.equal(phoneActionRequestSchema.safeParse({ ...base, kind: "submit_login", targetViewIdResourceName: "com.facebook.katana:id/login" }).success, true);
  assert.equal(phoneActionRequestSchema.safeParse({ ...base, kind: "submit_login" }).success, false);
  assert.equal(phoneActionRequestSchema.safeParse({ ...base, kind: "submit_login", targetViewIdResourceName: "*" }).success, false);
  assert.equal(phoneActionRequestSchema.safeParse({ ...base, kind: "read_screen", fieldRef: "password" }).success, false);
  assert.equal(phoneActionRequestSchema.safeParse({ ...base, kind: "submit_publication", targetViewIdResourceName: "com.facebook.katana:id/login" }).success, false);
});
