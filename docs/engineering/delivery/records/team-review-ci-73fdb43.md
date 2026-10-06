# CI identity environment independent review — 2026-10-04

- Reviewer: `/root/adversary`.
- Base: `b56429aa824f1d40709921d9ca5ed2a84cc067a1`.
- Head: `73fdb43626b563f7896edcaf58cd8792435190ef`.
- Verdict: **approved**, findings: none within the exact two-file delta.

The workflow now runs the existing isolated environment script for identity acceptance, replacing a Web-only preview that had no backend or login environment. The runner adds an explicit identity scope, a generated secondary password, and a preview mode that builds Web first. Both passwords are included in the existing redaction set. Tests still enter through root Playwright and exercise the UI; initialization only creates the temporary operator prerequisite and does not seed a successful tested business result.

Reviewed the full runner context: selected scopes are allowlisted; the new mode is allowlisted; the browser opt-in/refusal guard remains; identity scope does not select real files or Artemis; database/storage ports bind loopback and all service ports must be free; containers use exact returned IDs plus ownership labels for cleanup. Workflow permissions, action references and project versions do not change. Workflow image pulls are the same two image versions already used by the isolated runner. `browserAdmission` now records explicit opt-in rather than falsely asserting an IAB navigation occurred.

Independent exact-source `pnpm exec node --check` and delta `git diff --check` passed. Read only the local producer evidence JSON at `artifacts/acceptance/team-lead-20261004/ci-identity-local`: cleanup reports owned services exited, both owned container IDs removed and temporary credentials removed; all six supplemental business-fact counters are zero. These are inspected producer records, not an independent OS-level cleanup check.

Lead reports actual local built-preview root Playwright identity acceptance passed, including login, invitation lost-ACK replay/revocation, secondary operator creation/disable/session invalidation and last-admin protection. This reviewer did not rerun that browser suite. The previous hosted run's Playwright missing-login-environment failure remains failed evidence; the new head's hosted run is still unverified. No real phone, publication, live credentials, production database, provider message or deployment was touched by this review.
