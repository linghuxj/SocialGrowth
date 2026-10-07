import { Controller, Get, Head, Inject, Param, Req, Res } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { TrackingLinkService } from "./tracking-link-service.js";
import { TrackingLinkError, recognizedTrackingPrefetch } from "./tracking-link-policy.js";
interface Request { headers: Record<string, string | string[] | undefined> }
interface Response { setHeader(name: string, value: string): void; status(code: number): Response; end(): void }
@Controller("r")
export class TrackingRedirectController {
  constructor(@Inject(TrackingLinkService) private readonly service: TrackingLinkService) {}
  @Head(":token")
  head(@Param("token") token: string, @Req() request: Request, @Res() response: Response) { return this.respond(token, request, response, "HEAD"); }
  @Get(":token")
  get(@Param("token") token: string, @Req() request: Request, @Res() response: Response) { return this.respond(token, request, response, "GET"); }
  private async respond(token: string, request: Request, response: Response, method: "GET" | "HEAD") {
    response.setHeader("Cache-Control", "no-store"); response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Length", "0");
    try {
      const target = await this.service.redirect({ token, recordId: randomUUID(), method, recognizedPrefetch: recognizedTrackingPrefetch(request.headers["sec-purpose"]) });
      response.setHeader("Location", target); response.status(302).end();
    } catch (e) {
      response.status(e instanceof TrackingLinkError && e.code === "NOT_FOUND" ? 404 : 503).end();
    }
  }
}
