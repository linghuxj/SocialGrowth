import { constants } from "node:fs";
import { open, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { buildRestrictedProposal, type RestrictedProposalScope } from "./tailnet-restricted-proposal.js";
import { tailnetAddress } from "./tailscale-source-verifier.js";

const scopes = ["policy_file", "devices:core:read", "devices:posture_attributes"] as const;
const configSchema = z.strictObject({
  tailnet: z.string().regex(/^(?:-|[A-Za-z0-9_.@-]{1,200})$/),
  clientId: z.string().min(1).max(256).refine(value => !/\s/.test(value)),
  clientSecret: z.string().min(20).max(512).refine(value => !/\s/.test(value)),
});
export type TailnetPolicyWriteConfiguration = z.infer<typeof configSchema>;
const trustedConfigurations = new WeakSet<object>();
export class TailnetPolicyCasError extends Error {
  constructor(readonly code: "CONFIGURATION_UNAVAILABLE" | "OAUTH_UNAVAILABLE" | "POLICY_UNAVAILABLE" | "VALIDATION_UNAVAILABLE"
    | "CURRENT_POLICY_STALE" | "REVIEWED_CANDIDATE_MISMATCH" | "POLICY_REJECTED" | "POLICY_WRITE_UNKNOWN"
    | "POLICY_READBACK_MISMATCH" | "RECOVERY_UNAVAILABLE" | "RECOVERY_INVALID" | "RECOVERY_ETAG_STALE") { super(code); }
}
export interface TailnetPolicySnapshot { text: string; etag: string; sha256: string }
export interface TailnetDeviceInventory { sha256: string; deviceCount: number; addresses: string[] }
export interface TailnetPolicyApplyInput {
  expectedCurrentEtag: string;
  expectedCurrentSha256: string;
  expectedInventorySha256: string;
  reviewedCandidateSha256: string;
  recoveryFile: string;
  scope: RestrictedProposalScope;
}
export interface TailnetPolicyApplied {
  status: "applied_and_read_back";
  previousEtag: string;
  currentEtag: string;
  previousSha256: string;
  currentSha256: string;
  candidateSha256: string;
  recoveryFile: string;
  policyMutationPerformed: true;
  isolationVerified: false;
  networkAdmissionGranted: false;
  actionPermissionGranted: false;
}

type FetchPort = typeof fetch;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const etagValid = (value: string | null): value is string => !!value && value.length >= 3 && value.length <= 256
  && /^"[\x21\x23-\x7e]+"$/.test(value);

function parseDeviceInventory(raw: unknown): TailnetDeviceInventory {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || !("devices" in raw) || !Array.isArray(raw.devices)
      || raw.devices.length < 1 || raw.devices.length > 512) throw new Error();
    const ids = new Set<string>(), addresses = new Set<string>();
    const rows = raw.devices.map((value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value) || !("id" in value) || typeof value.id !== "string"
        || !/^[A-Za-z0-9_-]{1,128}$/.test(value.id) || ids.has(value.id) || !("addresses" in value) || !Array.isArray(value.addresses)
        || value.addresses.length < 1 || value.addresses.length > 8) throw new Error();
      ids.add(value.id);
      const current = value.addresses.map((address: unknown) => {
        if (typeof address !== "string" || tailnetAddress(address) !== address || addresses.has(address)) throw new Error();
        addresses.add(address); return address;
      }).sort();
      return { id: value.id, addresses: current };
    }).sort((a, b) => a.id.localeCompare(b.id));
    return { sha256: sha(JSON.stringify(rows)), deviceCount: rows.length, addresses: [...addresses].sort() };
  } catch { throw new TailnetPolicyCasError("POLICY_UNAVAILABLE"); }
}

function scopeCoversInventory(scope: RestrictedProposalScope, inventory: TailnetDeviceInventory): boolean {
  const pending = new Set(scope.pendingAddresses), preserved = new Set(scope.preservedAddresses);
  const verifierContained = scope.verifierAddresses.every(address => preserved.has(address));
  const disjoint = [...pending].every(address => !preserved.has(address));
  const covered = new Set([...pending, ...preserved]);
  return verifierContained && disjoint && covered.size === inventory.addresses.length
    && JSON.stringify([...covered].sort()) === JSON.stringify(inventory.addresses);
}

