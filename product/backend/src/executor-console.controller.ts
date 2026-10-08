import { Body, Controller, Get, Header, Headers, Inject, Param, Post, Query, Req, Res } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { executorVerificationSchema, executorResponseSchema, executorCredentialSchema, executorStopSchema, executorHoldSchema } from "@socialgrowth/product-contracts";
import { ExecutorConsoleService } from "./executor-console-service.js";
import { operatorSessionTokenFrom } from "./operator-session-cookie.js";
import { rethrowHttp } from "./product-http.js";

interface Request { headers: Record<string, string | string[] | undefined> }
@Controller("api/operator/executor")
export class ExecutorConsoleController {
  constructor(@Inject(ExecutorConsoleService) private readonly service: ExecutorConsoleService) {}
  @Get("status") @Header("Cache-Control", "no-store")
  async read(@Req() request: Request) {
    try { return await this.service.read(operatorSessionTokenFrom(request.headers.cookie)); }
    catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }
  private async mutate(request: Request, csrf: string | undefined, path: Parameters<ExecutorConsoleService["mutate"]>[2], input: unknown) {
    return this.service.mutate(operatorSessionTokenFrom(request.headers.cookie), csrf ?? "", path, input);
  }
  @Post("verifications") @Header("Cache-Control", "no-store")
  async start(@Req() request: Request, @Headers("x-csrf-token") csrf: string | undefined, @Body() body: unknown) {
    try { return await this.mutate(request, csrf, "verifications", executorVerificationSchema.parse(body)); }
    catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }
  @Post("bootstrap-verifications") @Header("Cache-Control", "no-store")
  async bootstrap(@Req() request: Request, @Headers("x-csrf-token") csrf: string | undefined, @Body() body: unknown) {
    try { return await this.mutate(request, csrf, "bootstrap-verifications", body); }
    catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }
  @Post("bootstrap-handoff") @Header("Cache-Control", "no-store")
  async handoff(@Req() request: Request, @Headers("x-csrf-token") csrf: string | undefined, @Body() body: unknown) {
    try { return await this.mutate(request, csrf, "bootstrap-handoff", body); }
    catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }
  @Post("bootstrap-initialization-resume") @Header("Cache-Control", "no-store")
  async resumeInitialization(@Req() request: Request, @Headers("x-csrf-token") csrf: string | undefined, @Body() body: unknown) {
    try { return await this.mutate(request, csrf, "bootstrap-initialization-resume", body); }
    catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }
  @Post("stop") @Header("Cache-Control", "no-store")
  async stop(@Req() request: Request, @Headers("x-csrf-token") csrf: string | undefined, @Body() body: unknown) {
    try { return await this.mutate(request, csrf, "verifications/stop", executorStopSchema.parse(body)); }
    catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }
  @Post("respond") @Header("Cache-Control", "no-store")
  async respond(@Req() request: Request, @Headers("x-csrf-token") csrf: string | undefined, @Body() body: unknown) {
    try { return await this.mutate(request, csrf, "supervision/respond", executorResponseSchema.parse(body)); }
    catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }
  @Post("credential") @Header("Cache-Control", "no-store")
  async credential(@Req() request: Request, @Headers("x-csrf-token") csrf: string | undefined, @Body() body: unknown) {
    try { return await this.mutate(request, csrf, "assistance/submit", executorCredentialSchema.parse(body)); }
    catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }
  @Post("cancel-credential") @Header("Cache-Control", "no-store")
  async cancel(@Req() request: Request, @Headers("x-csrf-token") csrf: string | undefined, @Body() body: unknown) {
    try { return await this.mutate(request, csrf, "assistance/cancel", executorStopSchema.parse(body)); }
    catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }
  @Post("hold") @Header("Cache-Control", "no-store")
  async hold(@Req() request: Request, @Headers("x-csrf-token") csrf: string | undefined, @Body() body: unknown) {
    try { return await this.mutate(request, csrf, "device-control", executorHoldSchema.parse(body)); }
    catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }
  @Get("screenshots/:kind/:id") @Header("Cache-Control", "no-store")
  async screenshot(@Req() request: Request, @Param("kind") kind: string, @Param("id") id: string, @Query("result") result: string | undefined,
    @Res() response: { setHeader(name: string, value: string): void; send(value: Buffer): void }) {
    try {
      const bytes = await this.service.screenshot(operatorSessionTokenFrom(request.headers.cookie), z.enum(["supervision", "verifications", "assistance"]).parse(kind), z.string().min(1).max(256).parse(id), result === "1");
      response.setHeader("Content-Type", "image/png"); response.setHeader("Cache-Control", "no-store"); response.send(bytes);
    } catch (error) { rethrowHttp(error, `request-${randomUUID()}`); }
  }
}
