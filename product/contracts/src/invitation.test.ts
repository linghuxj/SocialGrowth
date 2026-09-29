import assert from "node:assert/strict";
import test from "node:test";

import {
  createInvitationResponseSchema,
  invitationViewSchema,
  listInvitationsResponseSchema,
  revokeInvitationResponseSchema,
} from "./invitation.js";

const id = "00000000-0000-4000-8000-000000000001";
const operatorId = "00000000-0000-4000-8000-000000000002";
const createdAt = "2026-09-29T00:00:00.000Z";
const expiresAt = "2026-10-06T00:00:00.000Z";

const activeInvitation = {
  invitationId: id,
  maxUses: 5,
  consumedUses: 1,
  expiresAt,
  createdAt,
  evaluatedAt: "2026-09-29T02:00:00.000Z",
  createdByOperatorId: operatorId,
  factVersion: 1,
  registrations: [{
    providerId: "00000000-0000-4000-8000-000000000003",
    displayName: "Provider One",
    registeredAt: "2026-09-29T01:00:00.000Z",
    associatedDeviceCount: 0,
  }],
  status: "active" as const,
  revokedAt: null,
  revokedByOperatorId: null,
};

test("invitation creation returns access once while list views exclude the code", () => {
  const code = "A".repeat(43);
  const created = createInvitationResponseSchema.parse({
    invitation: activeInvitation,
    access: { code },
  });
  const listed = listInvitationsResponseSchema.parse({
    invitations: [activeInvitation],
  });

  assert.equal(created.access.code, code);
  assert.equal("access" in listed.invitations[0]!, false);
  assert.equal("code" in listed.invitations[0]!, false);
});

test("invitation status fixes revocation actor and timestamp semantics", () => {
  assert.throws(() => invitationViewSchema.parse({
    ...activeInvitation,
    status: "revoked",
  }));
  assert.throws(() => invitationViewSchema.parse({
    ...activeInvitation,
    revokedAt: createdAt,
    revokedByOperatorId: operatorId,
  }));

  assert.equal(revokeInvitationResponseSchema.parse({
    invitation: {
      ...activeInvitation,
      status: "revoked",
      revokedAt: createdAt,
      revokedByOperatorId: operatorId,
    },
  }).invitation.status, "revoked");
});

test("invitation access rejects short or non-url-safe shared codes", () => {
  for (const code of ["too-short", "A".repeat(42), `${"A".repeat(42)}+`]) {
    assert.throws(() => createInvitationResponseSchema.parse({
      invitation: activeInvitation,
      access: { code },
    }));
  }
});

test("invitation views reject contradictory usage, status, time and incomplete progress", () => {
  const invalidInvitations = [
    { ...activeInvitation, consumedUses: 6 },
    { ...activeInvitation, consumedUses: 5, status: "active" },
    { ...activeInvitation, consumedUses: 0, registrations: [], status: "exhausted" },
    { ...activeInvitation, expiresAt: "2026-09-28T00:00:00.000Z" },
    { ...activeInvitation, consumedUses: 1, registrations: [] },
    {
      ...activeInvitation,
      consumedUses: 2,
      registrations: [activeInvitation.registrations[0], activeInvitation.registrations[0]],
    },
  ];
  for (const invitation of invalidInvitations) {
    assert.throws(() => invitationViewSchema.parse(invitation));
  }
});
