import {
  associationQrPayloadSchema,
  installationSelfViewSchema,
  productErrorResponseSchema,
  type AssociationQrPayload,
  type InstallationSelfView,
  type ProductErrorResponse,
} from "@socialgrowth/product-contracts";

export function parseAssociationQrPayload(input: unknown): AssociationQrPayload {
  return associationQrPayloadSchema.parse(input);
}

export function parseInstallationSelfView(input: unknown): InstallationSelfView {
  return installationSelfViewSchema.parse(input);
}

export function parseProductError(input: unknown): ProductErrorResponse {
  return productErrorResponseSchema.parse(input);
}
