import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { AppController } from "./app.controller.js";
import { readOperatorRuntimeConfig, readSmsRuntimeConfig } from "./config.js";
import { DatabaseLifecycle } from "./database-lifecycle.js";
import { DevelopmentProviderSmsController } from "./development-provider-sms.controller.js";
import { InvitationManagementService } from "./invitation-management-service.js";
import { IdentityTransactionService } from "./identity-transactions.js";
import { InstallationAuthService } from "./installation-auth-service.js";
import { InstallationController } from "./installation.controller.js";
import { OperatorAuthService } from "./operator-auth-service.js";
import { OperatorController } from "./operator.controller.js";
import { ProviderAuthService } from "./provider-auth-service.js";
import { ProviderController } from "./provider.controller.js";
import { ProjectService } from "./project-service.js";
import { ProjectController } from "./project.controller.js";
import { ProjectPlanningController } from "./project-planning.controller.js";
import { ProjectPlanningService } from "./project-planning-service.js";
import { DeviceAssistanceFeedService } from "./device-assistance-feed-service.js";
import { DeviceAssistanceFeedController } from "./device-assistance-feed.controller.js";
import { ProviderAssistanceFeedService } from "./provider-assistance-feed-service.js";
import { ProviderAssistanceFeedController } from "./provider-assistance-feed.controller.js";
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
    DevelopmentProviderSmsController,
    InstallationController,
    OperatorController,
    ProviderController,
    ProjectController,
    ProjectPlanningController,
    DeviceAssistanceFeedController,
    ProviderAssistanceFeedController,
  ],
  providers: [
    poolProvider,
    operatorAuthProvider,
    invitationManagementProvider,
    identityTransactionProvider,
    installationAuthProvider,
    smsRuntimeProvider,
    providerAuthProvider,
    { provide: ProjectService, inject: [Pool, OperatorAuthService], useFactory: (pool: Pool, auth: OperatorAuthService) => new ProjectService(pool, auth) },
    { provide: ProjectPlanningService, inject: [Pool, OperatorAuthService], useFactory: (pool: Pool, auth: OperatorAuthService) => new ProjectPlanningService(pool, auth) },
    { provide: DeviceAssistanceFeedService, inject: [Pool, OperatorAuthService], useFactory: (pool: Pool, auth: OperatorAuthService) => new DeviceAssistanceFeedService(pool, auth) },
    { provide: ProviderAssistanceFeedService, inject: [Pool, ProviderAuthService], useFactory: (pool: Pool, auth: ProviderAuthService) => new ProviderAssistanceFeedService(pool, auth) },
    DatabaseLifecycle,
  ],
})
export class AppModule {}
