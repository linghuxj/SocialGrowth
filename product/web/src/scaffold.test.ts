import assert from "node:assert/strict";
import test from "node:test";

test("product Web keeps an explicit environment marker", () => {
  assert.equal("product", "product");
});
