import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, HttpException, PayloadTooLargeException } from "@nestjs/common";
import { contractVersion, productErrorResponseSchema } from "@socialgrowth/product-contracts";

import { ProductExceptionFilter, mapProductException } from "./product-exception.filter.js";

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

test("the global boundary preserves a raw Express body-parser 413 status", () => {
  const exception = Object.assign(new Error("request entity too large"), {
    status: 413,
    statusCode: 413,
    type: "entity.too.large",
  });
  const mapped = mapProductException(exception);
  assert.equal(mapped.status, 413);
  assert.equal(mapped.body.error.code, "INPUT_INVALID");
  assert.equal(mapped.body.error.retryable, false);
  assert.doesNotMatch(mapped.body.error.message, /entity too large/);
});

test("the global boundary does not write after response headers were sent", () => {
  let writes = 0;
  const response = {
    headersSent: true,
    setHeader: () => { writes += 1; },
    status: () => ({ json: () => { writes += 1; } }),
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as import("@nestjs/common").ArgumentsHost;

  new ProductExceptionFilter().catch(new Error("late failure"), host);
  assert.equal(writes, 0);
});
