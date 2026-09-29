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
  createInvitationResponseSchema,
  invitationViewSchema,
  listInvitationsResponseSchema,
  registerProviderRequestSchema,
  registerProviderResponseSchema,
  revokeInvitationRequestSchema,
  revokeInvitationResponseSchema,
} from "./invitation.js";
import {
  createOperatorRequestSchema,
  createOperatorResponseSchema,
  disableOperatorRequestSchema,
  disableOperatorResponseSchema,
  listOperatorsResponseSchema,
  operatorLoginRequestSchema,
  operatorLoginResponseSchema,
  operatorViewSchema,
} from "./operator.js";
import {
  phoneVerificationChallengeResponseSchema,
  phoneVerificationResponseSchema,
  providerAuthResponseSchema,
  providerLogoutRequestSchema,
  providerLogoutResponseSchema,
  providerLoginRequestSchema,
  providerRegistrationAuthResponseSchema,
  providerSelfViewSchema,
  requestPhoneVerificationSchema,
  verifyPhoneCodeRequestSchema,
} from "./provider-auth.js";
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
  createInvitationResponse: createInvitationResponseSchema,
  createOperatorRequest: createOperatorRequestSchema,
  createOperatorResponse: createOperatorResponseSchema,
  disableOperatorRequest: disableOperatorRequestSchema,
  disableOperatorResponse: disableOperatorResponseSchema,
  installationSelfView: installationSelfViewSchema,
  invitationView: invitationViewSchema,
  inspectAssociationCodeRequest: inspectAssociationCodeRequestSchema,
  listOperatorsResponse: listOperatorsResponseSchema,
  listInvitationsResponse: listInvitationsResponseSchema,
  operatorDeviceView: operatorDeviceViewSchema,
  operatorLoginRequest: operatorLoginRequestSchema,
  operatorLoginResponse: operatorLoginResponseSchema,
  operatorView: operatorViewSchema,
  phoneVerificationChallengeResponse: phoneVerificationChallengeResponseSchema,
  phoneVerificationResponse: phoneVerificationResponseSchema,
  productErrorResponse: productErrorResponseSchema,
  providerAuthResponse: providerAuthResponseSchema,
  providerLogoutRequest: providerLogoutRequestSchema,
  providerLogoutResponse: providerLogoutResponseSchema,
  providerDeviceView: providerDeviceViewSchema,
  providerLoginRequest: providerLoginRequestSchema,
  providerRegistrationAuthResponse: providerRegistrationAuthResponseSchema,
  providerSelfView: providerSelfViewSchema,
  requestPhoneVerification: requestPhoneVerificationSchema,
  registerProviderRequest: registerProviderRequestSchema,
  registerProviderResponse: registerProviderResponseSchema,
  revokeInvitationRequest: revokeInvitationRequestSchema,
  revokeInvitationResponse: revokeInvitationResponseSchema,
  sessionSummary: sessionSummarySchema,
  verifyPhoneCodeRequest: verifyPhoneCodeRequestSchema,
} satisfies Record<string, z.ZodType>;

export type FirstBatchContractName = keyof typeof firstBatchContractRegistry;
