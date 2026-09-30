import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { checkSeriesDependency, ContentQuotaError, parseContentQuota, reserveContentQuota, type ContentQuotaSnapshot } from "./content-quota-core.js";
const code = (c: string) => (e: unknown) => e instanceof ContentQuotaError && e.code === c;
function fixture() {
  const projectId = randomUUID(), other = randomUUID(), seriesId = randomUUID();
  const s: ContentQuotaSnapshot = { units: [1, 2].map(episodeNumber => ({ contentUnitId: randomUUID(), projectId, mediaKind: "video", seriesId, episodeNumber })), variants: [],
    identities: [{ identityId: randomUUID(), projectId, platform: "facebook" }, { identityId: randomUUID(), projectId, platform: "facebook" },
      { identityId: randomUUID(), projectId, platform: "youtube" }, { identityId: randomUUID(), projectId: other, platform: "youtube" }], slots: [], seriesBindings: [] };
  s.variants = s.units.flatMap(u => [1, 2].map(() => ({ variantId: randomUUID(), contentUnitId: u.contentUnitId })));
  const r = { contentUnitId: s.units[0].contentUnitId, platform: "facebook" as const, identityId: s.identities[0].identityId, variantId: s.variants[0].variantId, taskId: randomUUID() };
  return { s, r };
}
test("content language versions share one platform quota, input stays unchanged, no execution grant", () => {
  const { s, r } = fixture(), before = structuredClone(s), first = reserveContentQuota(s, r);
  assert.deepEqual(s, before); assert.equal(first.changed, true); assert.equal(first.snapshot.slots[0].state, "reserved");
  assert.throws(() => reserveContentQuota(first.snapshot, { ...r, taskId: randomUUID(), variantId: s.variants[1].variantId }), code("CONTENT_QUOTA_OCCUPIED"));
  assert.throws(() => reserveContentQuota(first.snapshot, { ...r, identityId: s.identities[1].identityId }), code("CONTENT_QUOTA_OCCUPIED"));
});
test("FB and YT quotas are independent, YT form switching cannot gain another quota", () => {
  const { s, r } = fixture(), fb = reserveContentQuota(s, r).snapshot;
  const yt = { ...r, platform: "youtube" as const, identityId: s.identities[2].identityId, variantId: s.variants[1].variantId, taskId: randomUUID() };
  const both = reserveContentQuota(fb, yt).snapshot; assert.equal(both.slots.length, 2);
  assert.throws(() => reserveContentQuota(both, { ...yt, taskId: randomUUID(), variantId: s.variants[0].variantId }), code("CONTENT_QUOTA_OCCUPIED"));
  assert.throws(() => reserveContentQuota(fb, { ...yt, form: "shorts" }), code("INPUT_INVALID"));
});
test("same reservation is a no-op even after unknown or verified publication, never grants repeat submission", () => {
  const { s, r } = fixture();
  for (const state of ["reserved", "submission_unknown", "published_verified"] as const) {
    const first = reserveContentQuota(s, r).snapshot; first.slots[0].state = state; first.slots[0].evidenceId = state === "published_verified" ? randomUUID() : null;
    assert.equal(reserveContentQuota(first, r).changed, false);
    assert.throws(() => reserveContentQuota(first, { ...r, taskId: randomUUID() }), code("CONTENT_QUOTA_OCCUPIED"));
  }
});
test("series identity is fixed per platform, future episode planning does not bypass execution dependency", () => {
  const { s, r } = fixture(), first = reserveContentQuota(s, r).snapshot;
  const episode2 = { ...r, contentUnitId: s.units[1].contentUnitId, variantId: s.variants[2].variantId, taskId: randomUUID() };
  assert.throws(() => reserveContentQuota(first, { ...episode2, identityId: s.identities[1].identityId }), code("SERIES_IDENTITY_CONFLICT"));
  const next = reserveContentQuota(first, episode2).snapshot;
  assert.throws(() => checkSeriesDependency(next, episode2), code("DEPENDENCY_REQUIRED"));
  next.slots[0].state = "submission_unknown"; assert.throws(() => checkSeriesDependency(next, episode2), code("DEPENDENCY_REQUIRED"));
  next.slots[0].state = "published_verified"; next.slots[0].evidenceId = randomUUID(); checkSeriesDependency(next, episode2);
  assert.equal(next.slots[1].state, "reserved");
});
test("one platform progress does not unblock a serial dependency on the other", () => {
  const { s, r } = fixture(), fb = reserveContentQuota(s, r).snapshot; fb.slots[0].state = "published_verified"; fb.slots[0].evidenceId = randomUUID();
  const yt = { ...r, contentUnitId: s.units[1].contentUnitId, variantId: s.variants[2].variantId, platform: "youtube" as const, identityId: s.identities[2].identityId, taskId: randomUUID() };
  assert.throws(() => checkSeriesDependency(reserveContentQuota(fb, yt).snapshot, yt), code("DEPENDENCY_REQUIRED"));
});
test("missing predecessor is blocked, standalone promotions are not falsely constrained to a series", () => {
  const { s, r } = fixture(); s.units[0].episodeNumber = 7;
  const reserved = reserveContentQuota(s, r).snapshot; assert.throws(() => checkSeriesDependency(reserved, r), code("DEPENDENCY_REQUIRED"));
  s.units[0].seriesId = null; s.units[0].episodeNumber = null;
  checkSeriesDependency(reserveContentQuota(s, r).snapshot, r);
});
test("cross-project, wrong platform, unknown variant, reused task and image-text on YT fail closed", () => {
  const { s, r } = fixture();
  for (const patch of [{ identityId: s.identities[3].identityId, platform: "youtube" }, { identityId: s.identities[2].identityId }, { variantId: s.variants[2].variantId }, { variantId: randomUUID() }, { approved: true }]) assert.throws(() => reserveContentQuota(s, { ...r, ...patch }), code("INPUT_INVALID"));
  const first = reserveContentQuota(s, r).snapshot;
  assert.throws(() => reserveContentQuota(first, { ...r, contentUnitId: s.units[1].contentUnitId, variantId: s.variants[2].variantId }), code("CONTENT_QUOTA_OCCUPIED"));
  s.units[0].seriesId = null; s.units[0].episodeNumber = null; s.units[0].mediaKind = "image_text";
  assert.throws(() => reserveContentQuota(s, { ...r, platform: "youtube", identityId: s.identities[2].identityId }), code("INPUT_INVALID"));
});
test("UUID normalization precedes grouping and matching; duplicate registry and conflicting evidence are corruption", () => {
  const { s, r } = fixture(); assert.equal(reserveContentQuota(s, { ...r, contentUnitId: r.contentUnitId.toUpperCase(), taskId: r.taskId.toUpperCase() }).snapshot.slots[0].taskId, r.taskId);
  const duplicate = structuredClone(s); duplicate.units.push({ ...s.units[0], contentUnitId: s.units[0].contentUnitId.toUpperCase() }); assert.throws(() => parseContentQuota(duplicate), code("CORRUPT_FACTS"));
  const first = reserveContentQuota(s, r).snapshot; first.slots[0].state = "published_verified"; assert.throws(() => parseContentQuota(first), code("CORRUPT_FACTS"));
});
test("corrupted series, mixed project or extra permission field cannot be laundered into trusted facts", () => {
  const { s, r } = fixture();
  const cases = [() => { const x = structuredClone(s); x.units[1].projectId = randomUUID(); return x; },
    () => { const x = structuredClone(s); x.units[0].episodeNumber = null; return x; },
    () => { const x = reserveContentQuota(s, r).snapshot; x.seriesBindings[0].identityId = s.identities[1].identityId; return x; },
    () => ({ ...s, permissionGranted: true }), () => { const x = structuredClone(s); x.variants[0].contentUnitId = randomUUID(); return x; }];
  for (const make of cases) assert.throws(() => parseContentQuota(make()), code("CORRUPT_FACTS"));
});
