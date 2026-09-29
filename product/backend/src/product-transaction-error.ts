import type { ProductErrorCode } from "@socialgrowth/product-contracts";

export class ProductTransactionError extends Error {
  constructor(
    readonly code: ProductErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ProductTransactionError";
  }
}
