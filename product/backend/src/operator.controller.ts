import {
  Body,
  Controller,
  Get,
  Headers,
  Header,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import {
  createInvitationRequestSchema,
  createOperatorRequestSchema,
  disableOperatorRequestSchema,
  operatorLoginRequestSchema,
  requestTraceSchema,
  revokeInvitationRequestSchema,
} from "@socialgrowth/product-contracts";
import { randomUUID } from "node:crypto";
import { OperatorAuthService } from "./operator-auth-service.js";
import { InvitationManagementService } from "./invitation-management-service.js";
import { operatorSessionTokenFrom } from "./operator-session-cookie.js";
import {
  requestIdFrom,
  requireSupportedContract,
  rethrowHttp,
} from "./product-http.js";

const sessionCookieName = "__Host-sg_operator_session";

interface HttpRequest {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}

interface HttpResponse {
  setHeader(name: string, value: string): void;
}

function cookieValue(request: HttpRequest, name: string): string | undefined {
  return name === sessionCookieName ? operatorSessionTokenFrom(request.headers.cookie) || undefined : undefined;
}

function sessionCookie(token: string, maxAge: number): string {
  return `${sessionCookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

@Controller("api/operator")
export class OperatorController {
  constructor(
    @Inject(OperatorAuthService) private readonly service: OperatorAuthService,
    @Inject(InvitationManagementService)
    private readonly invitationService: InvitationManagementService,
  ) {}

  @Post("login")
  @Header("Cache-Control", "no-store")
  async login(
    @Body() body: unknown,
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    const requestId = requestIdFrom(body);
    try {
      requireSupportedContract(body);
      const parsed = operatorLoginRequestSchema.parse(body);
      const clientScope = request.ip ?? request.socket?.remoteAddress ?? "unknown-client";
      const result = await this.service.login(parsed, clientScope);
      const expiresAt = Date.parse(result.response.session.expiresAt);
      const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      response.setHeader("Set-Cookie", sessionCookie(result.sessionToken, maxAge));
      return result.response;
    } catch (error) {
      rethrowHttp(error, requestId);
    }
  }

  @Get("accounts")
  @Header("Cache-Control", "no-store")
  async list(@Req() request: HttpRequest) {
    const requestId = `request-${randomUUID()}`;
    try {
      return await this.service.listOperators(
        cookieValue(request, sessionCookieName) ?? "",
      );
    } catch (error) {
      rethrowHttp(error, requestId);
    }
  }

  @Get("invitations")
  @Header("Cache-Control", "no-store")
  async listInvitations(@Req() request: HttpRequest) {
    const requestId = `request-${randomUUID()}`;
    try {
      return await this.invitationService.listInvitations(
        cookieValue(request, sessionCookieName) ?? "",
      );
    } catch (error) {
      rethrowHttp(error, requestId);
    }
  }

  @Get("device-facts")
  @Header("Cache-Control", "no-store")
  async listDeviceFacts(@Req() request: HttpRequest) {
    const requestId = `request-${randomUUID()}`;
    try {
      return await this.service.listDeviceFacts(
        cookieValue(request, sessionCookieName) ?? "",
      );
    } catch (error) {
      rethrowHttp(error, requestId);
    }
  }

  @Post("invitations")
  @Header("Cache-Control", "no-store")
  async createInvitation(
    @Body() body: unknown,
    @Req() request: HttpRequest,
    @Headers("x-csrf-token") csrfToken: string | undefined,
  ) {
    const requestId = requestIdFrom(body);
    try {
      requireSupportedContract(body);
      return await this.invitationService.createInvitation(
        cookieValue(request, sessionCookieName) ?? "",
        csrfToken ?? "",
        createInvitationRequestSchema.parse(body),
      );
    } catch (error) {
      rethrowHttp(error, requestId);
    }
  }

  @Post("invitations/:invitationId/revoke")
  @Header("Cache-Control", "no-store")
  async revokeInvitation(
    @Param("invitationId") invitationId: string,
    @Body() body: unknown,
    @Req() request: HttpRequest,
    @Headers("x-csrf-token") csrfToken: string | undefined,
  ) {
    const requestId = requestIdFrom(body);
    try {
      requireSupportedContract(body);
      const input = typeof body === "object" && body !== null
        ? { ...body, invitationId }
        : body;
      return await this.invitationService.revokeInvitation(
        cookieValue(request, sessionCookieName) ?? "",
        csrfToken ?? "",
        revokeInvitationRequestSchema.parse(input),
      );
    } catch (error) {
      rethrowHttp(error, requestId);
    }
  }

  @Post("accounts")
  @Header("Cache-Control", "no-store")
  async create(
    @Body() body: unknown,
    @Req() request: HttpRequest,
    @Headers("x-csrf-token") csrfToken: string | undefined,
  ) {
    const requestId = requestIdFrom(body);
    try {
      requireSupportedContract(body);
      return await this.service.createOperator(
        cookieValue(request, sessionCookieName) ?? "",
        csrfToken ?? "",
        createOperatorRequestSchema.parse(body),
      );
    } catch (error) {
      rethrowHttp(error, requestId);
    }
  }

  @Post("accounts/:operatorId/disable")
  @Header("Cache-Control", "no-store")
  async disable(
    @Param("operatorId") operatorId: string,
    @Body() body: unknown,
    @Req() request: HttpRequest,
    @Headers("x-csrf-token") csrfToken: string | undefined,
  ) {
    const requestId = requestIdFrom(body);
    try {
      requireSupportedContract(body);
      const input =
        typeof body === "object" && body !== null
          ? { ...body, operatorId }
          : body;
      return await this.service.disableOperator(
        cookieValue(request, sessionCookieName) ?? "",
        csrfToken ?? "",
        disableOperatorRequestSchema.parse(input),
      );
    } catch (error) {
      rethrowHttp(error, requestId);
    }
  }

  @Post("logout")
  @Header("Cache-Control", "no-store")
  async logout(
    @Body() body: unknown,
    @Req() request: HttpRequest,
    @Headers("x-csrf-token") csrfToken: string | undefined,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    const requestId = requestIdFrom(body);
    try {
      requireSupportedContract(body);
      const parsed = requestTraceSchema.parse(
        typeof body === "object" && body !== null && "metadata" in body
          ? body.metadata
          : body,
      );
      await this.service.logout(
        cookieValue(request, sessionCookieName) ?? "",
        csrfToken ?? "",
        parsed.requestId,
      );
      response.setHeader("Set-Cookie", sessionCookie("", 0));
      return { success: true };
    } catch (error) {
      rethrowHttp(error, requestId);
    }
  }
}
