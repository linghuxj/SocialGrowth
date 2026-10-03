import type { Socket } from "node:net";
import type { NetworkAdmissionRuntime } from "./network-admission-api.js";
import type { AuthenticatedAdmissionState } from "./network-admission-store.js";
import { readTailnetNode, type TailnetObservedNode, type TailnetWhoIsPort, type TrustedTailnetConnections } from "./tailscale-source-verifier.js";

/** Server-owned operation adapter. Only readiness is exposed here; this is not
 * confirmation that a policy was applied or that any phone has permission. */
export interface ControlledEnrollmentPolicyPort {
  ready(state: AuthenticatedAdmissionState, node: TailnetObservedNode, signal: AbortSignal): Promise<boolean>;
}
/** Read a freshly verified server revision for this exact enrollment and actual
 * source node. Implementations must read back the current real policy and its
 * recorded path verification. No ETag conversion or enrollment fallback. */
export interface AdmissionRevisionPort {
  read(state: AuthenticatedAdmissionState, node: TailnetObservedNode, signal: AbortSignal): Promise<{
    revision: number; observedAt: string;
  } | null>;
}
export class TailscaleAdmissionRuntime implements NetworkAdmissionRuntime {
  constructor(private readonly transports: TrustedTailnetConnections, private readonly whois: TailnetWhoIsPort,
    private readonly revisions: AdmissionRevisionPort | null, private readonly operations: ControlledEnrollmentPolicyPort | null) {}
  transportFor(socket: Socket): object | null { return this.transports.transportFor(socket); }
  private async bounded<T>(signal: AbortSignal, operation: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
    const controller = new AbortController(), bounded = AbortSignal.any([signal, controller.signal]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      return await Promise.race([operation(bounded), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error()); }, 2000);
      }), new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error()); bounded.addEventListener("abort", onAbort, { once: true });
        if (bounded.aborted) onAbort();
      })]);
    } catch { return null; }
    finally { clearTimeout(timer); controller.abort(); if (onAbort) bounded.removeEventListener("abort", onAbort); }
  }
  async canBegin(transport: object, state: AuthenticatedAdmissionState, signal: AbortSignal): Promise<boolean> {
    if (!this.operations) return false;
    return await this.bounded(signal, async bounded => {
      const peer = this.transports.peerOf(transport), at = Date.now();
      if (!peer || bounded.aborted) return false;
      const node = readTailnetNode(await this.whois.lookup(peer, bounded), peer);
      if (!node || !await this.operations!.ready(state, node, bounded)) return false;
      return !bounded.aborted && this.transports.peerOf(transport) === peer && Date.now() - at < 3000;
    }) === true;
  }
  async observe(transport: object, state: AuthenticatedAdmissionState, signal: AbortSignal) {
    if (!this.revisions || !state.record) return null;
    return this.bounded(signal, async bounded => {
      const peer = this.transports.peerOf(transport), started = Date.now();
      if (!peer || bounded.aborted) return null;
      const node = readTailnetNode(await this.whois.lookup(peer, bounded), peer);
      if (!node) return null;
      const pinned = state.record!.node ?? state.record!.challenge?.node;
      if (pinned && (pinned.nodeId !== node.nodeId || pinned.nodeKey !== node.nodeKey)) return null;
      const revision = await this.revisions!.read(state, node, bounded), now = Date.now();
      const observed = revision ? Date.parse(revision.observedAt) : NaN;
      // Restriction is a scope cross-check, never a source of the revision.
      if (!revision || !Number.isSafeInteger(revision.revision) || revision.revision < 1
        || !Number.isFinite(observed) || observed > now || now - observed >= 3000 || now - started >= 3000
        || state.record!.restriction?.networkRevision !== revision.revision || bounded.aborted
        || this.transports.peerOf(transport) !== peer) return null;
      return { node: { ...node, networkRevision: revision.revision }, observedAt: new Date(started).toISOString() };
    });
  }
}
