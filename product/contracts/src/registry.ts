import { z } from "zod";

import {
  associationQrPayloadSchema,
  associationSessionViewSchema,
  confirmAssociationRequestSchema,
  confirmAssociationResponseSchema,
  createAssociationSessionRequestSchema,
  createAssociationSessionResponseSchema,
  inspectAssociationCodeRequestSchema,
} from "./association.js";
import { productErrorResponseSchema } from "./errors.js";
import {
  authenticatedPrincipalSchema,
  sessionSummarySchema,
} from "./identity.js";
import {
  createInvitationRequestSchema,
  invitationViewSchema,
  registerProviderRequestSchema,
  registerProviderResponseSchema,
} from "./invitation.js";
import {
  installationSelfViewSchema,
  operatorDeviceViewSchema,
  providerDeviceViewSchema,
} from "./status.js";

export const firstBatchContractRegistry = {
  associationQrPayload: associationQrPayloadSchema,
  associationSessionView: associationSessionViewSchema,
  authenticatedPrincipal: authenticatedPrincipalSchema,
  confirmAssociationRequest: confirmAssociationRequestSchema,
  confirmAssociationResponse: confirmAssociationResponseSchema,
  createAssociationSessionRequest: createAssociationSessionRequestSchema,
  createAssociationSessionResponse: createAssociationSessionResponseSchema,
  createInvitationRequest: createInvitationRequestSchema,
  installationSelfView: installationSelfViewSchema,
  invitationView: invitationViewSchema,
  inspectAssociationCodeRequest: inspectAssociationCodeRequestSchema,
  operatorDeviceView: operatorDeviceViewSchema,
  productErrorResponse: productErrorResponseSchema,
  providerDeviceView: providerDeviceViewSchema,
  registerProviderRequest: registerProviderRequestSchema,
  registerProviderResponse: registerProviderResponseSchema,
  sessionSummary: sessionSummarySchema,
} satisfies Record<string, z.ZodType>;

export type FirstBatchContractName = keyof typeof firstBatchContractRegistry;
