import { Controller, Get } from "@nestjs/common";
import type { HealthResponse } from "@socialgrowth/product-contracts";

@Controller()
export class AppController {
  @Get("health")
  health(): HealthResponse {
    return {
      environment: "product",
      service: "backend",
      status: "ok",
    };
  }
}
