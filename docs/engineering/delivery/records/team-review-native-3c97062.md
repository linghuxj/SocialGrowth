# Android native follow-up review — 2026-10-04

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

- Reviewer: `/root/adversary`.
- Base: `d8f169785c6adf3db7294158cbe7ed4925df2a1f`.
- Head: `3c97062ecc6754af3ef847aa32a8d830022fd4dd`.
- Verdict: **approved** for the exact Android engineering source candidate; open findings: none.

NATIVE-CONTROL-01 is fixed. The parser now requires the actual contractVersion, includes it in the strict response shape and checks its supported value. Non-not_requested stop states require control version/generation, generation is positive decimal with at most 19 digits, and confirmed stop requires zero unresolved actions. Complete backend-shaped parser fixtures now exercise these constraints.

NATIVE-CONTROL-02 is fixed. Provider GET, pause and resume all compare the returned device ID with the requested target. Installation GET and pause now require an expected device ID, and the initial read plus error-reconciliation read pass the current screen's target. POST still verifies the original request ID. A wrong-device result cannot become an accepted ControlAttempt or displayed stop state through these paths.

Independently read canonical ledger revision 158: provider-device-control and installation-self-control are both revision 7 with contractVersion and semantic constraints, accepted by both /root/control and /root/ux. The third provider assistance/device-label contract remains separately accepted. Only DeviceControlApiClient, MainActivity call sites and parser tests changed after the original review; the rest of the original 12-file source scope is unchanged. Full-range diff-check passed.

Producer reports `GRADLE_USER_HOME=/tmp/socialgrowth-gradle-ux ./gradlew :app:testDebugUnitTest :app:assembleDebug` passed. This reviewer did not run Gradle or a native device session. Emulator, USB, real page behavior and integrated backend calls remain **unverified**. No actual stop or new execution permission is inferred from source approval.

Author confirmed that removal of participation start/withdraw UI and the notification withdrawal action follows the lead's latest user page instruction: this screen exposes pause only. Existing ParticipationService identity-heartbeat code remains, but this slice does not offer a new user participation start; the Samsung must not be described as participating or Task-ready. Network app/settings navigation remains user-triggered and does not establish network readiness. Commission views remain internal calculations with paymentAllowed false. No device mutation, live service restart, publication or deployment occurred in this review.