/** A separately supplied owner-only write credential is mandatory. This never
 * falls back to the read-only inspection credential or expands runtime grants. */
export async function readTailnetPolicyWriteConfiguration(path: string): Promise<TailnetPolicyWriteConfiguration> {
  try {
    const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await fd.stat();
      if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || stat.size > 4096) throw new Error();
      const parsed = configSchema.parse(JSON.parse(await fd.readFile("utf8")));
      trustedConfigurations.add(parsed);
      return parsed;
    } finally { await fd.close(); }
  } catch { throw new TailnetPolicyCasError("CONFIGURATION_UNAVAILABLE"); }
}

async function limitedBody(response: Response, maximumBytes: number): Promise<string> {
  if (!response.ok || !response.body) throw new Error();
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.byteLength; if (bytes > maximumBytes) throw new Error();
      chunks.push(next.value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { await reader.cancel().catch(() => undefined); }
}

async function saveRecovery(path: string, snapshot: TailnetPolicySnapshot): Promise<void> {
  let directory: Awaited<ReturnType<typeof open>> | undefined;
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const absolute = resolve(path), parentPath = dirname(absolute);
    directory = await open(parentPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const parent = await directory.stat(), currentParent = await lstat(parentPath);
    if (!parent.isDirectory() || parent.uid !== process.getuid?.() || (parent.mode & 0o077) !== 0
      || !currentParent.isDirectory() || currentParent.isSymbolicLink() || currentParent.dev !== parent.dev || currentParent.ino !== parent.ino) throw new Error();
    file = await open(absolute, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await file.writeFile(JSON.stringify({ formatVersion: 1, ...snapshot }));
    await file.sync();
    const stat = await file.stat(), finalParent = await lstat(parentPath);
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0
      || finalParent.isSymbolicLink() || finalParent.dev !== parent.dev || finalParent.ino !== parent.ino) throw new Error();
    // Persist the filename after its contents; policy POST is forbidden until
    // both syncs complete so a crash cannot strand an applied policy without its backup.
    await directory.sync();
  } catch { throw new TailnetPolicyCasError("RECOVERY_UNAVAILABLE"); }
  finally { await file?.close().catch(() => undefined); await directory?.close().catch(() => undefined); }
}

async function readRecovery(path: string): Promise<TailnetPolicySnapshot> {
  try {
    const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await fd.stat();
      if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || stat.size > 1_100_000) throw new Error();
      const value: unknown = JSON.parse(await fd.readFile("utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      const row = value as Record<string, unknown>;
      if (Object.keys(row).sort().join(",") !== "etag,formatVersion,sha256,text") throw new Error();
      if (row.formatVersion !== 1 || typeof row.text !== "string" || typeof row.etag !== "string" || !etagValid(row.etag)
        || typeof row.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.sha256) || sha(row.text) !== row.sha256) throw new Error();
      return { text: row.text, etag: row.etag, sha256: row.sha256 };
    } finally { await fd.close(); }
  } catch { throw new TailnetPolicyCasError("RECOVERY_INVALID"); }
}

/** Exact official Tailscale policy-file endpoints, private write scope, current
 * ETag precondition, known-safe proposal builder, saved recovery and readback.
 * An applied policy remains only a control-plane fact; this class never proves
 * data-plane isolation or returns admission/action permission. */
