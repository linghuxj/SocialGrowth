import assert from "node:assert/strict";
import test from "node:test";
import { MediaInputAuthorityStore } from "./media-input-authority-store.js";

const id = "8f0d1fd0-6d6a-4b5a-8610-61c116c8c3c2";
const validScope = {
  accountId: id, platform: "facebook", credentialId: id, expectedRevision: 4n,
  projectId: id, deviceId: id, taskId: id, taskAttemptId: id,
  operationKind: "assist_existing_login", actionId: id, fieldRef: "password",
  authorizationId: id, holderId: id, controlGeneration: 3n, serial: "device-1",
};

test("scope parser accepts only the frozen selector and rejects caller authority metadata", () => {
  const store = new MediaInputAuthorityStore({} as never, {} as never);
  assert.deepEqual(store.parseScope(validScope), validScope);
  for (const forged of [
    { installationId: id }, { installationGeneration: 2n }, { leaseUntilMillis: 9_999n },
    { holderGrantValidUntilMillis: 9_999n }, { targetPackage: "com.example.app" },
  ]) {
    assert.throws(() => store.parseScope({ ...validScope, ...forged }));
  }
  assert.throws(() => store.parseScope({ ...validScope, expectedRevision: 0n }));
  assert.throws(() => store.parseScope({ ...validScope, fieldRef: "submit_login" }));
});
