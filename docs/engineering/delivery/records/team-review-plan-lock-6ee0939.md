# Independent Plan lock-wait fixture findings

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

Reviewer: `/root/adversary`

Base: `34aea3a0a688a8172128b8dfae4b097fcc43cbca`

Head: `6ee0939677d2e0b843e31bbff01e4bc4bddd4dcd`

Verdict: **changes_requested** for the one-file PostgreSQL test change; production logic is unchanged.

**PLAN-FIXTURE-CLEANUP-01 (P2): pending transaction rejection is not handled during lock observation and cleanup.** The test starts originalTx, whose lock timeout is five seconds, then polls for up to ten seconds before attaching an await to that promise. A delayed/failed observation can leave its rejection unhandled. If polling throws, catch releases the blocker but never awaits the transaction, so it can race later test cleanup. Attach a settlement handler immediately and, after releasing the blocker in all paths, await the pending transaction before completing or rethrowing. Preserve actual lock observation, PostgreSQL-clock cutoff and zero-persistence assertions.

Using the database clock and actual guard contention is a sound correction to the old host-clock/sleep fixture. Author typecheck/diff checks passed; the new PostgreSQL scenario has not run yet and is not marked passed.

## Fixed exact candidate

Base `34aea3a0a688a8172128b8dfae4b097fcc43cbca` → head **`259bdb62243b936d938c1229bdcbffc47d805dff`**: **approved** for the single test-file source change. PLAN-FIXTURE-CLEANUP-01 is resolved: the original transaction immediately becomes a handled settled outcome, BEGIN success marks the blocker transaction open, error paths roll it back and await the pending operation, and successful COMMIT is not followed by an erroneous rollback. An intermediate 0305994 version still marked the transaction only after acquiring the guard; that cleanup gap was corrected before this approval. The test requires actual guard wait observation, a produced model suggestion, second authenticated final transaction and zero persisted rows. Scoped diff --check passed; author TypeScript check passed. The new PostgreSQL test execution remains pending and is not claimed to have passed. No production checks or permissions changed.
