# Provider rename follow-up review — 2026-10-04

- Reviewer: `/root/adversary`.
- Base: `b56429aa824f1d40709921d9ca5ed2a84cc067a1`.
- Head: `49c8b16283df4eefcd5cea83d2a3cb327582b80b`.
- Verdict: **approved** within the candidate engineering scope; open findings: none.

PROVIDER-LABEL-01 is fixed: the normalized URL device ID is part of the request digest, and current association ownership is locked/verified before a cached response can be disclosed. Same-target retries still return the original receipt without reapplying the rename. Added regressions cover identical key/body for another currently owned device and a replay after association end.

PROVIDER-LABEL-02 is fixed: the controller forwards the actual token, and the write transaction calls existing authenticateSessionInTransaction before ownership, cache access or mutation. Provider/session protection remains held through commit. The regression explicitly waits until rename is blocked on a concurrent session revocation, commits the revocation, and asserts AUTHENTICATION_REQUIRED and unchanged device facts.

The new controller is now imported and registered in AppModule. Reviewed that minimal wiring plus added isolated Nest HTTP/PG coverage and original assistance projection. Existing accepted provider-assistance-device-label revision 1 and DTOs are unchanged. No unsafe execution, credential exposure or new provider-to-provider visibility was found in the reviewed delta.

Independent original focused contract tests passed 8/8; the unchanged contract code retains that evidence. Independent full follow-up source/diff review and full-range diff-check passed. Producer reports backend check, controller4/4, identityPG2/2, feedPG1/1, isolated NestHTTP/PG1/1, contract71/Python39 and generated checks passed; these new broad runs were not independently repeated. Oxlint hangs remain **unverified**, not passed.

This is source and isolated engineering approval. Real Web/native flows, real device usage and full-product acceptance remain unverified. No live phone, production database, provider message, public publication or deployment occurred in this review. The previous findings report remains preserved.
