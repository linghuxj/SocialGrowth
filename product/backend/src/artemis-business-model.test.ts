import assert from "node:assert/strict";
import test from "node:test";
import { initialDirectionOutputSchema } from "@socialgrowth/product-contracts";
import { summarizeDirectionOutputFailure } from "./artemis-business-model.js";

test("direction schema diagnostics expose only finite categories and counts, never unexpected keys or values", () => {
  const invalid = initialDirectionOutputSchema.safeParse({ direction: "synthetic", rationale: "fixture", limitations: [],
    privateUnexpectedFixtureKey: "must-not-be-logged" });
  assert.equal(invalid.success, false);
  if (invalid.success) return;
  const summary = summarizeDirectionOutputFailure(invalid.error);
  assert.deepEqual(summary, { fields: ["object"], categories: ["unrecognized_keys"], extraKeyCount: 1 });
  assert.equal(JSON.stringify(summary).includes("privateUnexpectedFixtureKey"), false);
  assert.equal(JSON.stringify(summary).includes("must-not-be-logged"), false);
});
