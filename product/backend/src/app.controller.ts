import { Controller, Get } from "@nestjs/common";
import type { LivenessResponse } from "@socialgrowth/product-contracts";

@Controller()
export class AppController {
  @Get("health/live")
  liveness(): LivenessResponse {
    return {
      environment: "product",
      service: "backend",
      status: "alive",
    };
  }
}
