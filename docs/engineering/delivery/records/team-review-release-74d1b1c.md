# Independent Android release gate re-review

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

Reviewer: `/root/adversary`

Base: `d39f9ca70e24d5adf5b1ab8ba31f5c5e70542a8d`

Head: `74d1b1c5a19ca5cdc68a484d2d207b42db037b28`

Verdict: **approved** for the three-file build configuration, workflow negative checks and deployment instructions. No outstanding material findings in this scope.

**RELEASE-TASK-GATE-01 resolved.** Guard wiring now uses resolved Gradle tasks unconditionally: preReleaseBuild and release package/assemble/bundle artifact tasks depend on verifyProductAndroidReleaseInputs. CLI abbreviations therefore cannot skip validation. Actual release output version providers read the same explicit variables checked by validation; the release BuildConfig endpoint and signing configuration likewise use those variables. Missing values may permit configuration of a debug build but cannot pass the release task guard. This is a build safeguard, not a security boundary against a caller deliberately modifying/excluding build tasks.

Input validation checks version monotonicity against the explicitly supplied previous version, constrained version labels, HTTPS/non-placeholder endpoint, usable keystore signing entry and SHA-256 certificate match. It does not establish production version history, endpoint ownership or trust in the externally supplied fingerprint. The workflow uses synthetic temporary signing material only for rejection and checks that its password is absent from output; it does not sign a release or expand workflow permissions.

Reviewer independently inspected the full exact three-file diff, ran scoped diff --check and extracted the exact new workflow shell block for bash -n: passed. Author reports isolated debug clean assemble plus full/abbreviated missing-input, placeholder endpoint, non-incrementing version, missing keystore, and synthetic wrong-fingerprint rejection checks passed, with fixture cleanup. These Gradle runs were not repeated by the reviewer.

Formal signing, a successful real release artifact, trusted endpoint verification, upgrade/identity preservation, rollback, old-client compatibility, actual phone installation and user acceptance remain unverified. No production signing material was accessed by this review.
