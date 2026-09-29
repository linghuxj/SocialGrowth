import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { AppController } from "./app.controller.js";
import { readOperatorRuntimeConfig } from "./config.js";
import { DatabaseLifecycle } from "./database-lifecycle.js";
import { InvitationManagementService } from "./invitation-management-service.js";
import { OperatorAuthService } from "./operator-auth-service.js";
import { OperatorController } from "./operator.controller.js";

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

@Module({
  controllers: [AppController, OperatorController],
  providers: [
    poolProvider,
    operatorAuthProvider,
    invitationManagementProvider,
    DatabaseLifecycle,
  ],
})
export class AppModule {}
