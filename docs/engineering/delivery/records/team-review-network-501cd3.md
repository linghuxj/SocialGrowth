# BE-NET CAS independent review — 2026-10-04

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

- Reviewer: `/root/adversary`.
- Base: `2a43976e23caa1010d31caadd97a0b6e964f72d1`.
- Head: `501cd30066ec0e3398c2132e0ec06ab7943ada38`.
- Verdict: **changes_requested**. Earlier withdrawn head `6ac8fd462528d7593ba9c60a3f0c270274ee405b` has no approval.
- Scope: new policy CAS module/tests and the verifier boolean diagnostic rename. No runtime wiring, external configuration, Tailnet write, phone operation, or PR approval.

## Findings

### NET-CAS-01 — P2 — asynchronous input mutation breaks the fixed candidate and recovery receipt

`product/backend/src/tailnet-policy-cas.ts:129-172`: `applyReviewedProposal` reads mutable caller-owned `input` after its first asynchronous read and again after later awaits. A reused input object can change both scope and reviewed hash during that read, so the method executes a different candidate than supplied at invocation. Changing `recoveryFile` after save also makes a successful receipt point to an absent recovery artifact.

Independent probe against the exact candidate source reproduced both: the fixture changed pending address and reviewed hash during the initial OAuth await; a different candidate was applied. After the policy POST, changing the input path caused the returned recovery path to fail `stat` with `ENOENT`, while the original saved file existed. No external API was contacted.

Fix: synchronously snapshot all input scalars and nested scope arrays before the first await. Use that one snapshot for review comparison, proposal generation, file save, and receipt. Add a regression for mutation across awaits.

### NET-CAS-02 — P2 — recovery directory entry is not synchronized before the policy mutation

`product/backend/src/tailnet-policy-cas.ts:79-91,156-161`: the recovery file is exclusively created and its contents synchronized, but the parent directory is never synchronized. A host/power failure after the external write can therefore lose the newly created directory entry even when the file sync succeeded. This weakens the prerequisite that rollback bytes are saved before mutation.

Fix: hold and validate the private parent directory handle, synchronize the file and then parent directory before sending the policy POST; fail closed if either synchronization fails. This is a static durability finding; no power-failure experiment was performed.

## Verification and boundaries

- Independently inspected the complete three-file delta, including strong quoted ETag rejection, exact scope checks, guarded recovery file access, error redaction, optimistic concurrency, and no admission grants.
- Independent exact-source fixture rerun: **9/9 passed**. Additional reviewer race probe: **1/1 reproduced** the defect above. Command: `pnpm exec tsx --test <adversary>/.runtime/review-net-501cd3/tailnet-policy-cas.test.ts <adversary>/.runtime/review-net-501cd3/input-race.test.ts` from canonical repository using project Node 24.16.0.
- First extraction attempt omitted the source-verifier dependency and could not load the suite. Added the exact same-head dependency and reran successfully; this was a reviewer fixture setup failure, not a product failure.
- The [official credential scope reference](https://tailscale.com/docs/reference/trust-credentials) confirms policy-file write scope requires device-core read and posture-attribute dependencies. Those dependencies are not reported as excessive by this review.
- Validation and CAS evidence are isolated HTTP fixtures only. Live policy validation, real Tailnet response compatibility, data-plane isolation, network revision generation, Web acceptance, phone readiness, and actual recovery after power loss remain unverified.
- Unknown/lost write acknowledgment stays unknown and is not retried. The implementation has no runtime provider wiring and never returns network admission or action permission from apply success.
