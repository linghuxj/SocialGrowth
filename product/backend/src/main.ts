import { BootstrapRelay } from "./bootstrap-relay.js";
import { DeviceConnectionApi } from "./device-connection-api.js";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { readBackendConfig } from "./config.js";
import { ProductExceptionFilter } from "./product-exception.filter.js";

async function bootstrap(): Promise<void> {
  const config = readBackendConfig();
  const app = await NestFactory.create(AppModule);
  app.getHttpAdapter().getInstance().set("trust proxy", config.SG_PRODUCT_TRUST_PROXY_HOPS);
  app.useGlobalFilters(new ProductExceptionFilter());
  app.enableShutdownHooks();
  app.get(BootstrapRelay).attach(app.getHttpServer(), token => app.get(DeviceConnectionApi).bootstrapScope(token));
  await app.listen(config.SG_PRODUCT_BACKEND_PORT, config.SG_PRODUCT_BACKEND_HOST);
  console.log(
    `[product-backend] listening on http://${config.SG_PRODUCT_BACKEND_HOST}:${config.SG_PRODUCT_BACKEND_PORT}`,
  );
}

bootstrap().catch((error: unknown) => {
  console.error("[product-backend] startup failed", error);
  process.exitCode = 1;
});
