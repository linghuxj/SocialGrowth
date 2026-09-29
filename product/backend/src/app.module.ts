import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { AppController } from "./app.controller.js";
import { readOperatorRuntimeConfig } from "./config.js";
import { DatabaseLifecycle } from "./database-lifecycle.js";
import { InvitationManagementService } from "./invitation-management-service.js";
import { IdentityTransactionService } from "./identity-transactions.js";
import { OperatorAuthService } from "./operator-auth-service.js";
import { OperatorController } from "./operator.controller.js";
import {
  ProviderAuthService,
  UnavailableSmsDeliveryPort,
} from "./provider-auth-service.js";
import { ProviderController } from "./provider.controller.js";

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

const providerAuthProvider = {
  provide: ProviderAuthService,
  inject: [Pool],
  useFactory: (pool: Pool) => {
    const config = readOperatorRuntimeConfig();
    return new ProviderAuthService(
      pool,
      config.SG_PRODUCT_AUTH_PEPPER,
      new UnavailableSmsDeliveryPort(),
      config.SG_PRODUCT_SMS_CODE_LENGTH,
    );
  },
};

@Module({
  controllers: [AppController, OperatorController, ProviderController],
  providers: [
    poolProvider,
    operatorAuthProvider,
    invitationManagementProvider,
    identityTransactionProvider,
    providerAuthProvider,
    DatabaseLifecycle,
  ],
})
export class AppModule {}
