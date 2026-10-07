import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { request } from "node:https";
import { connect } from "node:net";
import { rootCertificates } from "node:tls";
import { resolve } from "node:path";

// Supplemental protocol probe only. Does not perform a product business flow
// or count as real-phone/Web acceptance. No auth/proof/pairing/policy writes.
assert.equal(process.env.SG_PRODUCT_VERIFIER_PREFLIGHT, "authorized");
const host = "macbook-pro.tail3656e0.ts.net";
const ca = await readFile(resolve("product/android/app/src/debug/res/raw/diagnostic_tailnet_ca.pem"));
const output = resolve(process.env.SOCIALGROWTH_VERIFICATION_OUTPUT ?? "artifacts/acceptance/product/B3/tailnet-proposal-20261003");
await mkdir(output, { recursive: true, mode: 0o700 });
async function probe(path: string, method = "GET", trust?: Buffer, servername = host) {
  return new Promise<{ status: number; body: Record<string, unknown> }>((yes, no) => {
    const req = request({ host, port: 9443, path, method, ca: trust, servername, rejectUnauthorized: true,
      headers: { "X-Forwarded-For": "100.118.89.89", Connection: "close" }, timeout: 5000 }, response => {
      let body = "";
      response.on("data", (bytes: Buffer) => { body += bytes; if (body.length > 4096) req.destroy(new Error()); });
      response.once("error", no); response.once("end", () => { try { yes({ status: response.statusCode ?? 0, body: JSON.parse(body) }); } catch { no(new Error()); } });
    });
    req.once("error", no); req.once("timeout", () => req.destroy(new Error())); req.end();
  });
}
let result: object;
let stage = "actual_health";
let tlsFailureCode: string | null = null;
try {
  const health = await probe("/health", "GET", ca);
  assert.equal(health.status, 200); assert.equal(health.body.trustedIncomingTransport, true);
  // Claimed Samsung header must not turn the actual Self socket into Samsung.
  assert.equal(health.body.sourceIdentityVerified, false);
  assert.equal(health.body.expectedPhoneSourceVerified, false);
  for (const key of ["restrictionVerified", "networkRevisionAvailable", "enrollmentApiReady", "networkAdmissionGranted", "actionPermissionGranted"])
    assert.equal(health.body[key], false);
  stage = "unavailable_admission";
  const blocked = await probe("/api/network-admission/challenge", "POST", ca);
  assert.equal(blocked.status, 503); assert.equal(blocked.body.code, "NETWORK_REVISION_UNAVAILABLE");
  stage = "unrelated_ca";
  await assert.rejects(probe("/health", "GET", Buffer.from(rootCertificates[0]!)), (error: unknown) => {
    if (!(error instanceof Error) || !("code" in error)) return false;
    const code = String(error.code); tlsFailureCode = /^[A-Z_]{1,64}$/.test(code) ? code : null;
    return ["DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"].includes(code);
  });
  stage = "wrong_hostname";
  await assert.rejects(probe("/health", "GET", ca, "unrelated.invalid"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" });
  stage = "loopback_forgery";
  await new Promise<void>((yes, no) => {
    const socket = connect(4443, "127.0.0.1"), timer = setTimeout(() => { socket.destroy(); no(new Error()); }, 5000);
    let bytes = 0;
    socket.once("connect", () => socket.write("PROXY TCP4 100.118.89.89 100.75.25.72 54321 4443\r\n"));
    socket.on("data", data => { bytes += data.length; }); socket.on("error", () => undefined);
    socket.once("close", () => { clearTimeout(timer); try { assert.equal(bytes, 0); yes(); } catch { no(new Error()); } });
  });
  result = { checkedAt: new Date().toISOString(), actualMacServeTransportPassed: true,
    tlsTrustRequired: true, tlsHostnameRequired: true, forgedLoopbackProxyRejected: true,
    claimedForwardedHeaderIgnored: true, unavailableAdmissionRouteBlocked: true,
    phoneIncomingSourceVerified: false, networkAdmissionGranted: false, actionPermissionGranted: false,
    evidenceScope: "supplemental_actual_mac_transport_protocol_probe_not_phone_or_business_acceptance" };
} catch {
  process.exitCode = 2; result = { checkedAt: new Date().toISOString(), actualMacServeTransportPassed: false,
    stage, tlsFailureCode, code: "TRANSPORT_PROBE_FAILED", networkAdmissionGranted: false, actionPermissionGranted: false };
}
await writeFile(resolve(output, "verifier-transport-probe.json"), JSON.stringify(result, null, 2), { mode: 0o600 });
console.log(JSON.stringify(result));
