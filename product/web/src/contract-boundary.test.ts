import assert from "node:assert/strict";
import test from "node:test";
import { contractVersion } from "@socialgrowth/product-contracts";
import {
  parseOperatorDeviceView,
  parseProductError,
  parseProviderDeviceView,
} from "./contract-boundary.js";

const id = "00000000-0000-4000-8000-000000000001";
const fact = { factVersion: 1, updatedAt: "2026-09-29T00:00:00Z" };

test("Web accepts only the role-specific device fields", () => {
  assert.equal(
    parseOperatorDeviceView({
      ...fact,
      deviceId: id,
      installationId: id,
      lastObservedAt: null,
      providerId: null,
      state: "unassociated",
    }).state,
    "unassociated",
  );
  assert.equal(
    parseProviderDeviceView({
      ...fact,
      deviceId: id,
      displayName: "Device A",
      lastObservedAt: null,
      state: "access_ready",
    }).state,
    "access_ready",
  );
  assert.throws(() =>
    parseProviderDeviceView({
      ...fact,
      deviceId: id,
      displayName: "Device A",
      installationId: id,
      lastObservedAt: null,
      state: "access_ready",
    }),
  );
});

test("Web rejects incompatible error versions and contradictory states", () => {
  assert.throws(() =>
    parseProductError({
      contractVersion: "2026-09-28.identity-v0",
      requestId: "request-0001",
      error: { code: "INPUT_INVALID", message: "invalid", retryable: false },
    }),
  );
  assert.equal(
    parseProductError({
      contractVersion,
      requestId: "request-0001",
      error: { code: "INPUT_INVALID", message: "invalid", retryable: false },
    }).contractVersion,
    contractVersion,
  );
  assert.throws(() =>
    parseOperatorDeviceView({
      ...fact,
      deviceId: id,
      installationId: id,
      lastObservedAt: null,
      providerId: id,
      state: "unassociated",
    }),
  );
});
