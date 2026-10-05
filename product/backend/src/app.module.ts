import { NetworkSetupApi } from "./network-setup-api.js";
import { NetworkSetupController } from "./network-setup.controller.js";
import { PilotDeviceNetworkAuthority } from "./network-access-authority.js";
import { TailscaleCliWhoIs } from "./tailscale-source-verifier.js";
import { DeviceConnectionApi } from "./device-connection-api.js";
import { DeviceConnectionAdb } from "./device-connection-adb.js";
import { InstallationDeviceConnectionController, ProviderDeviceConnectionController } from "./device-connection.controller.js";
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
import { DeviceControlService } from "./device-control-service.js";
import { InstallationSelfControlController, ProviderDeviceControlController } from "./device-control.controller.js";
import { OperatorAuthService } from "./operator-auth-service.js";
import { OperatorController } from "./operator.controller.js";
import { ProviderAuthService } from "./provider-auth-service.js";
import { ProviderController } from "./provider.controller.js";
import { ProviderDeviceLabelController } from "./provider-device-label.controller.js";
import { ProjectService } from "./project-service.js";
import { ProjectController } from "./project.controller.js";
import { ProjectLifecycleController } from "./project-lifecycle.controller.js";
import { ProjectLifecycleService } from "./project-lifecycle-service.js";
import { ProjectCycleConfigController } from "./project-cycle-config.controller.js";
import { ProjectCycleConfigService } from "./project-cycle-config-service.js";
import { ProjectCycleProgressionLifecycle } from "./project-cycle-progression-lifecycle.js";
import { ResourceReservationStore } from "./resource-reservation-store.js";
import { ResourcePreparationController } from "./resource-preparation.controller.js";
import { MediaCredentialStore } from "./media-credential-store.js";
import { MediaCredentialsController } from "./media-credentials.controller.js";
import { MediaAccountsController } from "./media-accounts.controller.js";
import { MediaAccountStore } from "./media-account-store.js";
import { MediaCredentialKeyCustodian } from "./media-credential-key-custodian.js";
import { readMediaCredentialKeysFile } from "./media-credential-key-file.js";
import { MEDIA_INPUT_GRANT_KEY_CONFIG, MediaInputAuthority, type MediaInputGrantKeyConfig } from "./media-input-authority.js";
import { MediaInputAuthorityStore } from "./media-input-authority-store.js";
import { MediaInputInstallationController } from "./media-input-installation.controller.js";
import { ProjectPlanningController } from "./project-planning.controller.js";
import { ProjectPlanningService } from "./project-planning-service.js";
import { ProjectDirectionService } from "./project-direction-service.js";
import { ProjectDirectionController } from "./project-direction.controller.js";
import { ArtemisBusinessModel, readInitialDirectionModel } from "./artemis-business-model.js";
import { BusinessPlanController } from "./business-plan.controller.js";
import { BusinessPlanService } from "./business-plan-service.js";
import { BusinessPlanWorkflowStore, BusinessPlanWorkflowConsumer } from "./business-plan-workflow-store.js";
import { BusinessPlanWorkflowInternalController } from "./business-plan-workflow-internal.controller.js";
import { BusinessPlanExecutionRuntime } from "./business-plan-execution-runtime.js";
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
import { TaskAssistanceRecheckStore } from "./task-assistance-recheck-store.js";
import { DeviceAssistanceRecheckConsumer } from "./device-assistance-recheck-consumer.js";
import { DeviceAssistanceRecheckLifecycle } from "./device-assistance-recheck-lifecycle.js";
import { TrackingLinkService } from "./tracking-link-service.js";
import { TrackingRedirectController } from "./tracking-redirect.controller.js";
import { MetricFeedbackController } from "./metric-feedback.controller.js";
import { MetricSnapshotStore } from "./metric-snapshot-store.js";
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
    return new Pool({ connectionString: config.SG_PRODUCT_DATABASE_URL, max: 12, connectionTimeoutMillis: 5_000 });
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
    NetworkSetupController,
    InstallationDeviceConnectionController,
    ProviderDeviceConnectionController,
    LocalParticipationController,
    InstallationSelfControlController,
    ProviderDeviceControlController,
    OperatorController,
    ProviderController,
    ProviderDeviceLabelController,
    ProjectController,
    ProjectLifecycleController,
    ProjectCycleConfigController,
    ResourcePreparationController,
    MediaAccountsController,
    MediaCredentialsController,
    MediaInputInstallationController,
    ProjectPlanningController,
    ProjectDirectionController,
    BusinessPlanController,
    BusinessPlanWorkflowInternalController,
    AccountPreparationController,
    DeviceAssistanceFeedController,
    ProviderAssistanceFeedController,
    ProviderCommissionFeedController,
    DeviceAssistanceNotesController,
    TrackingRedirectController,
    MetricFeedbackController,
  ],
  providers: [
    {
      provide: NetworkSetupApi,
      inject: [Pool, InstallationAuthService],
      useFactory: (pool: Pool, auth: InstallationAuthService) => new NetworkSetupApi(
        new NetworkAdmissionStore(pool), auth,
        process.env.SG_PRODUCT_TAILNET_PILOT_CONFIG ?? "",
        new TailscaleCliWhoIs(process.env.SG_PRODUCT_TAILSCALE_CLI ?? "/Applications/Tailscale.app/Contents/MacOS/Tailscale"),
        process.env.SG_PRODUCT_TAILNET_PILOT_AUTH_KEY_FILE ?? null,
      ),
    },
    {
      provide: DeviceConnectionApi,
      inject: [Pool, InstallationAuthService, ProviderAuthService],
      useFactory: (pool: Pool, installation: InstallationAuthService, provider: ProviderAuthService) => {
        const pilot = process.env.SG_PRODUCT_TAILNET_PILOT_CONFIG;
        const tailscale = process.env.SG_PRODUCT_TAILSCALE_CLI;
        const adb = process.env.SG_PRODUCT_CENTER_ADB;
        const adbHome = process.env.SG_PRODUCT_CENTER_ADB_USER_HOME;
        return new DeviceConnectionApi(pool, installation, provider,
          pilot && tailscale ? new PilotDeviceNetworkAuthority(pilot, new TailscaleCliWhoIs(tailscale)) : null,
          adb && adbHome ? new DeviceConnectionAdb(adb, adbHome, 8000, process.env.SG_PRODUCT_CENTER_ADB_TAILSCALE_CLI ?? null) : null);
      },
    },

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
    { provide: DeviceControlService, inject: [Pool, ProviderAuthService, InstallationAuthService], useFactory: (pool: Pool, providerAuth: ProviderAuthService, installationAuth: InstallationAuthService) => new DeviceControlService(pool, providerAuth, installationAuth) },
    smsRuntimeProvider,
    providerAuthProvider,
    { provide: MaterialRuntime, inject: [Pool, OperatorAuthService], useFactory: (pool: Pool, auth: OperatorAuthService) => new MaterialRuntime(pool, auth, readMaterialRuntimeConfig()) },
    { provide: ProjectService, inject: [Pool, OperatorAuthService], useFactory: (pool: Pool, auth: OperatorAuthService) => new ProjectService(pool, auth) },
    { provide: ProjectLifecycleService, inject: [Pool, OperatorAuthService], useFactory: (pool: Pool, auth: OperatorAuthService) => new ProjectLifecycleService(pool, auth) },
    { provide: ProjectCycleConfigService, inject: [Pool, OperatorAuthService], useFactory: (pool: Pool, auth: OperatorAuthService) => new ProjectCycleConfigService(pool, auth) },
    ProjectCycleProgressionLifecycle,
    { provide: ResourceReservationStore, inject: [Pool, OperatorAuthService], useFactory: (pool: Pool, auth: OperatorAuthService) => new ResourceReservationStore(pool, auth) },
    { provide: MediaCredentialKeyCustodian, useFactory: () => {
      const config = readOperatorRuntimeConfig();
      const keys = readMediaCredentialKeysFile(config.SG_PRODUCT_MEDIA_CREDENTIAL_KEY_FILE);
      try { return new MediaCredentialKeyCustodian(keys); }
      finally { if (keys) { keys.encryption.key.fill(0); for (const key of keys.digestKeys) key.key.fill(0); } }
    } },
    { provide: MediaAccountStore, inject: [Pool, OperatorAuthService, MediaCredentialKeyCustodian],
      useFactory: (pool: Pool, auth: OperatorAuthService, keys: MediaCredentialKeyCustodian) => new MediaAccountStore(pool, auth, keys) },
    // Metadata can be read; writes authenticate then fail closed if the explicit
    // protected key file is absent/invalid. No ambient/historical key fallback.
    { provide: MediaCredentialStore, inject: [Pool, OperatorAuthService, MediaCredentialKeyCustodian],
      useFactory: (pool: Pool, auth: OperatorAuthService, keys: MediaCredentialKeyCustodian) => new MediaCredentialStore(pool, auth, keys) },
    { provide: MEDIA_INPUT_GRANT_KEY_CONFIG, useFactory: (): MediaInputGrantKeyConfig | null => {
      const config = readOperatorRuntimeConfig();
      if (!config.SG_PRODUCT_MEDIA_INPUT_GRANT_KEY_FILE || !config.SG_PRODUCT_MEDIA_INPUT_GRANT_KEY_ID
        || config.SG_PRODUCT_MEDIA_INPUT_GRANT_NOT_BEFORE_MILLIS === undefined
        || config.SG_PRODUCT_MEDIA_INPUT_GRANT_NOT_AFTER_MILLIS === undefined) return null;
      return { keyFilePath: config.SG_PRODUCT_MEDIA_INPUT_GRANT_KEY_FILE, keyId: config.SG_PRODUCT_MEDIA_INPUT_GRANT_KEY_ID,
        notBeforeMillis: config.SG_PRODUCT_MEDIA_INPUT_GRANT_NOT_BEFORE_MILLIS,
        notAfterMillis: config.SG_PRODUCT_MEDIA_INPUT_GRANT_NOT_AFTER_MILLIS };
    } },
    { provide: MediaInputAuthorityStore, inject: [Pool, InstallationAuthService],
      useFactory: (pool: Pool, auth: InstallationAuthService) => new MediaInputAuthorityStore(pool, auth) },
    { provide: MediaInputAuthority, inject: [MediaInputAuthorityStore, MediaCredentialStore, MEDIA_INPUT_GRANT_KEY_CONFIG],
      useFactory: (store: MediaInputAuthorityStore, credentials: MediaCredentialStore, keyConfig: MediaInputGrantKeyConfig | null) =>
        new MediaInputAuthority(store, credentials, keyConfig) },
    { provide: ProjectPlanningService, inject: [Pool, OperatorAuthService], useFactory: (pool: Pool, auth: OperatorAuthService) => new ProjectPlanningService(pool, auth) },
    { provide: ArtemisBusinessModel, useFactory: () => readInitialDirectionModel() },
    { provide: ProjectDirectionService, inject: [Pool, OperatorAuthService, ArtemisBusinessModel], useFactory: (pool: Pool, auth: OperatorAuthService, model: ArtemisBusinessModel | null) => new ProjectDirectionService(pool, auth, model) },
    { provide: BusinessPlanWorkflowStore, inject: [Pool], useFactory: (pool: Pool) => new BusinessPlanWorkflowStore(pool) },
    // No trusted current-scope producer or phone execution/verification ports
    // are installed. This consumer exposes truthful status, never starts a
    // scheduler or widens device permissions merely because USB is present.
    { provide: BusinessPlanWorkflowConsumer, inject: [BusinessPlanWorkflowStore], useFactory: (store: BusinessPlanWorkflowStore) =>
      new BusinessPlanWorkflowConsumer(store, { readiness: null, actionGate: null, executor: null, proofVerifier: null }) },
    { provide: BusinessPlanService, inject: [Pool, OperatorAuthService, MaterialRuntime, ArtemisBusinessModel, BusinessPlanWorkflowConsumer],
      useFactory: (pool: Pool, auth: OperatorAuthService, materials: MaterialRuntime, model: ArtemisBusinessModel | null, workflow: BusinessPlanWorkflowConsumer) => new BusinessPlanService(pool, auth, materials, model, workflow) },
    { provide: BusinessPlanExecutionRuntime, inject: [BusinessPlanService, MaterialRuntime], useFactory: (service: BusinessPlanService, materials: MaterialRuntime) => {
      const url = process.env.SG_PRODUCT_EXECUTION_RUNTIME_URL, token = process.env.SG_PRODUCT_EXECUTION_RUNTIME_TOKEN;
      const bindingId = process.env.SG_PRODUCT_EXECUTION_RUNTIME_BINDING_ID, deviceId = process.env.SG_PRODUCT_EXECUTION_SERIAL, serial = process.env.SG_PRODUCT_EXECUTION_SERIAL, productDeviceId = process.env.SG_PRODUCT_EXECUTION_DEVICE_ID;
      if (!url || !token || !bindingId || !deviceId || !serial || !productDeviceId) return null;
      const reader = materials as MaterialRuntime & { readWorkflowFile?: (projectId: string, file: { objectId: string; sha256: string; bytes: number; contentType: string }) => Promise<Buffer> };
      if (!reader.readWorkflowFile) return null;
      return new BusinessPlanExecutionRuntime({ url, token, bindingId, deviceId, serial, productDeviceId },
        async scope => (await service.executionFacts(scope)).facts,
        scope => service.executionReadiness(scope),
        input => service.authorizeExecutionAction(input),
        (scope, file) => reader.readWorkflowFile!(scope.projectId, file));
    } },
    { provide: "BUSINESS_PLAN_EXECUTION_PORTS", inject: [BusinessPlanWorkflowConsumer, BusinessPlanExecutionRuntime], useFactory: (workflow: BusinessPlanWorkflowConsumer, runtime: BusinessPlanExecutionRuntime | null) => {
      if (runtime) workflow.installPorts(runtime.ports());
      return true;
    } },
    { provide: DeviceAssistanceFeedService, inject: [Pool, OperatorAuthService], useFactory: (pool: Pool, auth: OperatorAuthService) => new DeviceAssistanceFeedService(pool, auth) },
    { provide: ProviderAssistanceFeedService, inject: [Pool, ProviderAuthService], useFactory: (pool: Pool, auth: ProviderAuthService) => new ProviderAssistanceFeedService(pool, auth) },
    { provide: ProviderCommissionFeedService, inject: [Pool, ProviderAuthService], useFactory: (pool: Pool, auth: ProviderAuthService) => new ProviderCommissionFeedService(pool, auth) },
    { provide: DeviceAssistanceNotesService, inject: [Pool, OperatorAuthService], useFactory: (pool: Pool, auth: OperatorAuthService) => new DeviceAssistanceNotesService(pool, auth) },
    { provide: TaskAssistanceRecheckStore, inject: [Pool], useFactory: (pool: Pool) => new TaskAssistanceRecheckStore(pool) },
    // The scheduler consumes reports, not proof. No trusted phone recovery
    // adapter is available in this listener; unknown is persisted explicitly.
    { provide: DeviceAssistanceRecheckConsumer, inject: [TaskAssistanceRecheckStore], useFactory: (store: TaskAssistanceRecheckStore) => new DeviceAssistanceRecheckConsumer(store) },
    DeviceAssistanceRecheckLifecycle,
    // No real business target origin/definition has been supplied. Closed until
    // an explicit server-owned policy adapter is reviewed; no ambient fallback.
    { provide: TrackingLinkService, inject: [Pool, OperatorAuthService], useFactory: (pool: Pool, auth: OperatorAuthService) => new TrackingLinkService(pool, auth, null) },
    // No trusted metric source adapter is configured. The projection reports
    // not_configured and never exposes caller-supplied or inferred observations.
    { provide: MetricSnapshotStore, inject: [Pool, OperatorAuthService], useFactory: (pool: Pool, auth: OperatorAuthService) => new MetricSnapshotStore(pool, null, auth) },
    DatabaseLifecycle,
  ],
})
export class AppModule {}
