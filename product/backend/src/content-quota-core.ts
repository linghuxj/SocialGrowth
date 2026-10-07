import { z } from "zod";
import { uuidSchema } from "@socialgrowth/product-contracts";
const id = uuidSchema.transform(s => s.toLowerCase());
const platform = z.enum(["facebook", "youtube"]);
const unit = z.strictObject({ contentUnitId: id, projectId: id, mediaKind: z.enum(["video", "image_text"]),
  seriesId: id.nullable(), episodeNumber: z.int().min(1).nullable() });
const variant = z.strictObject({ variantId: id, contentUnitId: id });
const identity = z.strictObject({ identityId: id, platform, projectId: id });
const slot = z.strictObject({ contentUnitId: id, platform, variantId: id, identityId: id, taskId: id,
  state: z.enum(["reserved", "submission_unknown", "published_verified"]), evidenceId: id.nullable() });
const binding = z.strictObject({ seriesId: id, platform, identityId: id, projectId: id });
const snapshotSchema = z.strictObject({ units: z.array(unit), variants: z.array(variant), identities: z.array(identity), slots: z.array(slot), seriesBindings: z.array(binding) });
export type ContentQuotaSnapshot = z.infer<typeof snapshotSchema>;
export class ContentQuotaError extends Error {
  constructor(readonly code: "INPUT_INVALID" | "CORRUPT_FACTS" | "CONTENT_QUOTA_OCCUPIED" | "SERIES_IDENTITY_CONFLICT" | "DEPENDENCY_REQUIRED") { super(code); }
}
function fail(code: ContentQuotaError["code"]): never { throw new ContentQuotaError(code); }
const unique = <T>(items: T[], key: (item: T) => string) => { if (new Set(items.map(key)).size !== items.length) fail("CORRUPT_FACTS"); };
export function parseContentQuota(input: unknown): ContentQuotaSnapshot {
  const parsed = snapshotSchema.safeParse(input); if (!parsed.success) return fail("CORRUPT_FACTS");
  const s = parsed.data;
  unique(s.units, u => u.contentUnitId); unique(s.variants, v => v.variantId); unique(s.identities, i => i.identityId);
  unique(s.slots, v => `${v.contentUnitId}/${v.platform}`); unique(s.slots, v => v.taskId);
  unique(s.seriesBindings, v => `${v.seriesId}/${v.platform}`);
  unique(s.units.filter(u => u.seriesId !== null), u => `${u.seriesId}/${u.episodeNumber}`);
  for (const u of s.units) {
    if ((u.seriesId === null) !== (u.episodeNumber === null) || (u.seriesId !== null && u.mediaKind !== "video")) fail("CORRUPT_FACTS");
    if (u.seriesId !== null && s.units.some(other => other.seriesId === u.seriesId && other.projectId !== u.projectId)) fail("CORRUPT_FACTS");
  }
  for (const v of s.variants) if (!s.units.some(u => u.contentUnitId === v.contentUnitId)) fail("CORRUPT_FACTS");
  for (const b of s.seriesBindings) {
    if (!s.units.some(u => u.seriesId === b.seriesId && u.projectId === b.projectId)
      || !s.identities.some(i => i.identityId === b.identityId && i.platform === b.platform && i.projectId === b.projectId)) fail("CORRUPT_FACTS");
  }
  for (const q of s.slots) {
    const u = s.units.find(v => v.contentUnitId === q.contentUnitId), i = s.identities.find(v => v.identityId === q.identityId);
    if (!u || !i || i.projectId !== u.projectId || i.platform !== q.platform || (u.mediaKind === "image_text" && q.platform !== "facebook")
      || !s.variants.some(v => v.variantId === q.variantId && v.contentUnitId === u.contentUnitId)
      || (q.state === "published_verified") !== (q.evidenceId !== null)) fail("CORRUPT_FACTS");
    if (u.seriesId !== null && !s.seriesBindings.some(b => b.seriesId === u.seriesId && b.platform === q.platform && b.identityId === q.identityId && b.projectId === u.projectId)) fail("CORRUPT_FACTS");
  }
  return s;
}
const request = z.strictObject({ contentUnitId: id, platform, variantId: id, identityId: id, taskId: id });
// Internal invariant ONLY, not eligibility, approval, file readiness or action
// permission. Human content grouping must be centrally verified before use.
export function reserveContentQuota(snapshot: unknown, input: unknown): { snapshot: ContentQuotaSnapshot; changed: boolean } {
  const s = parseContentQuota(snapshot), result = request.safeParse(input); if (!result.success) return fail("INPUT_INVALID");
  const r = result.data, u = s.units.find(v => v.contentUnitId === r.contentUnitId), i = s.identities.find(v => v.identityId === r.identityId);
  if (!u || !i || i.projectId !== u.projectId || i.platform !== r.platform || (u.mediaKind === "image_text" && r.platform !== "facebook")
    || !s.variants.some(v => v.variantId === r.variantId && v.contentUnitId === r.contentUnitId)) return fail("INPUT_INVALID");
  const current = s.slots.find(q => q.contentUnitId === r.contentUnitId && q.platform === r.platform);
  if (current) {
    if (current.taskId !== r.taskId || current.variantId !== r.variantId || current.identityId !== r.identityId) return fail("CONTENT_QUOTA_OCCUPIED");
    return { snapshot: s, changed: false }; // Never grants a repeat publication.
  }
  if (s.slots.some(q => q.taskId === r.taskId)) return fail("CONTENT_QUOTA_OCCUPIED");
  if (u.seriesId !== null) {
    const old = s.seriesBindings.find(b => b.seriesId === u.seriesId && b.platform === r.platform);
    if (old && old.identityId !== r.identityId) return fail("SERIES_IDENTITY_CONFLICT");
    if (!old) s.seriesBindings.push({ seriesId: u.seriesId, platform: r.platform, identityId: r.identityId, projectId: u.projectId });
  }
  s.slots.push({ ...r, state: "reserved", evidenceId: null });
  return { snapshot: parseContentQuota(s), changed: true };
}
// Only inspects dependency facts. Does not change reserved/unknown/published,
// consume an action permit or imply physical execution can start.
export function checkSeriesDependency(snapshot: unknown, input: unknown): void {
  const s = parseContentQuota(snapshot), r = request.safeParse(input); if (!r.success) return fail("INPUT_INVALID");
  const q = s.slots.find(v => v.contentUnitId === r.data.contentUnitId && v.platform === r.data.platform
    && v.taskId === r.data.taskId && v.variantId === r.data.variantId && v.identityId === r.data.identityId);
  if (!q) return fail("INPUT_INVALID");
  const u = s.units.find(v => v.contentUnitId === q.contentUnitId)!;
  if (u.seriesId !== null && u.episodeNumber! > 1) {
    const previous = s.units.find(v => v.seriesId === u.seriesId && v.episodeNumber === u.episodeNumber! - 1);
    if (!previous || !s.slots.some(v => v.contentUnitId === previous.contentUnitId && v.platform === q.platform && v.identityId === q.identityId && v.state === "published_verified" && v.evidenceId !== null)) fail("DEPENDENCY_REQUIRED");
  }
}
