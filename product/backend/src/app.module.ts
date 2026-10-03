import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { AppController } from "./app.controller.js";
import { MaterialRuntime, readMaterialRuntimeConfig } from "./material-runtime.js";
import { MaterialUploadController } from "./material-upload.controller.js";
import { MaterialRegistryController } from "./material-registry.controller.js";
import { readOperatorRuntimeConfig, readSmsRuntimeConfig } from "./config.js";
import { DatabaseLifecycle } from "./database-lifecycle.js";
import { DevelopmentProviderSmsController } from "./development-provider-sms.controller.js";
import { InvitationManagementService } from "./invitation-management-service.js";
import { IdentityTransactionService } from "./identity-transactions.js";
import { InstallationAuthService } from "./installation-auth-service.js";
import { InstallationController } from "./installation.controller.js";
import { NetworkAdmissionController } from "./network-admission.controller.js";
import { NetworkAdmissionApi } from "./network-admission-api.js";
import { NetworkAdmissionStore } from "./network-admission-store.js";
import { LocalParticipationController } from "./local-participation.controller.js";
import { LocalParticipationService } from "./local-participation-service.js";
import { OperatorAuthService } from "./operator-auth-service.js";
import { OperatorController } from "./operator.controller.js";
import { ProviderAuthService } from "./provider-auth-service.js";
import { ProviderController } from "./provider.controller.js";
import { ProviderDeviceLabelController } from "./provider-device-label.controller.js";
import { ProjectService } from "./project-service.js";
import { ProjectController } from "./project.controller.js";
import { ResourceReservationStore } from "./resource-reservation-store.js";
import { ResourcePreparationController } from "./resource-preparation.controller.js";
import { MediaCredentialStore } from "./media-credential-store.js";
import { MediaCredentialsController } from "./media-credentials.controller.js";
import { ProjectPlanningController } from "./project-planning.controller.js";
import { ProjectPlanningService } from "./project-planning-service.js";
import { ProjectDirectionService } from "./project-direction-service.js";
import { ProjectDirectionController } from "./project-direction.controller.js";
import { readInitialDirectionModel } from "./artemis-business-model.js";
import { AccountPreparationService } from "./account-preparation-service.js";
import { AccountPreparationController } from "./account-preparation.controller.js";
import { DeviceAssistanceFeedService } from "./device-assistance-feed-service.js";
import { DeviceAssistanceFeedController } from "./device-assistance-feed.controller.js";
import { ProviderAssistanceFeedService } from "./provider-assistance-feed-service.js";
import { ProviderAssistanceFeedController } from "./provider-assistance-feed.controller.js";
import { ProviderCommissionFeedService } from "./provider-commission-feed-service.js";
import { ProviderCommissionFeedController } from "./provider-commission-feed.controller.js";
import { DeviceAssistanceNotesService } from "./device-assistance-notes-service.js";
import { DeviceAssistanceNotesController } from "./device-assistance-notes.controller.js";
import { TrackingLinkService } from "./tracking-link-service.js";
import { TrackingRedirectController } from "./tracking-redirect.controller.js";
import {
  DevelopmentSmsCapturePort,
  DisabledDevelopmentSmsCodeReader,
  SMS_RUNTIME,
  UnavailableSmsDeliveryPort,
  type SmsRuntime,
} from "./sms-delivery.js";

const poolProvider = {
  provide: Pool,
  useFactory: () => {
    const config = readOperatorRuntimeConfig();
    return new Pool({ connectionString: config.SG_PRODUCT_DATABASE_URL, max: 12 });
  },
};

const operatorAuthProvider = {
  provide: OperatorAuthService,
  inject: [Pool],
  useFactory: (pool: Pool) => {
    const config = readOperatorRuntimeConfig();
    return new OperatorAuthService(pool, config.SG_PRODUCT_AUTH_PEPPER);
  },
};

const invitationManagementProvider = {
  provide: InvitationManagementService,
  inject: [Pool, OperatorAuthService],
  useFactory: (pool: Pool, operatorAuth: OperatorAuthService) => {
    const config = readOperatorRuntimeConfig();
    return new InvitationManagementService(
      pool,
      operatorAuth,
      config.SG_PRODUCT_AUTH_PEPPER,
    );
  },
};

const identityTransactionProvider = {
  provide: IdentityTransactionService,
  inject: [Pool],
  useFactory: (pool: Pool) => new IdentityTransactionService(pool),
};

const installationAuthProvider = {
  provide: InstallationAuthService,
  inject: [Pool],
  useFactory: (pool: Pool) => {
    const config = readOperatorRuntimeConfig();
    return new InstallationAuthService(pool, config.SG_PRODUCT_AUTH_PEPPER);
  },
};

