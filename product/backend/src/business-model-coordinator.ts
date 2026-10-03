import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { compareTimestamps, timestampSchema, uuidSchema } from "@socialgrowth/product-contracts";
import { BusinessSuggestionError, checkBusinessSuggestion, parseBusinessSuggestionContext, type BusinessSuggestionContext } from "./business-suggestion-core.js";
const id = uuidSchema.transform(v => v.toLowerCase());
const time = timestampSchema.refine(v => !v.startsWith("0000-"));
const policySchema = z.strictObject({ providerKey: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), modelKey: z.string().regex(/^[a-zA-Z0-9_.:/-]{1,150}$/), timeoutMs: z.int().min(1).max(30_000) });
const description = z.strictObject({ factId: id, version: z.int().min(1), text: z.string().trim().min(1).max(4000) });
const inputSchema = z.strictObject({ context: z.unknown(), descriptions: z.array(description).min(1).max(1000) });
const responseSchema = z.strictObject({ responseId: z.string().regex(/^[a-zA-Z0-9_.:-]{1,150}$/), outputText: z.string().max(262_144) });
type ModelInput = { context: BusinessSuggestionContext; descriptions: z.infer<typeof description>[] };
export interface BusinessModelFactsReader { read(projectId: string, signal: AbortSignal): Promise<unknown>; }
export interface BusinessModelPort {
  // The adapter, not model output, chooses configured provider/model and keeps
  // credentials outside the input. This port grants no task/action permission.
  generate(request: { attemptId: string; providerKey: string; modelKey: string; input: ModelInput }, signal: AbortSignal): Promise<unknown>;
}
type Provenance = { attemptId: string; providerKey: string; modelKey: string; startedAt: string; modelRequested: boolean };
export type BusinessModelResult =
  | { status: "unavailable"; reason: "configuration_missing" | "input_invalid" | "facts_unavailable" | "model_unavailable" | "deadline_exceeded" | "clock_invalid"; provenance: Provenance | null }
  | { status: "rejected"; reason: "response_invalid" | "facts_changed" | BusinessSuggestionError["code"]; provenance: Provenance; responseId: string | null }
  | { status: "checked_advisory"; provenance: Provenance; responseId: string; finishedAt: string; checked: ReturnType<typeof checkBusinessSuggestion> };
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => `${JSON.stringify(k)}:${canonical(value)}`).join(",")}}`;
}
function comparable(input: ModelInput) {
  const { observedAt: _observationTime, ...context } = input.context;
  return canonical({ context, descriptions: input.descriptions });
}
function parseInput(input: unknown, projectId: string): ModelInput {
  const p = inputSchema.safeParse(input); if (!p.success) throw new Error("invalid-facts");
  const context = parseBusinessSuggestionContext(p.data.context);
  if (context.projectId !== projectId || new Set(p.data.descriptions.map(v => v.factId)).size !== p.data.descriptions.length) throw new Error("invalid-facts");
  for (const d of p.data.descriptions) if (!context.facts.some(f => f.factId === d.factId && f.version === d.version)) throw new Error("invalid-facts");
  return structuredClone({ context, descriptions: p.data.descriptions });
}
// INTERNAL coordination only. Default ports/policy are absent. The separate
// initial-direction flow has a real configured Artemis adapter; this autonomous
// arrangement coordinator still needs its authoritative facts and task writer.
export class BusinessModelCoordinator {
  constructor(private readonly facts: BusinessModelFactsReader | null = null, private readonly model: BusinessModelPort | null = null,
    private readonly policy: unknown = null, private readonly clock: () => string = () => new Date().toISOString()) {}
  async run(projectInput: unknown): Promise<BusinessModelResult> {
    const config = policySchema.safeParse(this.policy);
    if (!this.facts || !this.model || !config.success) return { status: "unavailable", reason: "configuration_missing", provenance: null };
    const project = id.safeParse(projectInput); if (!project.success) return { status: "unavailable", reason: "input_invalid", provenance: null };
    let startedAt: string;
    try { const p = time.safeParse(this.clock()); if (!p.success) throw new Error("invalid-clock"); startedAt = p.data; }
    catch { return { status: "unavailable", reason: "clock_invalid", provenance: null }; }
    const provenance: Provenance = { attemptId: randomUUID(), providerKey: config.data.providerKey, modelKey: config.data.modelKey, startedAt, modelRequested: false };
    const controller = new AbortController(), timeout = Symbol("deadline"), clockInvalid = Symbol("clock-invalid");
    let timer: ReturnType<typeof setTimeout> | undefined, phase: "facts" | "model" = "facts";
    const expiresAt = performance.now() + config.data.timeoutMs;
    const withinDeadline = () => { if (performance.now() >= expiresAt) throw timeout; };
    const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(timeout), config.data.timeoutMs); });
    const step = <T>(fn: () => Promise<T>) => Promise.race([Promise.resolve().then(() => { withinDeadline(); return fn(); }).then(value => { withinDeadline(); return value; }), deadline]);
    let lastObservedAt: string | null = null;
    const observe = (input: ModelInput) => {
      const observedAt = time.safeParse(input.context.observedAt);
      if (!observedAt.success || (lastObservedAt !== null && compareTimestamps(observedAt.data, lastObservedAt)! < 0)) throw clockInvalid;
      lastObservedAt = observedAt.data;
      return observedAt.data;
    };
    try {
      const firstRead = await step(() => this.facts!.read(project.data, controller.signal));
      const original = parseInput(firstRead, project.data);
      observe(original);
      phase = "model";
      const returned = await step(() => {
        provenance.modelRequested = true;
        return this.model!.generate({ attemptId: provenance.attemptId, providerKey: config.data.providerKey, modelKey: config.data.modelKey,
          input: structuredClone(original) }, controller.signal);
      });
      // Copy adapter-owned envelope immediately; output is immutable JSON text,
      // never an object evaluated/executed or placed verbatim into logs/errors.
      let response: z.infer<typeof responseSchema>, suggestion: unknown;
      try {
        const p = responseSchema.safeParse(structuredClone(returned));
        if (!p.success || Buffer.byteLength(p.data.outputText, "utf8") > 262_144) throw new Error("invalid-response");
        response = p.data; suggestion = JSON.parse(response.outputText);
      } catch { return { status: "rejected", reason: "response_invalid", provenance, responseId: null }; }
      phase = "facts";
      const lastRead = await step(() => this.facts!.read(project.data, controller.signal));
      const current = parseInput(lastRead, project.data), finishedAt = observe(current);
      if (compareTimestamps(current.context.observedAt, original.context.observedAt)! < 0 || comparable(current) !== comparable(original)) return { status: "rejected", reason: "facts_changed", provenance, responseId: response.responseId };
      try {
        const checked = checkBusinessSuggestion(current.context, suggestion, finishedAt);
        withinDeadline();
        return { status: "checked_advisory", provenance, responseId: response.responseId, finishedAt, checked };
      } catch (e) {
        if (e === timeout) throw e;
        return { status: "rejected", reason: e instanceof BusinessSuggestionError ? e.code : "response_invalid", provenance, responseId: response.responseId };
      }
    } catch (e) {
      return { status: "unavailable", reason: e === timeout ? "deadline_exceeded" : e === clockInvalid ? "clock_invalid" : phase === "facts" ? "facts_unavailable" : "model_unavailable", provenance };
    } finally { clearTimeout(timer); controller.abort(); }
  }
}
