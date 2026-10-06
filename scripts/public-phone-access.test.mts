import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { once } from "node:events";
import { publicPhoneAccessServer } from "./public-phone-access.mts";

test("public gateway forwards scoped phone setup and strips privileged headers", async () => {
  let forwarded = 0;
  const upstream = createServer((req, res) => {
    forwarded++;
    assert.equal(req.headers["x-development-sms-token"], undefined);
    assert.equal(req.headers["x-forwarded-for"], undefined);
    assert.equal(req.headers.cookie, undefined);
    res.writeHead(401, { "Content-Type": "application/json" }); res.end('{"error":"AUTHENTICATION_REQUIRED"}');
  });
  upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
  const address = upstream.address(); assert.ok(address && typeof address !== "string");
  const gateway = publicPhoneAccessServer(`http://127.0.0.1:${address.port}`);
  gateway.listen(0, "127.0.0.1"); await once(gateway, "listening");
  const published = gateway.address(); assert.ok(published && typeof published !== "string");
  const base = `http://127.0.0.1:${published.port}`;
  try {
    for (const path of ["/api/operator/login", "/internal/development/provider-sms-codes/read", "/api/installation/state?alias=1", "/api/installation/%73tate"]) {
      assert.equal((await fetch(base + path, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } })).status, 404);
    }
    assert.equal(forwarded, 0);
    for (const path of ["/api/installation/network-setup/key", "/api/installation/device-connection/state", "/api/installation/device-connection/epoch", "/api/installation/device-connection/report", "/api/provider/devices/list", "/api/provider/device-connection/pair"]) {
      for (const authorization of [undefined, "Bearer invalid", "Bearer " + "x".repeat(42)]) {
        assert.equal((await fetch(base + path, { method: "POST", body: "{}", headers: {
          "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}),
        } })).status, 401);
      }
    }
    assert.equal(forwarded, 0, "Missing or malformed setup credentials must never reach the backend");
    assert.equal((await fetch(base + "/api/installation/state", { method: "GET" })).status, 404);
    assert.equal((await fetch(base + "/api/installation/state", { method: "POST", body: "{}" })).status, 415);
    assert.equal((await fetch(base + "/api/installation/state", { method: "POST", body: "x".repeat(32_769), headers: { "Content-Type": "application/json" } })).status, 413);
    assert.equal(forwarded, 0);
    const response = await fetch(base + "/api/installation/state", { method: "POST", body: "{}", headers: {
      "Content-Type": "application/json", "x-development-sms-token": "do-not-forward", "x-forwarded-for": "192.0.2.1", cookie: "operator=do-not-forward",
    } });
    assert.equal(response.status, 401); assert.equal(forwarded, 1);
    assert.equal(response.headers.get("cache-control"), "no-store");
    for (const path of ["/api/installation/network-setup/key", "/api/installation/device-connection/state", "/api/installation/device-connection/epoch", "/api/installation/device-connection/report", "/api/provider/devices/list", "/api/provider/device-connection/pair"]) {
      const denied = await fetch(base + path, { method: "POST", body: "{}", headers: {
        "Content-Type": "application/json", Authorization: "Bearer " + "x".repeat(43),
      } });
      assert.equal(denied.status, 401, "Backend denial must not become a successful setup response");
      assert.equal(denied.headers.get("cache-control"), "no-store");
    }
    assert.equal(forwarded, 7);
    for (const path of ["/api/provider/assistance-todos?pageSize=50", "/api/installation/self/control"]) {
      assert.equal((await fetch(base + path)).status, 401);
    }
    assert.equal(forwarded, 7);
    assert.equal((await fetch(base + "/api/provider/assistance-todos?operator=true")).status, 404);
  } finally { gateway.close(); gateway.closeAllConnections(); upstream.close(); upstream.closeAllConnections(); }
});
