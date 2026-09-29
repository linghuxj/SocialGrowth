import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { readBackendConfig } from "./config.js";

async function bootstrap(): Promise<void> {
  const config = readBackendConfig();
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(config.SG_PRODUCT_BACKEND_PORT, config.SG_PRODUCT_BACKEND_HOST);
  console.log(
    `[product-backend] listening on http://${config.SG_PRODUCT_BACKEND_HOST}:${config.SG_PRODUCT_BACKEND_PORT}`,
  );
}

bootstrap().catch((error: unknown) => {
  console.error("[product-backend] startup failed", error);
  process.exitCode = 1;
});
