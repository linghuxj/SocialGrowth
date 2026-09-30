import { Controller, Get, Header, Inject, Param, Query, Req } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { uuidSchema } from "@socialgrowth/product-contracts";
import { DeviceAssistanceNotesService } from "./device-assistance-notes-service.js";
import { rethrowHttp } from "./product-http.js";
interface Request { headers: Record<string, string | string[] | undefined> }
const querySchema = z.strictObject({ afterNoteId: uuidSchema.optional(), pageSize: z.string().regex(/^[1-9][0-9]?$/).refine(v => Number(v) <= 50).optional() });
@Controller("api/operator/assistance-todos")
export class DeviceAssistanceNotesController {
  constructor(@Inject(DeviceAssistanceNotesService) private readonly service: DeviceAssistanceNotesService) {}
  @Get(":todoId/notes") @Header("Cache-Control", "no-store")
  async list(@Param("todoId") todoId: string, @Query() query: unknown, @Req() request: Request) {
    try {
      const parsed = querySchema.parse(query), id = uuidSchema.parse(todoId), cookie = request.headers.cookie;
      const token = (Array.isArray(cookie) ? cookie.join(";") : cookie)?.split(";").map(s => s.trim().split("=")).find(([k]) => k === "__Host-sg_operator_session")?.[1] ?? "";
      return await this.service.list(token, id, { afterNoteId: parsed.afterNoteId ?? null, pageSize: parsed.pageSize ? Number(parsed.pageSize) : 20 });
    } catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }
}
