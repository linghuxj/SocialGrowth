# Maintenance restore cumulative candidate security review

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

- Reviewer: `/root/adversary`
- Base: `6136984de4b325644d35d5850687ec4fa8527ac5`
- Head: `353889c9094e8efa08f34059885892a8a2567520`
- Verdict: **approved** for this bounded engineering candidate; no outstanding material finding in the reviewed scope.
- Scope: maintenance capture/inspection module, inventory identity-sequence support, isolated prerequisite-migration PG/MinIO test, deployment boundary documentation. No cross-module contract or runtime/production entry point added.

## Independent evidence

The capture/inspection implementation is byte-identical to approved `3d67d5035964492c58da67dae965c2de3df48210`; OPS-CAPTURE-01 and OPS-SNAPSHOT-02 remain resolved. Capture snapshots metadata/key before its first await and zeroes the private key copy; UNKNOWN retains the original authenticated backup identity/envelope. Restore facts and inventory share the same read-only transaction. No consumer resume, grant, holder release or publication is enabled.

Reviewed the complete added fixture and sequence diff, plus final `da4eb79` to `353889c` delta. Inventory now hashes sequence definition and same-schema internal identity ownership by schema/table/column. Unowned, non-identity or cross-schema sequences remain rejected. Earlier review concern about unbound ownership is resolved. `last_value/is_called` remain outside schema/row comparison; README states this explicitly. `databaseMatchesBackup` does not prove sequence runtime equality or safe resumption.

Fixture mutations target newly created random-label loopback containers, validate IDs/names/images/ports/exclusive anonymous volumes, and confirm database/cluster identity before capture/restore. It creates its own bucket and encrypted temporary backup directory. SQL restore receives only the captured synthetic dump; keys and opened dump buffers are cleared; cleanup checks ownership before removing its resources. The test has no production configuration or real credentials and does not log these generated credentials. Review did not run Docker, database restore, object deletion or device actions.

`git diff --check` passed for the exact cumulative four-file scope. Prior approved module provenance and all final changed files were independently inspected. Author reports final backend check/lint (two pre-existing custodian warnings), joint fixture 1 pass/0 fail, and owned container/temp-file cleanup. These runtime results are author evidence, not a second reviewer execution.

## Acceptance limits retained

The fixture uses migrations 0001/0006/0008/0019/0021/0029/0030 and a test-only identity table, not all 30 product migrations or a complete production schema. Synthetic rows demonstrate old restored authority versus later source changes, persistent unknown holder/pending outbox and default-closed flags; they do not prove live producer semantics or actual physical stop. The isolated identity sample restores next value 2, not general sequence-state detection. The S3 adapter reports unavailable for deleted-object reads; independent owned-bucket DELETE acknowledgement is fixture evidence only, while inspection accurately reports the object unverified.

Consumer stop and physical fence remain unknown; execution/publication/holder-release remain false. Full-schema restore, production RPO/RTO, private key operations, failure-path cleanup completeness, real Web/native/device and publication acceptance remain unverified. No original parent gate or existing unresolved security issue is cleared by this approval.
