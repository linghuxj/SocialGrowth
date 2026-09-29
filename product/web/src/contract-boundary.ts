import {
  operatorDeviceViewSchema,
  productErrorResponseSchema,
  providerDeviceViewSchema,
  type OperatorDeviceView,
  type ProductErrorResponse,
  type ProviderDeviceView,
} from "@socialgrowth/product-contracts";

export function parseOperatorDeviceView(input: unknown): OperatorDeviceView {
  return operatorDeviceViewSchema.parse(input);
}

export function parseProviderDeviceView(input: unknown): ProviderDeviceView {
  return providerDeviceViewSchema.parse(input);
}

export function parseProductError(input: unknown): ProductErrorResponse {
  return productErrorResponseSchema.parse(input);
}
