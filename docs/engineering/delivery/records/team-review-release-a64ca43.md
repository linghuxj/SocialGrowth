# Independent Android release-gate review

Reviewer: `/root/adversary`

Base: `d39f9ca70e24d5adf5b1ab8ba31f5c5e70542a8d`

Head: `a64ca43aca018ec553666ca83a807e27babc7412`

Verdict: **changes_requested**.

**RELEASE-TASK-GATE-01 (P2): validation is conditional on the literal command-line task spelling.** releaseRequested only recognizes strings containing release and three aggregate names; Gradle also resolves abbreviated task selectors such as :app:assembleRel or :app:aR, and release tasks can be dependencies of another task. These paths leave releaseRequested false, skip registering verification dependencies, and configure fallback version 1 / placeholder endpoint / no signing config for an actual release variant. Thus the proposed fail-closed boundary is not attached to the actual release task graph. Bind verification to real release tasks/variants independently of CLI spelling, and ensure the release artifact always receives the explicit validated inputs. Add a rejection probe through an abbreviated selector rather than enumerating aliases.

The remainder of the diff was inspected for credential output and authority expansion. Explicit full-name negative cases, certificate fingerprint comparison, temporary CI certificate cleanup and debug separation are useful evidence, but they do not cover the bypass. Author reports debug build and several full-name negative checks passed; formal key/cert/endpoint, release signing and device upgrade/rollback are unverified. The reviewer did not open keystores, read signing values, build a release artifact or operate a device. This is a source finding, not a claim that a production package was released.
