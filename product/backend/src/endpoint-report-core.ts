import { createHash, createPublicKey, verify } from "node:crypto";
import { z } from "zod";
import { admissionGenerationSchema, compareTimestamps, nodeIdentitySchema, timestampSchema, uuidSchema } from "@socialgrowth/product-contracts";
const id = uuidSchema.transform(v => v.toLowerCase());
const time = timestampSchema.max(128).refine(v => !v.startsWith("0000-"));
const scopeSchema = z.strictObject({ enrollmentId: id, deviceId: id, installationId: id, installationGeneration: admissionGenerationSchema,
  enrollmentGeneration: admissionGenerationSchema, ownershipVersion: z.string().regex(/^(?:0|[1-9][0-9]{0,18})$/), node: nodeIdentitySchema });
const endpoint = z.strictObject({ purpose: z.enum(["connect", "pairing"]), status: z.enum(["candidate", "withdrawn", "unknown"]), port: z.int().min(1).max(65535).nullable(), pairingSessionId: id.nullable() });
const endpoints = z.array(endpoint).length(2).superRefine((v, c) => {
  if (new Set(v.map(e => e.purpose)).size !== 2 || v.some(e => (e.status === "candidate") !== (e.port !== null)
    || (e.purpose === "connect" && e.pairingSessionId !== null) || (e.purpose === "pairing" && (e.status === "candidate") !== (e.pairingSessionId !== null))))
    c.addIssue({ code: "custom", message: "Incomplete endpoint snapshot" });
});
const reportSchema = z.strictObject({ protocol: z.literal("2026-09-30.endpoint-v1"), reportId: id, scope: scopeSchema, sourceEpoch: id, sequence: admissionGenerationSchema,
  endpoints, observedAt: time, reason: z.enum(["initial_discovery", "changed", "service_lost", "network_changed", "resumed", "discovery_unknown"]) });
const signedSchema = z.strictObject({ report: reportSchema, signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/) });
const epoch = z.strictObject({ epochId: id, generation: admissionGenerationSchema, startedAt: time, endpointRevision: z.int().min(1) });
const receipt = z.strictObject({ reportId: id, sourceEpoch: id, sequence: admissionGenerationSchema, payloadDigest: z.string().regex(/^[a-f0-9]{64}$/), endpointRevision: z.int().min(1), receivedAt: time, signed: signedSchema });
const stateSchema = z.strictObject({ scope: scopeSchema, publicKeySpki: z.string().min(100).max(256), endpointRevision: z.int().min(0), epochs: z.array(epoch),
  sequence: admissionGenerationSchema.nullable(), endpoints, lastReceivedAt: time.nullable(), lastReportId: id.nullable(),
  latestObservedAt: time.nullable(), lastObservationReceivedAt: time.nullable(), receipts: z.array(receipt) });
const authoritySchema = z.strictObject({ scope: scopeSchema, mayReport: z.boolean(), publicKeySpki: z.string().min(100).max(256), pairingSessionId: id.nullable(), pairingExpiresAt: time.nullable() })
  .refine(v => (v.pairingSessionId === null) === (v.pairingExpiresAt === null));
