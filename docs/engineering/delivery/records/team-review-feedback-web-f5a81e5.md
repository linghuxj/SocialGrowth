# Independent complete feedback Web integration review

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

Reviewer: `/root/adversary`

Base: `1bde61548310d741bddffca15161e2b2cf2e7175`

Head: `f5a81e55600679a96b7faa1880eb94ae990d836f`

Verdict: **approved** for this complete 52-file candidate diff. No outstanding material security findings. This does not replace the lead's review of a later combined root head.

Forty-seven changed files exactly match blobs within previously approved diffs: Web Plan/TODO/material source, finite runner diagnostics, complete metrics candidate 35d7ac2, and feedback API/panel/CSS e9e4ade. The remaining five files were inspected directly: main CSS import, project tab/panel activation, root Playwright dispatch, isolated runner feedback scope and its real-browser script. The previously missing downstream observation fixture fix is present; the old 5ea candidate is superseded.

The feedback component is keyed to its project, active only on the selected project/tab, retains request-generation/session checks and uses the authenticated no-store read projection. The script signs in through the actual page, creates an engineering preparation project through the real form only when the isolated environment has no projects, enters the feedback tab and checks actual GET responses and UI. It aborts browser transport for a failure scenario, then removes the abort and verifies a successful fresh UI-triggered GET. It does not inject a report response or metric value. Screenshots mask password and report cards/details on both success and failure; raw assertion errors are omitted from failure artifacts. The owned runner does not start object storage for the sole feedback scope, and preserves existing browser admission and SQL-only separation/cleanup guards.

Independent full diff --check and exact runner JavaScript syntax checks passed. Source and contracts were reviewed without another browser run. Author reports product check/lint/build passed (three existing backend lint warnings), plus observation tests 12/12 after bringing in the approved fixture correction.

Read the author's explicitly designated safe evidence at `artifacts/acceptance/product/UX-FEEDBACK-WEB-isolated-20261004/project-feedback/result.json` and `cleanup.json` in the ux-web worktree: one project created through actual UI, source not_configured, zero metric rows, zero synthetic metrics, actual transport recovery, 980/700/390 viewport checks, no browser errors and owned services/container/temporary credentials cleaned. This flow is not wholly read-only: it creates that isolated project. `switchedProjectVerified=false`; multi-project switching was not exercised. Raw logs/screenshots/traces were not read.

Real metric/source reports, content attribution, nonempty metrics rendering, multi-project runtime isolation and effect evaluation remain unverified. Earlier direction/Plan actual model failures remain recorded; this feedback result does not establish a nonempty plan, unknown-request replay success, execution or publication.

## Subsequent exact source and actual Plan evidence

Full base remains `1bde61548310d741bddffca15161e2b2cf2e7175`; revised head **`80e871a5f1055aba747944869e88619cf8bfdab8`** is **approved**. Its only four-file delta after f5a81e5 exactly matches the separately reviewed direction adapter/test/Python prompt from `34aea3a0a688a8172128b8dfae4b097fcc43cbca` and PostgreSQL final-lock fixture from `259bdb62243b936d938c1229bdcbffc47d805dff`. Full scoped diff --check passed; no additional code difference was inferred from parent approval alone.

Read the designated safe JSONs under the ux-web worktree's `UX-PLAN-narrow-plan-retry5-20261004`: actual direction model proposal (12968ms), human confirmation and material candidate flow reached a real Plan outcome `unchanged`; current plan visible, one command receipt and revision 1, tasks/outbox zero, execution/publication false. Both Plan unknown-recovery and original-body/key-replay flags are explicitly false. The direction-specific lost-response replay result does not prove Plan replay. Read-only receipt evidence stores only hashes and fixed outcomes. The isolated services, two containers and temporary credentials were cleaned. These inputs are synthetic engineering UI inputs with the configured real model, not verified customer materials or real publication outcomes.

Author reports SQL-only Plan PostgreSQL 7/7 with actual final guard wait and the full product suites passing (contracts TS79/Python39, backend395, executor61, Web86). The SQL-only cleanup JSON was read and confirms its owned container/services/credentials cleaned; its raw test log was not read by the reviewer. This update does not establish nonempty scheduling, Plan unknown-result replay, live metrics, physical execution or publication.
