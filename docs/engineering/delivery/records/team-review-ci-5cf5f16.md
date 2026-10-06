# CI MinIO image reference review — 2026-10-04

- Reviewer: `/root/adversary`.
- Base: `73fdb43626b563f7896edcaf58cd8792435190ef`.
- Head: `5cf5f16cf5ba52c3cb807cef4b6177cb3ee4292f`.
- Verdict: **approved**, findings: none in this exact two-string change.

Workflow pull and isolated runner lookup now both use `minio/minio:RELEASE.2024-01-11T07-46-16Z` instead of the registry.hub.docker.com alias. No other candidate change was found; diff-check passed. Independently ran read-only Docker image inspection for both local references and each resolved to `sha256:f5d82361e10f3edd134431963a3082001f85f99613a345eb6756dd49dd9007e7`. Thus the local browser evidence uses the same installed image bytes. No new pull, container, service or browser run was performed by this reviewer.

Lead reports hosted run 37143377048 failed pulling the alias. That failure is retained; approval of this source correction does not turn it into a pass. Hosted execution of the corrected head remains unverified. This review grants no deployment, phone operation or publication permission.
