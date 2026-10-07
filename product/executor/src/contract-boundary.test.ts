import assert from "node:assert/strict";
import test from "node:test";
import { contractVersion } from "@socialgrowth/product-contracts";
import {
  parseAssociationQrPayload,
  parseInstallationSelfView,
} from "./contract-boundary.js";

const id = "00000000-0000-4000-8000-000000000001";

test("executor accepts the current QR version and installation view", () => {
  assert.equal(
    parseAssociationQrPayload({
      contractVersion,
      associationCode: `sgassoc_v1_${"A".repeat(43)}`,
    }).contractVersion,
    contractVersion,
  );
  assert.equal(
    parseInstallationSelfView({
      factVersion: 1,
      updatedAt: "2026-09-29T00:00:00Z",
      installationId: id,
      state: "unassociated",
      deviceId: null,
    }).state,
    "unassociated",
  );
});

test("executor rejects old QR versions, unknown fields and contradictory state", () => {
  assert.throws(() =>
    parseAssociationQrPayload({
      contractVersion: "2026-09-28.identity-v0",
      associationCode: `sgassoc_v1_${"A".repeat(43)}`,
    }),
  );
  assert.throws(() =>
    parseAssociationQrPayload({
      contractVersion,
      associationCode: `sgassoc_v1_${"A".repeat(43)}`,
      providerId: id,
    }),
  );
  assert.throws(() =>
    parseInstallationSelfView({
      factVersion: 1,
      updatedAt: "2026-09-29T00:00:00Z",
      installationId: id,
      state: "unassociated",
      deviceId: id,
    }),
  );
});
