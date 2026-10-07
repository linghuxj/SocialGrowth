import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { parseResourceReservations, reserveInitialResources, ResourceReservationError, type ResourceReservationSnapshot } from "./resource-reservation-core.js";
const ids = { accountFB: randomUUID(), accountYT: randomUUID(), fb: randomUUID(), yt: randomUUID(), fb2: randomUUID(), phone: randomUUID(), phone2: randomUUID(), project: randomUUID(), project2: randomUUID() };
function empty(): ResourceReservationSnapshot { return { accounts: [{ accountId: ids.accountFB, platform: "facebook" }, { accountId: ids.accountYT, platform: "youtube" }], identities: [
  { identityId: ids.fb, accountId: ids.accountFB, platform: "facebook" }, { identityId: ids.fb2, accountId: ids.accountFB, platform: "facebook" }, { identityId: ids.yt, accountId: ids.accountYT, platform: "youtube" }], phones: [], accountUses: [], bindings: [] }; }
const request = (identityIds: string[] = [ids.fb]) => ({ projectId: ids.project, deviceId: ids.phone, identityIds });
const rejected = (code: string) => (error: unknown) => error instanceof ResourceReservationError && error.code === code;
const assigned = () => reserveInitialResources(empty(), request()).snapshot;
test("one platform can be reserved alone; input is not mutated or promoted to execution/acceptance", () => {
  const s = empty(), copy = structuredClone(s), next = reserveInitialResources(s, request());
  assert.deepEqual(s, copy); assert.equal(next.changed, true); assert.equal(next.snapshot.bindings.length, 1);
  assert.equal(next.snapshot.bindings[0]!.state, "pending_initialization");
  assert.equal("ready" in next.snapshot.bindings[0]!, false); assert.equal("acceptanceStartedAt" in next.snapshot.bindings[0]!, false);
});
test("FB and YT can share one phone ONLY within the same project", () => {
  const next = reserveInitialResources(assigned(), request([ids.yt]));
  assert.equal(next.snapshot.phones.length, 1); assert.equal(next.snapshot.bindings.length, 2);
  assert.ok(next.snapshot.bindings.every(b => b.projectId === ids.project));
  assert.throws(() => reserveInitialResources(assigned(), { ...request([ids.yt]), projectId: ids.project2 }), rejected("HANDOVER_REQUIRED"));
});
test("one publishing identity cannot reserve two current phones even in the same project", () => {
  assert.throws(() => reserveInitialResources(assigned(), { ...request(), deviceId: ids.phone2 }), rejected("HANDOVER_REQUIRED"));
});
test("a phone cannot rotate same-platform identities by a new allocation request", () => {
  assert.throws(() => reserveInitialResources(assigned(), request([ids.fb2])), rejected("HANDOVER_REQUIRED"));
});
test("a login account cannot serve two projects through different Page IDs", () => {
  assert.throws(() => reserveInitialResources(assigned(), { ...request([ids.fb2]), projectId: ids.project2, deviceId: ids.phone2 }), rejected("HANDOVER_REQUIRED"));
});
test("multiple distinct identities on separate phones may serve the same project without forcing two platforms", () => {
  const next = reserveInitialResources(assigned(), { ...request([ids.fb2]), deviceId: ids.phone2 });
  assert.equal(next.snapshot.accountUses.length, 1); assert.equal(next.snapshot.phones.length, 2);
});
test("repeating exact initial reservation is a no-op and retains other allocations", () => {
  const s = reserveInitialResources(assigned(), request([ids.yt])).snapshot;
  const next = reserveInitialResources(s, request()); assert.equal(next.changed, false); assert.deepEqual(next.snapshot, s);
});
test("one request cannot include two identities for the same platform or duplicate IDs", () => {
  assert.throws(() => reserveInitialResources(empty(), request([ids.fb, ids.fb2])), rejected("RESOURCE_CONFLICT"));
  assert.throws(() => reserveInitialResources(empty(), request([ids.fb, ids.fb.toUpperCase()])), rejected("INVALID_RESOURCE_FACTS"));
});
test("unknown or caller-added authority facts cannot be inferred from requested IDs", () => {
  assert.throws(() => reserveInitialResources(empty(), request([randomUUID()])), rejected("INVALID_RESOURCE_FACTS"));
  assert.throws(() => reserveInitialResources(empty(), { ...request(), ready: true }), rejected("INVALID_RESOURCE_FACTS"));
  assert.throws(() => reserveInitialResources({ ...empty(), ignored: true }, request()), rejected("INVALID_RESOURCE_FACTS"));
});
test("corrupt snapshots fail closed: duplicate identity, slot, phone or account-use", () => {
  const s = assigned(), b = s.bindings[0]!;
  for (const bad of [ { ...s, identities: [...s.identities, s.identities[0]!] }, { ...s, bindings: [...s.bindings, { ...b, identityId: ids.fb2 }] },
    { ...s, phones: [...s.phones, { deviceId: ids.phone, projectId: ids.project2 }] }, { ...s, accountUses: [...s.accountUses, { accountId: ids.accountFB, projectId: ids.project2 }] } ]) {
    assert.throws(() => parseResourceReservations(bad), rejected("INVALID_RESOURCE_FACTS"));
  }
});
test("corrupt snapshots fail closed: registry platform, missing references or mixed-project bindings", () => {
  const s = assigned(), b = s.bindings[0]!;
  for (const bad of [ { ...s, accounts: s.accounts.filter(a => a.accountId !== ids.accountFB) }, { ...s, phones: [] }, { ...s, accountUses: [] },
    { ...s, bindings: [{ ...b, platform: "youtube" }] }, { ...s, bindings: [{ ...b, projectId: ids.project2 }] }, { ...s, bindings: [{ ...b, state: "ready" }] } ]) {
    assert.throws(() => parseResourceReservations(bad), rejected("INVALID_RESOURCE_FACTS"));
  }
});
test("UUID spelling normalizes before matching central IDs without normalizing platform keys", () => {
  assert.deepEqual(reserveInitialResources(empty(), { ...request(), projectId: ids.project.toUpperCase(), deviceId: ids.phone.toUpperCase(), identityIds: [ids.fb.toUpperCase()] }).snapshot, assigned());
});