const smsRuntimeProvider = {
  provide: SMS_RUNTIME,
  useFactory: (): SmsRuntime => {
    const config = readSmsRuntimeConfig();
    if (config.SG_PRODUCT_SMS_MODE === "development_capture") {
      const capture = new DevelopmentSmsCapturePort(
        config.SG_PRODUCT_DEVELOPMENT_SMS_TOKEN!,
      );
      return { codeReader: capture, deliveryPort: capture };
    }
    return {
      codeReader: new DisabledDevelopmentSmsCodeReader(),
      deliveryPort: new UnavailableSmsDeliveryPort(),
    };
  },
};

const providerAuthProvider = {
  provide: ProviderAuthService,
  inject: [Pool, SMS_RUNTIME],
  useFactory: (pool: Pool, smsRuntime: SmsRuntime) => {
    const config = readOperatorRuntimeConfig();
    return new ProviderAuthService(
      pool,
      config.SG_PRODUCT_AUTH_PEPPER,
      smsRuntime.deliveryPort,
      config.SG_PRODUCT_SMS_CODE_LENGTH,
    );
  },
};

@Module({
  controllers: [
    AppController,
    MaterialUploadController,
    MaterialRegistryController,
    DevelopmentProviderSmsController,
    InstallationController,
    NetworkAdmissionController,
    LocalParticipationController,
    OperatorController,
    ProviderController,
    ProviderDeviceLabelController,
    ProjectController,
    ResourcePreparationController,
    MediaCredentialsController,
    ProjectPlanningController,
    ProjectDirectionController,
    AccountPreparationController,
    DeviceAssistanceFeedController,
    ProviderAssistanceFeedController,
    ProviderCommissionFeedController,
    DeviceAssistanceNotesController,
    TrackingRedirectController,
  ],
  providers: [
    { provide: AccountPreparationService, inject: [Pool, OperatorAuthService], useFactory: (pool: Pool, auth: OperatorAuthService) => new AccountPreparationService(pool, auth) },
    poolProvider,
    operatorAuthProvider,
    invitationManagementProvider,
    identityTransactionProvider,
    installationAuthProvider,
    // Main business listener cannot mint a trusted verifier socket or revision.
    // Read current authenticated facts; mutations close until real ports exist.
    { provide: NetworkAdmissionApi, inject: [Pool, InstallationAuthService], useFactory: (pool: Pool, auth: InstallationAuthService) => new NetworkAdmissionApi(new NetworkAdmissionStore(pool), auth, null) },
    { provide: LocalParticipationService, inject: [Pool, InstallationAuthService], useFactory: (pool: Pool, auth: InstallationAuthService) => new LocalParticipationService(pool, auth) },
    smsRuntimeProvider,
    providerAuthProvider,
    { provide: MaterialRuntime, inject: [Pool, OperatorAuthService], useFactory: (pool: Pool, auth: OperatorAuthService) => new MaterialRuntime(pool, auth, readMaterialRuntimeConfig()) },
    { provide: ProjectService, inject: [Pool, OperatorAuthService], useFactory: (pool: Pool, auth: OperatorAuthService) => new ProjectService(pool, auth) },
    { provide: ResourceReservationStore, inject: [Pool, OperatorAuthService], useFactory: (pool: Pool, auth: OperatorAuthService) => new ResourceReservationStore(pool, auth) },
    // No real controlled key custodian is configured. Metadata can be read;
    // writes authenticate then fail closed. No ambient/historical key fallback.
    { provide: MediaCredentialStore, inject: [Pool, OperatorAuthService], useFactory: (pool: Pool, auth: OperatorAuthService) => new MediaCredentialStore(pool, auth, null) },
    { provide: ProjectPlanningService, inject: [Pool, OperatorAuthService], useFactory: (pool: Pool, auth: OperatorAuthService) => new ProjectPlanningService(pool, auth) },
    { provide: ProjectDirectionService, inject: [Pool, OperatorAuthService], useFactory: (pool: Pool, auth: OperatorAuthService) => new ProjectDirectionService(pool, auth, readInitialDirectionModel()) },
    { provide: DeviceAssistanceFeedService, inject: [Pool, OperatorAuthService], useFactory: (pool: Pool, auth: OperatorAuthService) => new DeviceAssistanceFeedService(pool, auth) },
    { provide: ProviderAssistanceFeedService, inject: [Pool, ProviderAuthService], useFactory: (pool: Pool, auth: ProviderAuthService) => new ProviderAssistanceFeedService(pool, auth) },
    { provide: ProviderCommissionFeedService, inject: [Pool, ProviderAuthService], useFactory: (pool: Pool, auth: ProviderAuthService) => new ProviderCommissionFeedService(pool, auth) },
    { provide: DeviceAssistanceNotesService, inject: [Pool, OperatorAuthService], useFactory: (pool: Pool, auth: OperatorAuthService) => new DeviceAssistanceNotesService(pool, auth) },
    // No real business target origin/definition has been supplied. Closed until
    // an explicit server-owned policy adapter is reviewed; no ambient fallback.
    { provide: TrackingLinkService, inject: [Pool, OperatorAuthService], useFactory: (pool: Pool, auth: OperatorAuthService) => new TrackingLinkService(pool, auth, null) },
    DatabaseLifecycle,
  ],
})
export class AppModule {}
