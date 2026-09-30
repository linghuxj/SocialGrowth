import { z } from "zod";
import { prepareMaterialUploadRequestSchema, materialUploadTicketViewSchema, prepareMaterialUploadResponseSchema, uploadMaterialBytesCommandSchema, uploadMaterialBytesResponseSchema } from "./material-upload.js";
import { commissionCursorSchema, providerCommissionRecordSchema, listProviderCommissionsResponseSchema } from "./commission.js";
import { deviceAssistanceTodoSummarySchema, listDeviceAssistanceTodosResponseSchema, recordDeviceAssistanceNoteRequestSchema, recordDeviceAssistanceNoteResponseSchema, providerDeviceAssistanceTodoSummarySchema, listProviderDeviceAssistanceTodosResponseSchema, deviceAssistanceNoteViewSchema, listDeviceAssistanceNotesResponseSchema } from "./device-assistance.js";
import { phoneActionRequestSchema } from "./action-permission.js";
import { createProjectRequestSchema, updateProjectRequestSchema, projectResponseSchema, projectViewSchema, listProjectsResponseSchema } from "./project.js";
import { projectPlanningInputsSchema, projectPlanningDraftViewSchema, projectPlanningResponseSchema, saveProjectPlanningRequestSchema } from "./project-planning.js";

import {
  associationQrPayloadSchema,
  associationResultResponseSchema,
  associationSessionViewSchema,
  confirmAssociationRequestSchema,
  confirmAssociationResponseSchema,
  createAssociationSessionRequestSchema,
  createAssociationSessionResponseSchema,
  inspectAssociationCodeRequestSchema,
  installationStateRequestSchema,
  listProviderDevicesRequestSchema,
  listProviderDevicesResponseSchema,
  queryAssociationResultRequestSchema,
} from "./association.js";
import { productErrorResponseSchema } from "./errors.js";
import {
  enrollmentChallengeSchema,
  enrollmentProofSchema,
  nodeIdentitySchema,
} from "./network-admission.js";
import {
  listOperatorDeviceFactsResponseSchema,
  operatorDeviceFactSchema,
  operatorProviderFactSchema,
} from "./device-facts.js";
import {
  authenticatedPrincipalSchema,
  sessionSummarySchema,
} from "./identity.js";
import {
  bootstrapInstallationRequestSchema,
  installationAuthResponseSchema,
  installationIdentitySchema,
} from "./installation-auth.js";
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
  prepareMaterialUploadRequest: prepareMaterialUploadRequestSchema,
  materialUploadTicketView: materialUploadTicketViewSchema,
  prepareMaterialUploadResponse: prepareMaterialUploadResponseSchema,
  uploadMaterialBytesCommand: uploadMaterialBytesCommandSchema,
  uploadMaterialBytesResponse: uploadMaterialBytesResponseSchema,
  commissionCursor: commissionCursorSchema,
  providerCommissionRecord: providerCommissionRecordSchema,
  listProviderCommissionsResponse: listProviderCommissionsResponseSchema,
  deviceAssistanceTodoSummary: deviceAssistanceTodoSummarySchema,
  listDeviceAssistanceTodosResponse: listDeviceAssistanceTodosResponseSchema,
  recordDeviceAssistanceNoteRequest: recordDeviceAssistanceNoteRequestSchema,
  recordDeviceAssistanceNoteResponse: recordDeviceAssistanceNoteResponseSchema,
  providerDeviceAssistanceTodoSummary: providerDeviceAssistanceTodoSummarySchema,
  listProviderDeviceAssistanceTodosResponse: listProviderDeviceAssistanceTodosResponseSchema,
  deviceAssistanceNoteView: deviceAssistanceNoteViewSchema,
  listDeviceAssistanceNotesResponse: listDeviceAssistanceNotesResponseSchema,
  projectPlanningInputs: projectPlanningInputsSchema,
  projectPlanningDraftView: projectPlanningDraftViewSchema,
  projectPlanningResponse: projectPlanningResponseSchema,
  saveProjectPlanningRequest: saveProjectPlanningRequestSchema,
  createProjectRequest: createProjectRequestSchema,
  updateProjectRequest: updateProjectRequestSchema,
  projectResponse: projectResponseSchema,
  projectView: projectViewSchema,
  listProjectsResponse: listProjectsResponseSchema,
  phoneActionRequest: phoneActionRequestSchema,
  enrollmentChallenge: enrollmentChallengeSchema,
  enrollmentProof: enrollmentProofSchema,
  nodeIdentity: nodeIdentitySchema,
  associationQrPayload: associationQrPayloadSchema,
  associationResultResponse: associationResultResponseSchema,
  associationSessionView: associationSessionViewSchema,
  authenticatedPrincipal: authenticatedPrincipalSchema,
  bootstrapInstallationRequest: bootstrapInstallationRequestSchema,
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
  installationAuthResponse: installationAuthResponseSchema,
  installationIdentity: installationIdentitySchema,
  invitationView: invitationViewSchema,
  inspectAssociationCodeRequest: inspectAssociationCodeRequestSchema,
  installationStateRequest: installationStateRequestSchema,
  listOperatorsResponse: listOperatorsResponseSchema,
  listOperatorDeviceFactsResponse: listOperatorDeviceFactsResponseSchema,
  listProviderDevicesRequest: listProviderDevicesRequestSchema,
  listProviderDevicesResponse: listProviderDevicesResponseSchema,
  listInvitationsResponse: listInvitationsResponseSchema,
  operatorDeviceView: operatorDeviceViewSchema,
  operatorDeviceFact: operatorDeviceFactSchema,
  operatorProviderFact: operatorProviderFactSchema,
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
  queryAssociationResultRequest: queryAssociationResultRequestSchema,
  requestPhoneVerification: requestPhoneVerificationSchema,
  registerProviderRequest: registerProviderRequestSchema,
  registerProviderResponse: registerProviderResponseSchema,
  revokeInvitationRequest: revokeInvitationRequestSchema,
  revokeInvitationResponse: revokeInvitationResponseSchema,
  sessionSummary: sessionSummarySchema,
  verifyPhoneCodeRequest: verifyPhoneCodeRequestSchema,
} satisfies Record<string, z.ZodType>;

export type FirstBatchContractName = keyof typeof firstBatchContractRegistry;
