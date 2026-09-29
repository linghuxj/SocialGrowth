import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, HttpException, PayloadTooLargeException } from "@nestjs/common";
import { contractVersion, productErrorResponseSchema } from "@socialgrowth/product-contracts";

import { mapProductException } from "./product-exception.filter.js";

test("the global boundary maps framework parsing errors to product envelopes", () => {
  for (const exception of [
    new BadRequestException("Unexpected token in JSON"),
    new PayloadTooLargeException("request entity too large"),
  ]) {
    const mapped = mapProductException(exception);
    assert.equal(mapped.status, exception.getStatus());
    assert.equal(productErrorResponseSchema.safeParse(mapped.body).success, true);
    assert.equal(mapped.body.error.code, "INPUT_INVALID");
    assert.doesNotMatch(mapped.body.error.message, /Unexpected token|entity too large/);
  }
});

test("the global boundary preserves an existing product exception", () => {
  const body = productErrorResponseSchema.parse({
    contractVersion,
    requestId: "request-existing-product-error-0001",
    error: { code: "AUTHENTICATION_REQUIRED", message: "Login required", retryable: false },
  });
  const mapped = mapProductException(new HttpException(body, 401));
  assert.deepEqual(mapped, { body, status: 401 });
});

test("the global boundary masks unknown errors", () => {
  const mapped = mapProductException(new Error("database-password-must-not-leak"));
  assert.equal(mapped.status, 500);
  assert.equal(mapped.body.error.code, "INTERNAL_ERROR");
  assert.equal(mapped.body.error.retryable, true);
  assert.doesNotMatch(mapped.body.error.message, /database-password/);
});
