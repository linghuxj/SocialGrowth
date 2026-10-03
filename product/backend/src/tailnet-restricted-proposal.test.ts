import test from "node:test";
import assert from "node:assert/strict";
import { buildRestrictedProposal } from "./tailnet-restricted-proposal.js";
const policy = { grants: [{ src: ["*"], dst: ["*"], ip: ["*"] }],
  ssh: [{ action: "check", src: ["autogroup:member"], dst: ["autogroup:self"], users: ["autogroup:nonroot"] }],
  nodeAttrs: [{ target: ["autogroup:member"], attr: ["funnel"] }], custom: { keep: "private-fixture-value" }, tests: [{ src: "100.70.1.2", accept: ["100.70.1.2:22"] }] };
const scope = { pendingAddresses: ["100.70.1.1", "fd7a:115c:a1e0::1"], verifierAddresses: ["100.70.1.2", "fd7a:115c:a1e0::2"],
  preservedAddresses: ["100.70.1.2", "fd7a:115c:a1e0::2", "100.70.1.3"], verifierPort: 9443 };
test("review candidate replaces only default broad grant, preserves sections/tests and covers both address families", () => {
  const result = buildRestrictedProposal(JSON.stringify(policy), scope), candidate = JSON.parse(result.text);
  for (const key of ["ssh", "nodeAttrs", "custom"] as const) assert.deepEqual(candidate[key], policy[key]);
  assert.deepEqual(candidate.tests[0], policy.tests[0]);
  assert.deepEqual(candidate.grants[0], { src: ["100.70.1.1/32", "fd7a:115c:a1e0::1/128"], dst: ["100.70.1.2/32", "fd7a:115c:a1e0::2/128"], ip: ["tcp:9443"] });
  assert.equal(candidate.tests[1].proto, "tcp"); assert.deepEqual(candidate.tests[1].accept, ["100.70.1.2:9443"]);
  assert.ok(candidate.tests[1].deny.includes("100.70.1.2:4320"));
  assert.ok(candidate.tests[1].deny.includes("100.70.1.3:443"));
  assert.equal(candidate.tests[2].proto, "udp"); assert.ok(candidate.tests[2].deny.includes("100.70.1.2:9443"));
  assert.equal(result.summary.generatedTestCount, 10); assert.equal(result.summary.networkAdmissionGranted, false);
  assert.equal(result.summary.isolationVerified, false); assert.doesNotMatch(JSON.stringify(result.summary), /private-fixture-value/);
});
test("ambiguous/custom network policies are refused rather than dropping authorization", () => {
  for (const input of [null, [], { ...policy, acls: [{ action: "accept", src: ["*"], dst: ["*:*"] }] },
    { ...policy, grants: [...policy.grants, { src: ["tag:x"], dst: ["*"], ip: ["*"] }] },
    { ...policy, grants: [{ ...policy.grants[0], srcPosture: ["posture:x"] }] }, { ...policy, tests: {} }])
    assert.throws(() => buildRestrictedProposal(JSON.stringify(input), scope), { message: "POLICY_PROPOSAL_SCOPE_REJECTED" });
});
test("scope cannot overlap target, borrow LAN, omit verifier from preserved set or use invalid port", () => {
  for (const change of [{ pendingAddresses: scope.verifierAddresses }, { pendingAddresses: ["192.168.1.2"] },
    { preservedAddresses: ["100.70.1.3"] }, { pendingAddresses: [] }, { pendingAddresses: ["100.70.1.1", "100.70.1.1"] },
    { verifierPort: 0 }, { verifierPort: 65536 }, { verifierPort: 9443.5 }])
    assert.throws(() => buildRestrictedProposal(JSON.stringify(policy), { ...scope, ...change }));
});
