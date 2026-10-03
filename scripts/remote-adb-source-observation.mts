import assert from "node:assert/strict";

export interface DiagnosticNodeIdentity { ID: number; Key: string; Online?: boolean }
export class DiagnosticSourceUnavailable extends Error {
  constructor() { super("DIAGNOSTIC_SOURCE_UNAVAILABLE"); }
}

/** Availability cannot excuse a changed authenticated node or key. */
export function requireLiveDiagnosticNode(observed: DiagnosticNodeIdentity, pinned: DiagnosticNodeIdentity): void {
  assert.equal(observed.ID, pinned.ID);
  assert.equal(observed.Key, pinned.Key);
  if (observed.Online !== true) throw new DiagnosticSourceUnavailable();
}
