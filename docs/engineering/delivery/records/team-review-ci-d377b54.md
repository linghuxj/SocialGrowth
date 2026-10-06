# Identity-only CI dependency review — 2026-10-04

- Reviewer: `/root/adversary`.
- Base: `5cf5f16cf5ba52c3cb807cef4b6177cb3ee4292f`.
- Head: `d377b5443d45e8dddbc8d8197ee8905c530e8060`.
- Verdict: **approved**, findings: none in the exact two-file delta.

Only the exact scope list [identity] omits the unused MinIO dependency. That path explicitly marks material mode unavailable, adds no S3 credential/environment fields and skips bucket creation. Mixed identity/material and every other previously supported scope still require the real isolated storage path. Workflow identity job therefore no longer pulls MinIO. This does not alter production S3 or turn missing material storage into candidate eligibility.

The runner now gives PostgreSQL readiness a 60-second wall-clock budget and a two-second connection timeout; other readiness calls retain 20 seconds. Failed checks still throw. Safe container metadata is saved before readiness for diagnosis. Existing loopback isolation, explicit browser opt-in, root Playwright invocation and owned-resource cleanup remain unchanged.

Independent exact-source Node syntax check and diff-check passed. Read the producer retry JSON: preview mode, storageConfigured false, one owned PostgreSQL container reported removed, owned services exited and temporary credentials removed, with all six business-fact counters zero. These are inspected producer records, not a new independent browser or OS-cleanup run.

The lead's successful local identity browser retry is bounded to that UI flow. Prior PG-readiness and hosted image-pull failures remain recorded. The earlier review's local identical-image observation never proved fresh hosted registry availability; the hosted failures correctly supersede that assumption for CI. New-head hosted CI remains unverified. No phone action, publication or deployment is covered by this approval.
