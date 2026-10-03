import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inspectTailnet, inspectPolicyBreadth, readTailnetInspectionConfiguration, tailnetReadOnlyScopes } from "./tailnet-readonly-inspection.js";

const config = { tailnet: "-", clientId: "synthetic-client", clientSecret: "synthetic-secret-for-fixture-only" };
const auth = () => ({ access_token: "synthetic-access-token-for-fixture", token_type: "Bearer", expires_in: 3600, scope: tailnetReadOnlyScopes.join(" ") });
type Fetch = typeof fetch;
const fixture = (oauth: object = auth(), policy: Response = new Response('{"grants":[]}', { headers: { etag: '"fixture-etag"' } }), devices = new Response('{"devices":[{},{}]}')) => {
  const calls: { url: string; options?: RequestInit }[] = [];
  const request: Fetch = async (url, options) => {
    const value = String(url); calls.push({ url: value, options });
    if (value.endsWith("/oauth/token")) return Response.json(oauth);
    if (value.endsWith("/acl")) return policy;
    if (value.endsWith("/devices")) return devices;
    throw new Error("unexpected-fixture-route");
  };
  return { request, calls };
};

test("configuration uses private owner-only descriptor; blank, extra and public files fail closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sg-tailnet-readonly-")), path = join(dir, "config.json");
  try {
    await writeFile(path, JSON.stringify(config), { mode: 0o600 });
    assert.deepEqual(await readTailnetInspectionConfiguration(path), config);
    await chmod(path, 0o644); await assert.rejects(readTailnetInspectionConfiguration(path), { message: "CONFIGURATION_UNAVAILABLE" });
    await chmod(path, 0o600);
    await symlink(path, join(dir, "link")); await assert.rejects(readTailnetInspectionConfiguration(join(dir, "link")), { message: "CONFIGURATION_UNAVAILABLE" });
    for (const body of [{ ...config, clientSecret: "" }, { ...config, endpoint: "https://evil.invalid" }, { ...config, tailnet: "../other" }, { ...config, clientId: "a\nb" }]) {
      await writeFile(path, JSON.stringify(body)); await assert.rejects(readTailnetInspectionConfiguration(path), { message: "CONFIGURATION_UNAVAILABLE" });
    }
    await writeFile(path, "x".repeat(4097)); await assert.rejects(readTailnetInspectionConfiguration(path), { message: "CONFIGURATION_UNAVAILABLE" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("fixture request is fixed official OAuth exchange followed by read-only GETs", async () => {
  const f = fixture(), result = await inspectTailnet(config, f.request);
  assert.deepEqual(f.calls.map(v => [v.url, v.options?.method]), [
    ["https://api.tailscale.com/api/v2/oauth/token", "POST"],
    ["https://api.tailscale.com/api/v2/tailnet/-/acl", "GET"],
    ["https://api.tailscale.com/api/v2/tailnet/-/devices", "GET"],
  ]);
  for (const call of f.calls) { assert.equal(call.options?.redirect, "error"); assert.ok(call.options?.signal); }
  const requestBody = f.calls[0]!.options?.body as URLSearchParams;
  assert.equal(requestBody.get("scope"), tailnetReadOnlyScopes.join(" "));
  assert.equal(result.deviceCount, 2); assert.equal(result.policyRead, true);
  assert.equal(result.registeredExitNodeCandidates, null); assert.equal(result.enabledExitNodes, null);
  assert.equal(result.externalMutationPerformed, false); assert.equal(result.isolationVerified, false);
  assert.equal(result.networkAdmissionGranted, false); assert.equal(result.actionPermissionGranted, false);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-secret|synthetic-access-token|grants/);
});
test("exit-node inventory separates advertised and enabled routes; no reachability claim", async () => {
  const f = fixture(auth(), undefined, Response.json({ devices: [{ advertisedRoutes: ["0.0.0.0/0"], enabledRoutes: [] },
    { advertisedRoutes: ["::/0"], enabledRoutes: ["::/0"] }, { advertisedRoutes: ["192.168.0.0/24"], enabledRoutes: [] }] }));
  const result = await inspectTailnet(config, f.request);
  assert.equal(result.registeredExitNodeCandidates, 2); assert.equal(result.enabledExitNodes, 1);
  assert.equal(result.isolationVerified, false);
});
test("broader, missing or incomplete token scopes never reach policy read", async () => {
  for (const scope of [undefined, "all", `${auth().scope} auth_keys`, "policy_file:read"]) {
    const f = fixture({ ...auth(), scope });
    await assert.rejects(inspectTailnet(config, f.request), { message: "OAUTH_UNAVAILABLE" });
    assert.equal(f.calls.length, 1);
  }
});
test("invalid OAuth, denied/empty policy and malformed devices retain fixed errors", async () => {
  await assert.rejects(inspectTailnet(config, fixture({ ...auth(), access_token: "bad" }).request), { message: "OAUTH_UNAVAILABLE" });
  for (const response of [new Response("sensitive-server-detail", { status: 403 }), new Response("")])
    await assert.rejects(inspectTailnet(config, fixture(auth(), response).request), { message: "POLICY_UNAVAILABLE" });
  await assert.rejects(inspectTailnet(config, fixture(auth(), undefined, new Response('{"devices":"not-a-list"}')).request), { message: "DEVICES_UNAVAILABLE" });
});
test("oversized policy is cancelled rather than retained or reported as read success", async () => {
  const f = fixture(auth(), new Response("x".repeat(1_048_577)));
  await assert.rejects(inspectTailnet(config, f.request), { message: "POLICY_UNAVAILABLE" });
  assert.equal(f.calls.length, 2);
});
test("raw platform/credential errors and invalid direct configuration are redacted", async () => {
  const request: Fetch = async () => { throw new Error(config.clientSecret); };
  await assert.rejects(inspectTailnet(config, request), { message: "OAUTH_UNAVAILABLE" });
  await assert.rejects(inspectTailnet({ ...config, clientId: "" }, request), { message: "CONFIGURATION_UNAVAILABLE" });
});
test("static broad ACL/grant hints retain additive-rule risk without claiming isolation", () => {
  const result = inspectPolicyBreadth(JSON.stringify({
    acls: [{ action: "accept", src: ["*"], dst: ["*:*"] }],
    grants: [{ src: ["*"], dst: ["*"], ip: ["*"] }], groups: { "private-group": ["private-email@example.invalid"] },
  }));
  assert.equal(result.broadNetworkRuleCount, 2); assert.equal(result.unconditionalBroadNetworkRuleCount, 2); assert.equal(result.additiveRestrictionMayBeBlocked, true);
  assert.equal(result.isolationVerified, false); assert.doesNotMatch(JSON.stringify(result), /private-email|private-group/);
  const narrow = inspectPolicyBreadth('{"grants":[{"src":["tag:pending"],"dst":["tag:verifier"],"ip":["tcp:443"]}]}');
  assert.equal(narrow.broadNetworkRuleCount, 0); assert.equal(narrow.isolationVerified, false);
  const conditional = inspectPolicyBreadth('{"grants":[{"src":["*"],"dst":["*"],"ip":["*"],"srcPosture":["posture:managed"]}]}');
  assert.equal(conditional.broadNetworkRuleCount, 1); assert.equal(conditional.unconditionalBroadNetworkRuleCount, 0);
});
test("unsupported/malformed policy never becomes isolation evidence", () => {
  for (const text of ["// HuJSON\n{}", "null", "[]", '{"grants":{}}', '{"acls":[null]}']) {
    const result = inspectPolicyBreadth(text); assert.equal(result.assessment, "unparsed_or_unsupported");
    assert.equal(result.isolationVerified, false); assert.equal(result.additiveRestrictionMayBeBlocked, true);
  }
});