export function createTailnetPolicyCas(configuration: TailnetPolicyWriteConfiguration, request: FetchPort = fetch) {
  const parsed = configSchema.safeParse(configuration);
  if (!parsed.success || !trustedConfigurations.has(configuration)) throw new TailnetPolicyCasError("CONFIGURATION_UNAVAILABLE");
  const config = parsed.data, prefix = `https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(config.tailnet)}`;
  return {
    async readCurrent(): Promise<TailnetPolicySnapshot> {
      try {
        const session = await openSession();
        const response = await request(`${prefix}/acl`, { method: "GET", headers: { Authorization: `Bearer ${session.token}`, Accept: "application/hujson" },
          redirect: "error", signal: AbortSignal.timeout(10_000) });
        const text = await limitedBody(response, 1_048_576), etag = response.headers.get("etag");
        if (!text.trim() || !etagValid(etag)) throw new Error();
        return { text, etag, sha256: sha(text) };
      } catch (error) {
        if (error instanceof TailnetPolicyCasError) throw error;
        throw new TailnetPolicyCasError("POLICY_UNAVAILABLE");
      }
    },
    async readCurrentInventory(): Promise<TailnetDeviceInventory> {
      try {
        const session = await openSession();
        const response = await request(`${prefix}/devices`, { method: "GET", headers: { Authorization: `Bearer ${session.token}`, Accept: "application/json" },
          redirect: "error", signal: AbortSignal.timeout(10_000) });
        return parseDeviceInventory(JSON.parse(await limitedBody(response, 2_097_152)) as unknown);
      } catch (error) {
        if (error instanceof TailnetPolicyCasError) throw error;
        throw new TailnetPolicyCasError("POLICY_UNAVAILABLE");
      }
    },
    async applyReviewedProposal(input: TailnetPolicyApplyInput): Promise<TailnetPolicyApplied> {
      // Snapshot every caller-owned value before the first await. Review hashes,
      // source inventory and recovery destination must describe one immutable plan.
      const plan: TailnetPolicyApplyInput = {
        expectedCurrentEtag: input.expectedCurrentEtag,
        expectedCurrentSha256: input.expectedCurrentSha256,
        expectedInventorySha256: input.expectedInventorySha256,
        reviewedCandidateSha256: input.reviewedCandidateSha256,
        recoveryFile: resolve(input.recoveryFile),
        scope: { pendingAddresses: [...input.scope.pendingAddresses], verifierAddresses: [...input.scope.verifierAddresses],
          preservedAddresses: [...input.scope.preservedAddresses], verifierPort: input.scope.verifierPort },
      };
      const first = await this.readCurrent();
      if (first.etag !== plan.expectedCurrentEtag || first.sha256 !== plan.expectedCurrentSha256) throw new TailnetPolicyCasError("CURRENT_POLICY_STALE");
      const inventory = await this.readCurrentInventory();
      if (inventory.sha256 !== plan.expectedInventorySha256 || !scopeCoversInventory(plan.scope, inventory)) throw new TailnetPolicyCasError("CURRENT_POLICY_STALE");
      let proposal: ReturnType<typeof buildRestrictedProposal>;
      try { proposal = buildRestrictedProposal(first.text, plan.scope); }
      catch { throw new TailnetPolicyCasError("POLICY_REJECTED"); }
      if (proposal.summary.candidateSha256 !== plan.reviewedCandidateSha256) throw new TailnetPolicyCasError("REVIEWED_CANDIDATE_MISMATCH");
      const session = await openSession();
      let validation: { errors: number; warnings: number };
      try {
        const response = await request(`${prefix}/acl/validate`, { method: "POST", body: proposal.text,
          headers: { Authorization: `Bearer ${session.token}`, Accept: "application/json", "Content-Type": "application/hujson" },
          redirect: "error", signal: AbortSignal.timeout(10_000) });
        const raw: unknown = JSON.parse(await limitedBody(response, 262_144));
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error();
        const result = raw as Record<string, unknown>;
        if (Object.keys(result).some(key => !["errors", "warnings", "message", "data"].includes(key))
          || (result.errors !== undefined && !Array.isArray(result.errors)) || (result.warnings !== undefined && !Array.isArray(result.warnings))
          || (result.data !== undefined && !Array.isArray(result.data)) || (result.message !== undefined && typeof result.message !== "string")) throw new Error();
        validation = { errors: ((result.errors as unknown[] | undefined)?.length ?? 0) + ((result.data as unknown[] | undefined)?.length ?? 0)
          + (result.message ? 1 : 0), warnings: (result.warnings as unknown[] | undefined)?.length ?? 0 };
      } catch { throw new TailnetPolicyCasError("VALIDATION_UNAVAILABLE"); }
      if (validation.errors || validation.warnings) throw new TailnetPolicyCasError("POLICY_REJECTED");
      const current = await this.readCurrent();
      if (current.etag !== first.etag || current.sha256 !== first.sha256) throw new TailnetPolicyCasError("CURRENT_POLICY_STALE");
      const currentInventory = await this.readCurrentInventory();
      if (currentInventory.sha256 !== inventory.sha256 || !scopeCoversInventory(plan.scope, currentInventory)) throw new TailnetPolicyCasError("CURRENT_POLICY_STALE");
      await saveRecovery(plan.recoveryFile, first);
      let applied: Response;
      try {
        applied = await request(`${prefix}/acl`, { method: "POST", body: proposal.text,
          headers: { Authorization: `Bearer ${session.token}`, Accept: "application/hujson", "Content-Type": "application/hujson", "If-Match": first.etag },
          redirect: "error", signal: AbortSignal.timeout(10_000) });
      } catch { throw new TailnetPolicyCasError("POLICY_WRITE_UNKNOWN"); }
      if (applied.status === 412) throw new TailnetPolicyCasError("CURRENT_POLICY_STALE");
      if (applied.status >= 500) throw new TailnetPolicyCasError("POLICY_WRITE_UNKNOWN");
      if (!applied.ok) throw new TailnetPolicyCasError("POLICY_REJECTED");
      try { await limitedBody(applied, 1_048_576); }
      catch { throw new TailnetPolicyCasError("POLICY_WRITE_UNKNOWN"); }
      const after = await this.readCurrent().catch(() => { throw new TailnetPolicyCasError("POLICY_WRITE_UNKNOWN"); });
      if (after.etag === first.etag || after.sha256 !== proposal.summary.candidateSha256) throw new TailnetPolicyCasError("POLICY_READBACK_MISMATCH");
      return { status: "applied_and_read_back", previousEtag: first.etag, currentEtag: after.etag, previousSha256: first.sha256,
        currentSha256: after.sha256, candidateSha256: proposal.summary.candidateSha256, recoveryFile: plan.recoveryFile,
        policyMutationPerformed: true, isolationVerified: false, networkAdmissionGranted: false, actionPermissionGranted: false };
    },
    async restoreRecovery(path: string, expectedCurrentEtag: string, expectedCurrentSha256: string): Promise<{ restored: boolean; policyMutationPerformed: boolean }> {
      const recovery = await readRecovery(path), current = await this.readCurrent();
      if (current.etag !== expectedCurrentEtag || current.sha256 !== expectedCurrentSha256) throw new TailnetPolicyCasError("RECOVERY_ETAG_STALE");
      const session = await openSession();
      let response: Response;
      try {
        response = await request(`${prefix}/acl`, { method: "POST", body: recovery.text,
          headers: { Authorization: `Bearer ${session.token}`, Accept: "application/hujson", "Content-Type": "application/hujson", "If-Match": current.etag },
          redirect: "error", signal: AbortSignal.timeout(10_000) });
      } catch { throw new TailnetPolicyCasError("POLICY_WRITE_UNKNOWN"); }
      if (response.status === 412) throw new TailnetPolicyCasError("RECOVERY_ETAG_STALE");
      if (response.status >= 500) throw new TailnetPolicyCasError("POLICY_WRITE_UNKNOWN");
      if (!response.ok) throw new TailnetPolicyCasError("POLICY_REJECTED");
      try { await limitedBody(response, 1_048_576); } catch { throw new TailnetPolicyCasError("POLICY_WRITE_UNKNOWN"); }
      const restored = await this.readCurrent().catch(() => { throw new TailnetPolicyCasError("POLICY_WRITE_UNKNOWN"); });
      if (restored.sha256 !== recovery.sha256) throw new TailnetPolicyCasError("POLICY_READBACK_MISMATCH");
      return { restored: true, policyMutationPerformed: true };
    },
  };

  async function openSession(): Promise<{ token: string }> {
    try {
      const response = await request("https://api.tailscale.com/api/v2/oauth/token", { method: "POST",
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: config.clientId, client_secret: config.clientSecret, scope: scopes.join(" ") }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" }, redirect: "error", signal: AbortSignal.timeout(10_000) });
      const raw = JSON.parse(await limitedBody(response, 16_384)) as Record<string, unknown>;
      const expected = new Set<string>(scopes);
      if (typeof raw.access_token !== "string" || !/^[A-Za-z0-9_.-]{20,4096}$/.test(raw.access_token) || raw.token_type !== "Bearer"
        || !Number.isSafeInteger(raw.expires_in) || Number(raw.expires_in) < 30 || typeof raw.scope !== "string") throw new Error();
      const granted = raw.scope.split(" ").filter(Boolean);
      if (granted.length !== expected.size || new Set(granted).size !== expected.size || granted.some(value => !expected.has(value))) throw new Error();
      return { token: raw.access_token };
    } catch { throw new TailnetPolicyCasError("OAUTH_UNAVAILABLE"); }
  }
}