export type EndpointAuthority = z.infer<typeof authoritySchema>;
export type EndpointReport = z.infer<typeof reportSchema>;
export type EndpointReportState = z.infer<typeof stateSchema>;
export class EndpointReportError extends Error {
  constructor(readonly code: "INPUT_INVALID" | "CORRUPT_STATE" | "AUTHORITY_CHANGED" | "INVALID_PROOF" | "STALE_VERSION" | "STALE_EPOCH" | "STALE_SEQUENCE" | "STALE_OBSERVATION" | "REPORT_ID_REUSED" | "PAIRING_SESSION_STALE" | "CLOCK_ORDER") { super(code); }
}
function fail(c: EndpointReportError["code"]): never { throw new EndpointReportError(c); }
function publicKey(input: string) {
  try {
    const raw = Buffer.from(input, "base64url"), k = createPublicKey({ key: raw, format: "der", type: "spki" });
    if (raw.toString("base64url") !== input || k.asymmetricKeyType !== "ec" || k.asymmetricKeyDetails?.namedCurve !== "prime256v1"
      || k.export({ format: "der", type: "spki" }).toString("base64url") !== input) fail("INVALID_PROOF");
    return k;
  } catch { return fail("INVALID_PROOF"); }
}
const unknown = () => [{ purpose: "connect" as const, status: "unknown" as const, port: null, pairingSessionId: null }, { purpose: "pairing" as const, status: "unknown" as const, port: null, pairingSessionId: null }];
function canonicalReport(input: unknown): EndpointReport {
  const r = reportSchema.safeParse(input); if (!r.success) return fail("INPUT_INVALID");
  r.data.endpoints.sort((a, b) => a.purpose.localeCompare(b.purpose)); return r.data;
}
export function endpointReportSigningBytes(input: unknown): Buffer {
  // New protocol: normalize UUIDs and fixed property order, preserving observed
  // timestamp spelling. Never reuse network-binding challenge signing bytes.
  return Buffer.from(`socialgrowth-endpoint-report\n${JSON.stringify(canonicalReport(input))}`, "utf8");
}
function validSignature(key: string, bytes: Buffer, encoded: string): boolean {
  const raw = Buffer.from(encoded, "base64url");
  return raw.length === 64 && raw.toString("base64url") === encoded
    && verify("sha256", bytes, { key: publicKey(key), dsaEncoding: "ieee-p1363" }, raw);
}
export function parseEndpointReportState(input: unknown): EndpointReportState {
  const p = stateSchema.safeParse(input); if (!p.success) return fail("CORRUPT_STATE"); const s = p.data;
  s.endpoints.sort((a, b) => a.purpose.localeCompare(b.purpose));
  try { publicKey(s.publicKeySpki); } catch { return fail("CORRUPT_STATE"); }
  const epochIds = new Set<string>(), reportIds = new Set<string>(), current = s.epochs.at(-1);
  for (let i = 0; i < s.epochs.length; i++) {
    const e = s.epochs[i]!; if (epochIds.has(e.epochId) || BigInt(e.generation) !== BigInt(i) + 1n || (i > 0 && compareTimestamps(e.startedAt, s.epochs[i - 1]!.startedAt)! < 0)) fail("CORRUPT_STATE");
    epochIds.add(e.epochId);
  }
  // Reconstruct each epoch from the accepted signed snapshots, not from mutable
  // digest/revision metadata alone. Full history is a prototype ledger, not a
  // production persistence or bounded-capacity claim; never silently trim it.
  let cursor = 0, revision = 0, previousReceived: string | null = null;
  let latestObserved: string | null = null, observationReceived: string | null = null;
  let reconstructed = unknown() as EndpointReportState["endpoints"];
  for (let i = 0; i < s.epochs.length; i++) {
    const e = s.epochs[i]!, nextEpoch = s.epochs[i + 1];
    if ((previousReceived && compareTimestamps(e.startedAt, previousReceived)! < 0) || e.endpointRevision !== ++revision) fail("CORRUPT_STATE");
    reconstructed = unknown(); latestObserved = null; observationReceived = null; let sequence = 0n;
    while (s.receipts[cursor]?.sourceEpoch === e.epochId) {
      const r = s.receipts[cursor++]!, report = canonicalReport(r.signed.report), bytes = endpointReportSigningBytes(report);
      let valid = false;
      try { valid = validSignature(s.publicKeySpki, bytes, r.signed.signature); } catch { return fail("CORRUPT_STATE"); }
      if (!valid || reportIds.has(r.reportId) || JSON.stringify(report.scope) !== JSON.stringify(s.scope)
        || report.reportId !== r.reportId || report.sourceEpoch !== r.sourceEpoch || report.sequence !== r.sequence
        || r.payloadDigest !== createHash("sha256").update(bytes).digest("hex") || BigInt(r.sequence) <= sequence
        || compareTimestamps(r.receivedAt, e.startedAt)! < 0 || (nextEpoch && compareTimestamps(r.receivedAt, nextEpoch.startedAt)! > 0)
        || (previousReceived && compareTimestamps(r.receivedAt, previousReceived)! < 0)) fail("CORRUPT_STATE");
      const changed = JSON.stringify(reconstructed) !== JSON.stringify(report.endpoints);
      const observationOrder = latestObserved === null ? 1 : compareTimestamps(report.observedAt, latestObserved)!;
      if (observationOrder < 0 || (observationOrder === 0 && changed)) fail("CORRUPT_STATE");
      if (observationOrder > 0) { latestObserved = report.observedAt; observationReceived = r.receivedAt; }
      if (changed) revision++;
      if (r.endpointRevision !== revision) fail("CORRUPT_STATE");
      reconstructed = report.endpoints; sequence = BigInt(r.sequence); previousReceived = r.receivedAt; reportIds.add(r.reportId);
    }
  }
  const last = s.receipts.at(-1), latestInEpoch = current && s.receipts.filter(r => r.sourceEpoch === current.epochId).at(-1);
  if (cursor !== s.receipts.length || s.endpointRevision !== revision || JSON.stringify(s.endpoints) !== JSON.stringify(reconstructed)
    || s.latestObservedAt !== latestObserved || s.lastObservationReceivedAt !== observationReceived
    || ((s.lastReportId === null) !== (s.lastReceivedAt === null)) || (last?.reportId ?? null) !== s.lastReportId || (last?.receivedAt ?? null) !== s.lastReceivedAt
    || (latestInEpoch?.sequence ?? null) !== s.sequence || (!latestInEpoch && JSON.stringify(s.endpoints) !== JSON.stringify(unknown()))) fail("CORRUPT_STATE");
  return s;
}
function check(s: EndpointReportState, authority: unknown): EndpointAuthority {
  const p = authoritySchema.safeParse(authority); if (!p.success) return fail("AUTHORITY_CHANGED"); const a = p.data;
  if (!a.mayReport || JSON.stringify(a.scope) !== JSON.stringify(s.scope) || a.publicKeySpki !== s.publicKeySpki) fail("AUTHORITY_CHANGED"); return a;
}
function clock(s: EndpointReportState, now: unknown): string {
  const p = time.safeParse(now); if (!p.success) return fail("INPUT_INVALID");
  if ((s.lastReceivedAt && compareTimestamps(p.data, s.lastReceivedAt)! < 0) || (s.epochs.at(-1) && compareTimestamps(p.data, s.epochs.at(-1)!.startedAt)! < 0)) fail("CLOCK_ORDER");
  return p.data;
}
// Internal only. Trusted producer must resolve current authenticated install,
// ownership, admission and actual source; these arguments are NOT client flags.
// No transport, database, phone consumer, ADB action, job or execution grant.
export function createEndpointReportState(authority: unknown): EndpointReportState {
  const p = authoritySchema.safeParse(authority); if (!p.success || !p.data.mayReport) return fail("AUTHORITY_CHANGED"); publicKey(p.data.publicKeySpki);
  return parseEndpointReportState({ scope: p.data.scope, publicKeySpki: p.data.publicKeySpki, endpointRevision: 0, epochs: [], sequence: null, endpoints: unknown(), lastReceivedAt: null, lastReportId: null, latestObservedAt: null, lastObservationReceivedAt: null, receipts: [] });
}
export function beginEndpointSourceEpoch(input: unknown, authority: unknown, expectedRevision: number, epochId: string, now: string): EndpointReportState {
  const s = parseEndpointReportState(input); check(s, authority); const t = clock(s, now), e = id.safeParse(epochId);
  if (!e.success || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return fail("INPUT_INVALID");
  if (s.epochs.at(-1)?.epochId === e.data) return s; // Exact current epoch replay does not refresh anything.
  if (s.epochs.some(r => r.epochId === e.data)) return fail("STALE_EPOCH");
  if (s.endpointRevision !== expectedRevision || expectedRevision === Number.MAX_SAFE_INTEGER) return fail("STALE_VERSION");
  s.endpointRevision++; s.epochs.push({ epochId: e.data, generation: String(s.epochs.length + 1), startedAt: t, endpointRevision: s.endpointRevision }); s.sequence = null; s.endpoints = unknown();
  s.latestObservedAt = null; s.lastObservationReceivedAt = null;
  return parseEndpointReportState(s); // Invalidate old candidates before any new observation.
}
export function acceptEndpointReport(input: unknown, authority: unknown, signedInput: unknown, now: string) {
  const s = parseEndpointReportState(input), a = check(s, authority), t = clock(s, now), parsed = signedSchema.safeParse(signedInput);
  if (!parsed.success) return fail("INPUT_INVALID"); const r = canonicalReport(parsed.data.report), current = s.epochs.at(-1);
  if (JSON.stringify(r.scope) !== JSON.stringify(s.scope)) return fail("AUTHORITY_CHANGED");
  if (!current || current.epochId !== r.sourceEpoch) return fail("STALE_EPOCH");
  const bytes = endpointReportSigningBytes(r);
  if (!validSignature(s.publicKeySpki, bytes, parsed.data.signature)) return fail("INVALID_PROOF");
  const digest = createHash("sha256").update(bytes).digest("hex"), previous = s.receipts.find(p => p.reportId === r.reportId);
  if (previous) {
    if (previous.payloadDigest !== digest) return fail("REPORT_ID_REUSED");
    return { state: s, disposition: "duplicate" as const, receipt: previous }; // Current state, original receipt; never refresh freshness.
  }
  const pairing = r.endpoints.find(e => e.purpose === "pairing")!;
  if (pairing.status === "candidate" && (pairing.pairingSessionId !== a.pairingSessionId || !a.pairingExpiresAt || compareTimestamps(t, a.pairingExpiresAt)! >= 0)) return fail("PAIRING_SESSION_STALE");
  if (BigInt(r.sequence) <= BigInt(s.sequence ?? "0")) return fail("STALE_SEQUENCE");
  const changed = JSON.stringify(s.endpoints) !== JSON.stringify(r.endpoints);
  const observationOrder = s.latestObservedAt === null ? 1 : compareTimestamps(r.observedAt, s.latestObservedAt)!;
  if (observationOrder < 0 || (observationOrder === 0 && changed)) return fail("STALE_OBSERVATION");
  if (observationOrder > 0) { s.latestObservedAt = r.observedAt; s.lastObservationReceivedAt = t; }
  if (changed) {
    if (s.endpointRevision === Number.MAX_SAFE_INTEGER) return fail("STALE_VERSION"); s.endpointRevision++;
  }
  s.endpoints = r.endpoints; s.sequence = r.sequence; s.lastReceivedAt = t; s.lastReportId = r.reportId;
  const accepted = { reportId: r.reportId, sourceEpoch: r.sourceEpoch, sequence: r.sequence, payloadDigest: digest, endpointRevision: s.endpointRevision, receivedAt: t, signed: { report: r, signature: parsed.data.signature } };
  s.receipts.push(accepted); return { state: parseEndpointReportState(s), disposition: "accepted" as const, receipt: accepted };
}
export function endpointReportTimeIsFresh(observedAt: string, now: string, maximumAgeMs: number): boolean {
  if (!time.safeParse(observedAt).success || !time.safeParse(now).success || !Number.isSafeInteger(maximumAgeMs) || maximumAgeMs < 1) return false;
  const parts = (v: string) => {
    const m = /^(.*:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(v)!;
    return { seconds: BigInt(Date.parse(`${m[1]}${m[3]}`) / 1000), fraction: m[2] ?? "" };
  };
  const n = parts(now), r = parts(observedAt), width = Math.max(3, n.fraction.length, r.fraction.length), unit = 10n ** BigInt(width);
  const age = (n.seconds - r.seconds) * unit + BigInt(n.fraction.padEnd(width, "0")) - BigInt(r.fraction.padEnd(width, "0"));
  return age >= 0n && age < BigInt(maximumAgeMs) * unit / 1000n;
}
export function readEndpointCandidates(input: unknown, authority: unknown, now: string, maximumAgeMs: number) {
  const s = parseEndpointReportState(input), a = check(s, authority), t = clock(s, now);
  if (!Number.isSafeInteger(maximumAgeMs) || maximumAgeMs < 1) return fail("INPUT_INVALID");
  const fresh = s.lastObservationReceivedAt !== null && s.sequence !== null && endpointReportTimeIsFresh(s.lastObservationReceivedAt, t, maximumAgeMs);
  return s.endpoints.map(e => {
    const pairingCurrent = e.purpose !== "pairing" || (e.pairingSessionId === a.pairingSessionId && a.pairingExpiresAt !== null && compareTimestamps(t, a.pairingExpiresAt)! < 0);
    return fresh && pairingCurrent ? e : { purpose: e.purpose, status: "unknown" as const, port: null, pairingSessionId: null };
  }); // These are unverified candidates, NEVER permission, connection or readiness.
}
