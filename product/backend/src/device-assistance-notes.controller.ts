import { Controller, Get, Header, Inject, Param, Query, Req } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { uuidSchema } from "@socialgrowth/product-contracts";
import { DeviceAssistanceNotesService } from "./device-assistance-notes-service.js";
import { operatorSessionTokenFrom } from "./operator-session-cookie.js";
import { rethrowHttp } from "./product-http.js";
interface Request { headers: Record<string, string | string[] | undefined> }
const querySchema = z.strictObject({ afterNoteId: uuidSchema.optional(), pageSize: z.string().regex(/^[1-9][0-9]?$/).refine(v => Number(v) <= 50).optional() });
const impactQuerySchema = z.strictObject({ afterDeviceId: uuidSchema.optional(), pageSize: z.string().regex(/^[1-9][0-9]?$/).refine(v => Number(v) <= 50).optional() });
@Controller("api/operator/assistance-todos")
export class DeviceAssistanceNotesController {
  constructor(@Inject(DeviceAssistanceNotesService) private readonly service: DeviceAssistanceNotesService) {}
  @Get(":todoId") @Header("Cache-Control", "no-store")
  async detail(@Param("todoId") todoId: string, @Req() request: Request) {
    try {
      return await this.service.detail(operatorSessionTokenFrom(request.headers.cookie), uuidSchema.parse(todoId));
    } catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }
  @Get(":todoId/notes") @Header("Cache-Control", "no-store")
  async list(@Param("todoId") todoId: string, @Query() query: unknown, @Req() request: Request) {
    try {
      const parsed = querySchema.parse(query), id = uuidSchema.parse(todoId), token = operatorSessionTokenFrom(request.headers.cookie);
      return await this.service.list(token, id, { afterNoteId: parsed.afterNoteId ?? null, pageSize: parsed.pageSize ? Number(parsed.pageSize) : 20 });
    } catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }
  @Get(":todoId/impacts") @Header("Cache-Control", "no-store")
  async listImpacts(@Param("todoId") todoId: string, @Query() query: unknown, @Req() request: Request) {
    try {
      const parsed = impactQuerySchema.parse(query), id = uuidSchema.parse(todoId), token = operatorSessionTokenFrom(request.headers.cookie);
      return await this.service.listImpacts(token, id, { afterDeviceId: parsed.afterDeviceId ?? null, pageSize: parsed.pageSize ? Number(parsed.pageSize) : 20 });
    } catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }
}
