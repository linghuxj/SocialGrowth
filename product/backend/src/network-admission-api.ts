import { randomUUID } from "node:crypto";
import type { Socket } from "node:net";
import { ZodError } from "zod";
import {
  admissionProtocolVersion, admissionStateRequestSchema, admissionBeginRequestSchema,
  admissionChallengeRequestSchema, admissionProofRequestSchema, admissionSnapshotSchema,
  admissionChallengeResponseSchema, admissionErrorResponseSchema, type AdmissionSnapshot,
} from "@socialgrowth/product-contracts";
import type { InstallationAuthService } from "./installation-auth-service.js";
import { AdmissionError, type AdmissionRecord, type ObservedSource } from "./network-admission-core.js";
import { NetworkAdmissionStore, type AuthenticatedAdmissionState } from "./network-admission-store.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { bearerTokenFrom } from "./product-http.js";

// Only configured server adapters can provide this capability. No HTTP route
// accepts restriction evidence, current revisions, a node, or permission flags.
export interface NetworkAdmissionRuntime {
  transportFor(socket: Socket): object | null;
  canBegin(transport: object, state: AuthenticatedAdmissionState, signal: AbortSignal): Promise<boolean>;
  observe(transport: object, state: AuthenticatedAdmissionState, signal: AbortSignal): Promise<ObservedSource | null>;
}
export type AdmissionRoute = "state" | "begin" | "challenge" | "proof";
export interface AdmissionHttpResult { status: number; body: unknown }
function snapshot(state: AuthenticatedAdmissionState, ready: boolean, record = state.record): AdmissionSnapshot {
  return admissionSnapshotSchema.parse({ protocolVersion: admissionProtocolVersion, scope: {
    deviceId: state.scope.deviceId, installationId: state.scope.installationId,
    installationGeneration: state.scope.installationGeneration, ownershipVersion: state.scope.ownershipVersion,
  },
    enrollment: record ? { enrollmentId: record.enrollmentId, enrollmentGeneration: record.authority.enrollmentGeneration,
      version: record.version, phase: record.phase, expiresAt: record.expiresAt } : null,
    verifierReady: ready, networkAdmissionGranted: false, actionPermissionGranted: false });
}
function requestId(body: unknown): string {
  if (typeof body === "object" && body !== null && "requestId" in body && typeof body.requestId === "string"
    && /^[A-Za-z0-9_-]{8,128}$/.test(body.requestId)) return body.requestId;
  return `admission_${randomUUID()}`;
}
type FailureCode = ReturnType<typeof admissionErrorResponseSchema.parse>["error"]["code"];
function failed(code: FailureCode, id: string): AdmissionHttpResult {
  const status = code === "AUTHENTICATION_REQUIRED" ? 401 : code === "AUTHORITY_CHANGED" || code === "SOURCE_MISMATCH" ? 403
    : code === "STALE_FACT" || code === "INVALID_PHASE" || code === "EXPIRED" ? 409
    : code === "VERIFIER_UNAVAILABLE" ? 503 : code === "INTERNAL_ERROR" ? 500 : 400;
  return { status, body: admissionErrorResponseSchema.parse({ protocolVersion: admissionProtocolVersion, requestId: id,
    error: { code, retryable: code === "VERIFIER_UNAVAILABLE" || code === "INTERNAL_ERROR" } }) };
}

/** HTTP boundary shared by the main read-only endpoint and the independent
 * verifier listener. Authentication/scope transactions are also enforced in the
 * store; pre-authentication alone cannot authorize a later proof consumption. */
export class NetworkAdmissionApi {
  constructor(private readonly store: NetworkAdmissionStore, private readonly auth: InstallationAuthService,
    private readonly runtime: NetworkAdmissionRuntime | null = null) {}
  async handle(route: AdmissionRoute, body: unknown, authorization: string | undefined, socket: Socket): Promise<AdmissionHttpResult> {
    const id = requestId(body);
    try {
      if (typeof body === "object" && body !== null && "protocolVersion" in body && body.protocolVersion !== admissionProtocolVersion)
        return failed("PROTOCOL_UNSUPPORTED", id);
      const input = ({ state: admissionStateRequestSchema, begin: admissionBeginRequestSchema,
        challenge: admissionChallengeRequestSchema, proof: admissionProofRequestSchema }[route]).parse(body);
      const token = bearerTokenFrom(authorization, "Installation");
      const state = await this.store.authenticatedState(this.auth, token);
      const transport = this.runtime?.transportFor(socket);
      const signal = AbortSignal.timeout(2500);
      if (route === "state") {
        const observed = transport && this.runtime ? await this.runtime.observe(transport, state, signal) : null;
        return { status: 200, body: snapshot(state, observed !== null) };
      }
      if (!transport || !this.runtime) return failed("VERIFIER_UNAVAILABLE", id);
      let next: AdmissionRecord;
      if (route === "begin") {
        if (!await this.runtime.canBegin(transport, state, signal) || signal.aborted) return failed("VERIFIER_UNAVAILABLE", id);
        const request = admissionBeginRequestSchema.parse(input);
        next = await this.store.beginAuthenticated(this.auth, token, request.publicKeySpki, request.requestKey);
        return { status: 200, body: snapshot(state, false, next) };
      }
      const request = admissionChallengeRequestSchema.parse(route === "proof" ? (() => {
        const p = admissionProofRequestSchema.parse(input); const { proof: _proof, ...rest } = p; return rest;
      })() : input);
      // Do not inspect another installation's enrollment or resolve its source.
      if (state.record?.enrollmentId !== request.enrollmentId) return failed("AUTHORITY_CHANGED", id);
      const source = await this.runtime.observe(transport, state, signal);
      if (!source || signal.aborted) return failed("VERIFIER_UNAVAILABLE", id);
      next = await this.store.applyAuthenticated(this.auth, token, request.enrollmentId, request.expectedVersion, request.requestKey,
        route === "challenge" ? { kind: "issue_challenge", source }
          : { kind: "consume_proof", source, proof: admissionProofRequestSchema.parse(input).proof });
      if (route === "challenge") {
        if (!next.challenge) return failed("INVALID_PHASE", id);
        return { status: 200, body: admissionChallengeResponseSchema.parse({ ...snapshot(state, true, next), challenge: next.challenge }) };
      }
      return { status: 200, body: snapshot(state, true, next) };
    } catch (error) {
      if (error instanceof ZodError) return failed("INPUT_INVALID", id);
      if (error instanceof AdmissionError) return failed(error.code, id);
      if (error instanceof ProductTransactionError) return failed(error.code === "AUTHENTICATION_REQUIRED" || error.code === "INVALID_CREDENTIALS"
        ? "AUTHENTICATION_REQUIRED" : "AUTHORITY_CHANGED", id);
      return failed("INTERNAL_ERROR", id);
    }
  }
}
