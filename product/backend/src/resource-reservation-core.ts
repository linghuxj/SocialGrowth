import { z } from "zod";
import { uuidSchema } from "@socialgrowth/product-contracts";

const platform = z.enum(["facebook", "youtube"]);
const id = uuidSchema.transform(value => value.toLowerCase());
const account = z.strictObject({ accountId: id, platform });
const identity = z.strictObject({ identityId: id, accountId: id, platform });
const phone = z.strictObject({ deviceId: id, projectId: id });
const accountUse = z.strictObject({ accountId: id, projectId: id });
const binding = z.strictObject({ identityId: id, accountId: id, platform, deviceId: id, projectId: id, state: z.literal("pending_initialization") });
const snapshotSchema = z.strictObject({ accounts: z.array(account), identities: z.array(identity),
  phones: z.array(phone), accountUses: z.array(accountUse), bindings: z.array(binding) });
export const initialReservationSchema = z.strictObject({ projectId: id, deviceId: id,
  identityIds: z.array(id).min(1).max(2) });
export type ResourceReservationSnapshot = z.infer<typeof snapshotSchema>;
export type InitialResourceReservation = z.infer<typeof initialReservationSchema>;
export class ResourceReservationError extends Error {
  constructor(readonly code: "INVALID_RESOURCE_FACTS" | "RESOURCE_CONFLICT" | "HANDOVER_REQUIRED") {
    super(`Resource reservation rejected: ${code}`);
  }
}
function invalid(): never { throw new ResourceReservationError("INVALID_RESOURCE_FACTS"); }
function unique<T>(values: T[], key: (value: T) => string): void {
  if (new Set(values.map(key)).size !== values.length) invalid();
}
export function parseResourceReservations(input: unknown): ResourceReservationSnapshot {
  const parsed = snapshotSchema.safeParse(input); if (!parsed.success) invalid();
  const s = parsed.data;
  unique(s.accounts, r => r.accountId); unique(s.identities, r => r.identityId);
  unique(s.phones, r => r.deviceId); unique(s.accountUses, r => r.accountId);
  unique(s.bindings, r => r.identityId); unique(s.bindings, r => `${r.deviceId}:${r.platform}`);
  for (const i of s.identities) if (!s.accounts.some(a => a.accountId === i.accountId && a.platform === i.platform)) invalid();
  for (const a of s.accountUses) if (!s.accounts.some(r => r.accountId === a.accountId)) invalid();
  for (const b of s.bindings) {
    if (!s.identities.some(i => i.identityId === b.identityId && i.accountId === b.accountId && i.platform === b.platform)
      || !s.phones.some(p => p.deviceId === b.deviceId && p.projectId === b.projectId)
      || !s.accountUses.some(a => a.accountId === b.accountId && a.projectId === b.projectId)) invalid();
  }
  return s;
}
// Only an INITIAL reservation of centrally registered IDs. Never an execution
// permission, platform identity verification, acceptance/commission start, or
// transfer. The authority producer and WP-13/21 handover are separate boundaries.
export function reserveInitialResources(input: unknown, request: unknown): { snapshot: ResourceReservationSnapshot; changed: boolean } {
  const s = parseResourceReservations(input), parsed = initialReservationSchema.safeParse(request);
  if (!parsed.success) invalid(); const r = parsed.data;
  unique(r.identityIds, id => id);
  const identities = r.identityIds.map(id => { const i = s.identities.find(i => i.identityId === id); if (!i) invalid(); return i; });
  if (new Set(identities.map(i => i.platform)).size !== identities.length) throw new ResourceReservationError("RESOURCE_CONFLICT");
  if (s.phones.some(p => p.deviceId === r.deviceId && p.projectId !== r.projectId)) throw new ResourceReservationError("HANDOVER_REQUIRED");
  for (const i of identities) {
    if (s.accountUses.some(a => a.accountId === i.accountId && a.projectId !== r.projectId)) throw new ResourceReservationError("HANDOVER_REQUIRED");
    if (s.bindings.some(b => b.identityId === i.identityId && (b.deviceId !== r.deviceId || b.projectId !== r.projectId))) throw new ResourceReservationError("HANDOVER_REQUIRED");
    if (s.bindings.some(b => b.deviceId === r.deviceId && b.platform === i.platform && b.identityId !== i.identityId)) throw new ResourceReservationError("HANDOVER_REQUIRED");
  }
  let changed = false;
  if (!s.phones.some(p => p.deviceId === r.deviceId)) { s.phones.push({ deviceId: r.deviceId, projectId: r.projectId }); changed = true; }
  for (const i of identities) {
    if (!s.accountUses.some(a => a.accountId === i.accountId)) { s.accountUses.push({ accountId: i.accountId, projectId: r.projectId }); changed = true; }
    if (!s.bindings.some(b => b.identityId === i.identityId)) {
      s.bindings.push({ ...i, deviceId: r.deviceId, projectId: r.projectId, state: "pending_initialization" }); changed = true;
    }
  }
  return { snapshot: parseResourceReservations(s), changed };
}
