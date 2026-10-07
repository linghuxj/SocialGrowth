# Independent current-check manifest revision 2 review

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

Reviewer: `/root/adversary`

Base: `fc28564fb6c324b63e13a87cf330a81a276922f2`

Head: `a18450b0c80f22f214b6d4856865f7c41cfd7f90`

Verdict: **approved**, findings: none remaining.

Scope is the five-file revision 2 increment: service material manifest projection, PostgreSQL/Nest HTTP assertions, shared schema/test and generated JSON. This review does not approve the complete parent tree or independently sign the original current-check/impact producers. Shared ledger records business-plan-current-checks-read rev2 and business-plan-task-impact-reference rev2 accepted by control, provider and backend.

The service resolves expected files from the task's exact immutable material revision and current files from the current validated material history. It projects only object ID, SHA-256, bytes and content type in deterministic object-ID order. Missing expected/current manifests add material_missing and current_fact_unknown; differing manifests add material_revision_changed. Existing operator authentication/session recheck, project scope, no-store route and literal false execution/publication permissions remain unchanged. There is no object locator, credential, execution command or mutation in the new projection.

The first candidate 72f7eef had one concrete contract inconsistency, **CURRENT-MANIFEST-01**: currentFiles=[] with only material_revision_changed/action_inspector_unavailable was accepted without missing/unknown blockers. An independent exact-source probe reproduced that acceptance. The final candidate treats null and empty current manifests consistently and adds the rejection regression. The targeted exact-source contract test now passes (1 test with positive/negative cases). Source/diff-check passed. A parsed structural comparison of generated JSON shows only the expectedFiles/currentFiles properties and required entries added to the standalone task and nested response task schemas; no unrelated authority/schema changes were included.

Author evidence: isolated PostgreSQL 17.11 suite 7/7 including actual Nest HTTP authenticated GET 200/no-store, missing cookie 401, historical and current material projections after source mutations. The schema-only fix was followed by contracts 77/77, Python 39/39, contracts build/generation, backend type-check and diff-check. The earlier lint run had three pre-existing warnings. The reviewer did not run the database or HTTP fixture; inspected source and ran the focused exact-source schema test independently. No browser, phone, physical stop, BE-EXEC, execution or publication acceptance is implied.
