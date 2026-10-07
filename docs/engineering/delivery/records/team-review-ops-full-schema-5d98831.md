# Independent full-schema maintenance fixture review

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

Reviewer: `/root/adversary`

Base: `3e03cef493126db5eef698119262744caeb6f482`

Head: `5d98831962d53f78a280d343b2911934e74673ed`

Verdict: **approved** for the two-file maintenance test and evidence-document delta. No outstanding material security findings. This does not approve production recovery or any runtime permission change.

The fixture now enumerates the frozen tree's numbered SQL migrations, reads each byte buffer once, hashes and applies that same buffer, and compares the encrypted backup's manifest to the exact applied list. Independent verification matched all 33 documented names and SHA-256 values to the candidate Git source. The nine new Plan/metric table assertions compare source/restored column definitions and row counts; only the migration-owned guard singleton exists, and the other eight tables are empty. The document correctly limits this to schema/inventory recovery, not real business data recovery.

Existing disposable container identity/name/image/label/loopback/volume and PostgreSQL cluster checks remain in place. New dynamic table references come from a fixed internal list; values use parameters. Restore uses the captured archive in its owned empty target. Current authority differences, unknown control/object states and all permission flags remain closed. No production capture/restore code is changed.

Initial 369cac62 documentation had trailing whitespace on two lines despite an author working-tree diff-check claim. The final head changes only those lines; independent full-range diff --check now passes. Author reports the complete 33-migration PostgreSQL17.11/MinIO rehearsal 1/1 passed (35.0-second test), contracts build/generation and backend check passed after correcting initially absent built dependencies. The reviewer did not rerun the Docker rehearsal or inspect raw logs/private configuration.

Actual production key custody/storage/maintenance authorization, consumer stop/physical fence, populated latest-table business data recovery, RPO/RTO/capacity, formal deployment and operator acceptance remain unverified. The engineering fixture does not release holders or restart execution.
