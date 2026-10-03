# BE-OPS full-migration recovery rehearsal supplement

This note records the supplemental full-migration diagnostic run for the BE-OPS maintenance slice. It is authored on the `codex/team-backend-ops` worktree. It does not change the frozen implementation candidate `353889c9094e8efa08f34059885892a8a2567520` and does not expand the default coverage of `database-maintenance-recovery.pg-test.ts`.

## Scope distinction

At the frozen candidate, the committed joint fixture at `product/backend/src/database-maintenance-recovery.pg-test.ts` applies exactly seven prerequisite migrations and then creates a test-only identity fixture table. It is a synthetic prerequisite-schema rehearsal. It is not a full-schema test by default.

The supplemental run copied that exact fixture from the frozen commit into an adjacent temporary test file and changed only the migration selector. The temporary copy selected every sorted `NNNN_*.sql` file under `product/backend/migrations` (30 files); all remaining fixture behavior was unchanged. It then performed the same isolated PostgreSQL 17 + MinIO capture, post-backup revocation and exact owned-object deletion, restore into the empty target database, and fail-closed assertions. The temporary file was removed after the run. No source change was made to commit `353889c`.

This proves an engineering rehearsal against the 30 migration files present in that candidate. It does not prove production disaster recovery, production data consistency, RPO/RTO, or actual consumer/physical-executor stop.

## Reproduction

Run from the candidate repository root. This reproduces the temporary-copy transformation and test command; it does not change the tracked fixture:

```sh
set -eu
repo="$(pwd)"
source="$repo/product/backend/src/database-maintenance-recovery.pg-test.ts"
temporary="$repo/product/backend/src/database-maintenance-recovery.full-schema.pg-test.ts"
trap 'rm -f "$temporary"' EXIT HUP INT TERM

git show 353889c9094e8efa08f34059885892a8a2567520:product/backend/src/database-maintenance-recovery.pg-test.ts > "$temporary"
python3 - "$temporary" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
old = '''  const requiredMigrations = new Set(["0001_identity_and_device.sql", "0006_phone_control_journal.sql", "0008_project_basics.sql", "0019_material_registry.sql", "0021_task_recheck_outbox.sql", "0029_phone_holder_grants.sql", "0030_local_participation.sql"]);
  const migrationDir = new URL("../migrations/", import.meta.url), available = (await readdir(migrationDir)).filter(name => /^\\d{4}_[a-z0-9_]+\\.sql$/.test(name));
  assert.ok([...requiredMigrations].every(name => available.includes(name)), "all exact prerequisite migrations must exist");
  const names = available.filter(name => requiredMigrations.has(name)).sort();'''
new = '''  const migrationDir = new URL("../migrations/", import.meta.url), available = (await readdir(migrationDir)).filter(name => /^\\d{4}_[a-z0-9_]+\\.sql$/.test(name));
  const names = [...available].sort();
  assert.equal(names.length, 30, "the supplemental candidate contains all 30 numbered migrations");'''
if text.count(old) != 1:
    raise SystemExit("expected exact prerequisite selector once; refusing to modify the temporary fixture")
path.write_text(text.replace(old, new, 1))
PY

pnpm --filter @socialgrowth/product-backend exec tsx --test --test-concurrency=1 src/database-maintenance-recovery.full-schema.pg-test.ts
rm -f "$temporary"
trap - EXIT HUP INT TERM
test ! -e "$temporary"
```

The selector transformation is intentionally limited to the temporary file. The test computes each selected migration's SHA-256 for backup metadata and applies the SQL in sorted filename order. The run uses the fixture's existing guardrails: uniquely named `--rm` PostgreSQL and MinIO containers, per-run label, loopback-only ephemeral ports, fixture-owned database/volume checks, synthetic credentials held only in process memory, an exact temporary encrypted backup directory, and cleanup assertions in the test's `after` hook.

## Exact migration set

Sorted from `product/backend/migrations` at candidate `353889c`:

```text
0001_identity_and_device.sql
0002_provider_phone_auth.sql
0003_provider_auth_recovery.sql
0004_installation_bootstrap_admission.sql
0005_network_admission.sql
0006_phone_control_journal.sql
0007_task_recovery_budget.sql
0008_project_basics.sql
0009_resource_reservations.sql
0010_project_planning_drafts.sql
0011_unassigned_device_todos.sql
0012_device_assistance_feed_index.sql
0013_device_assistance_notes_index.sql
0014_tracking_link_requests.sql
0015_endpoint_report_journal.sql
0016_connection_maintenance_budget.sql
0017_joint_recovery_reservations.sql
0018_commission_income_journal.sql
0019_material_registry.sql
0020_material_upload_tickets.sql
0021_task_recheck_outbox.sql
0022_media_registry_commands.sql
0023_media_credentials.sql
0024_project_direction.sql
0025_artemis_preflight_journal.sql
0026_account_preparation_tasks.sql
0027_artemis_preparation_journal.sql
0028_preparation_execution_reviews.sql
0029_phone_holder_grants.sql
0030_local_participation.sql
```

## Recorded result and cleanup evidence

The shared `BE-OPS-WIRING` task record reported this exact diagnostic as **1 passed, 0 failed, 67.54 seconds**, with the temporary copy removed, source SHA unchanged, and owned containers/temporary directories cleaned. The durable result entry is in the shared `tasks.json` ledger beside the common Git directory, under `tasks[].id == "BE-OPS-WIRING"`; read it via `python3 /Users/linghuxj/Documents/myproject/project/SocialGrowth/scripts/team-tasks.py read`. The original runner stdout was not separately persisted as a log artifact, so this note does not present a fabricated raw TAP transcript.

Cleanup implementation/evidence paths in the frozen candidate:

- Temporary test path: `product/backend/src/database-maintenance-recovery.full-schema.pg-test.ts`; it was removed after the supplemental run and is absent from the worktree when this note was prepared.
- Encrypted fixture directory: created by `mkdtemp(join(tmpdir(), \`sg-maintenance-${runId}-\`))`, realpathed before use, and removed in the `after` hook after verifying only the expected encrypted backup file could remain. That file is unlinked and the directory removed.
- PostgreSQL and MinIO containers: unique `sg-maint-pg-<run>` / `sg-maint-s3-<run>` names, exact self-created container IDs, run label, image, loopback port and volume ownership are rechecked before `docker stop`; both were started with `--rm`, and the hook asserts the IDs are absent after stop.
- Post-run workspace check: `git status --short` was empty at frozen HEAD `353889c`; `docker ps --filter name=sg-maint-` returned no owned fixture container. The tracked candidate tree remained at the same SHA.

## Boundaries retained

The sample shows restored identity behavior by inserting the next fixture row and observing ID `2`; inventory comparison does not compare PostgreSQL identity sequence runtime `last_value`/`is_called`. Deleted-object verification remains conservatively `objectUnverified` because the existing adapter does not distinguish 404 from storage unavailability. Consumer stop and physical executor fencing remain `unknown`; execution, publication, and holder-release flags remain `false`.
