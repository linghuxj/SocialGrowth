import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// Publish explicit phone management/setup routes only. Backend checks still
// bind every authenticated operation to the current provider or installation.
// No arbitrary upstream URLs, operator API or development SMS.
const protectedSetupPosts = new Set([
  "/api/installation/network-setup/key", "/api/installation/device-connection/state",
  "/api/installation/device-connection/epoch", "/api/installation/device-connection/report",
  "/api/provider/device-connection/state", "/api/provider/device-connection/pair",
  "/api/provider/devices/list", "/api/provider/logout",
  "/api/installation/self/control/pause",
  "/api/provider/association-sessions/inspect", "/api/provider/association-sessions/confirm",
  "/api/provider/association-sessions/result",
]);
const allowedPosts = new Set([
  "/api/installation/bootstrap", "/api/installation/state", "/api/installation/association-sessions",
  "/api/provider/phone-verifications", "/api/provider/phone-verifications/verify",
  "/api/provider/login", "/api/provider/register",
  "/api/provider/association-sessions/inspect", "/api/provider/association-sessions/confirm",
  "/api/provider/association-sessions/result",
  ...protectedSetupPosts,
]);
const deviceIdPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
function protectedRead(path: string): boolean {
  return path === "/api/installation/self/control"
    || new RegExp(`^/api/provider/devices/${deviceIdPattern}/control$`).test(path)
    || /^\/api\/provider\/assistance-todos(?:\?pageSize=(?:[1-9]|[1-4][0-9]|50)(?:&afterTodoId=[0-9a-f-]{36})?)?$/.test(path);
}
function protectedDevicePost(path: string): boolean {
  return new RegExp(`^/api/provider/devices/${deviceIdPattern}/(?:label|control/(?:pause|resume))$`).test(path);
}
const maximumBytes = 32_768;
const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>手机接入服务</title><style>body{font:17px system-ui;max-width:560px;margin:12vh auto;padding:24px;color:#172b4d}button{font:inherit;background:#2459c4;color:white;border:0;border-radius:8px;padding:14px 24px;cursor:pointer}p{line-height:1.8}#status{padding:16px;background:#f4f6fa;border-radius:8px}</style><h1>手机接入服务</h1><p>此地址可通过互联网访问，不需要先安装或登录 Tailscale。</p><p>请在 SocialGrowth App 中选择“接入这台执行手机”，按页面说明继续。</p><button id="check">检查接入服务</button><p id="status" role="status">点击按钮检查服务是否可用。</p><script src="/check.js"></script></html>`;
const script = `document.getElementById('check').onclick=async()=>{const b=document.getElementById('check'),s=document.getElementById('status');b.disabled=true;s.textContent='正在检查…';try{const r=await fetch('/health/live',{cache:'no-store'});const j=await r.json();if(!r.ok||j.status!=='alive')throw Error();s.textContent='接入服务可用。可以返回 SocialGrowth App 继续。';s.dataset.result='passed'}catch{s.textContent='暂时无法联系接入服务，请稍后重试。';s.dataset.result='failed'}finally{b.disabled=false}};`;

function headers(res: ServerResponse): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
}
function json(res: ServerResponse, status: number, value: unknown): void {
  if (res.writableEnded) return;
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}
async function boundedBody(request: IncomingMessage): Promise<Buffer> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += bytes.length;
    if (size > maximumBytes) throw new Error("PAYLOAD_TOO_LARGE");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

export function publicPhoneAccessServer(upstream = "http://127.0.0.1:4320") {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(upstream)) throw new Error("Loopback upstream required");
  let windowStarted = Date.now(), requests = 0;
  const server = createServer({ maxHeaderSize: 8192 }, async (req, res) => {
    headers(res);
    const path = req.url ?? "";
    if (Date.now() - windowStarted >= 60_000) { windowStarted = Date.now(); requests = 0; }
    if (++requests > 120) { res.setHeader("Retry-After", "60"); json(res, 429, { error: "RATE_LIMITED" }); return; }
    if (req.method === "GET" && path === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(page); return;
    }
    if (req.method === "GET" && path === "/check.js") {
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" }); res.end(script); return;
    }
    const health = req.method === "GET" && path === "/health/live";
    const read = req.method === "GET" && protectedRead(path);
    const devicePost = req.method === "POST" && protectedDevicePost(path);
    if (!health && !read && !devicePost && !(req.method === "POST" && allowedPosts.has(path))) { json(res, 404, { error: "NOT_FOUND" }); req.resume(); return; }
    if ((read || devicePost || protectedSetupPosts.has(path)) && !/^Bearer [A-Za-z0-9_-]{43}$/.test(req.headers.authorization ?? "")) {
      json(res, 401, { error: "AUTHENTICATION_REQUIRED" }); req.resume(); return;
    }
    if (!health && !read && !/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers["content-type"] ?? "")) {
      json(res, 415, { error: "JSON_REQUIRED" }); req.resume(); return;
    }
    if (Number(req.headers["content-length"] ?? 0) > maximumBytes) { json(res, 413, { error: "PAYLOAD_TOO_LARGE" }); req.resume(); return; }
    try {
      const body = health || read ? undefined : await boundedBody(req);
      // Caller-supplied forwarding headers, cookies and development tokens are discarded.
      const forwarding: Record<string, string> = { "Content-Type": "application/json" };
      const authorization = req.headers.authorization;
      if (authorization && /^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)) forwarding.Authorization = authorization;
      const reply = await fetch(`${upstream}${path}`, { method: health || read ? "GET" : "POST", headers: forwarding,
        ...(body ? { body: new Uint8Array(body).buffer } : {}),
        signal: AbortSignal.timeout(path === "/api/provider/device-connection/pair" ? 40_000
          : path === "/api/installation/device-connection/report" ? 12_000 : 5000), redirect: "error" });
      const responseBody = Buffer.from(await reply.arrayBuffer());
      if (responseBody.length > maximumBytes) throw new Error("UPSTREAM_RESPONSE_TOO_LARGE");
      const contentType = reply.headers.get("content-type") ?? "";
      if (!contentType.startsWith("application/json")) throw new Error("UPSTREAM_RESPONSE_INVALID");
      res.writeHead(reply.status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(responseBody);
    } catch (error) {
      json(res, error instanceof Error && error.message === "PAYLOAD_TOO_LARGE" ? 413 : 503,
        { error: "ACCESS_SERVICE_UNAVAILABLE" });
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 5000;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = publicPhoneAccessServer();
  server.listen(4330, "127.0.0.1", () => console.log("[public-phone-access] listening on 127.0.0.1:4330"));
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { server.close(); server.closeIdleConnections(); });
}
