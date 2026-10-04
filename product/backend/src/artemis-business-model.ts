import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { initialDirectionOutputSchema } from "@socialgrowth/product-contracts";
import { businessSuggestionSchema } from "./business-suggestion-core.js";
import type { BusinessModelPort } from "./business-model-coordinator.js";
const description = z.strictObject({ configured: z.literal(true), providerKey: z.string().min(1).max(100), modelKey: z.string().min(1).max(150) });
const returned = z.strictObject({ providerKey: description.shape.providerKey, modelKey: description.shape.modelKey, responseId: z.string().uuid(), outputText: z.string().max(262144) });
const directionFields = ["direction", "rationale", "limitations"] as const;
const directionIssueCategories = ["unrecognized_keys", "invalid_type", "too_small", "too_big", "invalid_format", "other"] as const;
export function summarizeDirectionOutputFailure(error: z.ZodError) {
  const fields = [...new Set(error.issues.map(issue => directionFields.includes(String(issue.path[0]) as typeof directionFields[number]) ? String(issue.path[0]) : "object"))].sort();
  const categories = [...new Set(error.issues.map(issue => directionIssueCategories.includes(issue.code as typeof directionIssueCategories[number])
    ? issue.code as typeof directionIssueCategories[number] : "other"))].sort();
  const extraKeyCount = Math.min(100, error.issues.reduce((count, issue) => count + (issue.code === "unrecognized_keys" && "keys" in issue ? issue.keys.length : 0), 0));
  return { fields, categories, extraKeyCount };
}
export interface InitialDirectionModel {
  generateDirection(input: unknown, signal: AbortSignal): Promise<{ providerKey: string; modelKey: string; responseId: string; output: z.infer<typeof initialDirectionOutputSchema> }>;
}
// Explicit server-selected runtime path, no request-owned executable or URL.
// Uses the installed Artemis model factory without any phone/action capability.
export class ArtemisBusinessModel implements BusinessModelPort, InitialDirectionModel {
  private readonly root: string; private readonly python: string;
  constructor(root: string, private readonly script = resolve(new URL("../../../scripts/artemis-business-model.py", import.meta.url).pathname)) {
    if (!isAbsolute(root) || !existsSync(join(root, ".env")) || !existsSync(join(root, ".venv/bin/python")) || !existsSync(script)) throw new Error("ARTEMIS_BUSINESS_CONFIG_REQUIRED");
    this.root = realpathSync(root); this.python = join(this.root, ".venv/bin/python");
  }
  private async invoke(args: string[], input: unknown, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) throw new Error("BUSINESS_MODEL_UNAVAILABLE");
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(SG_|ARTEMIS_|OPENAI_|GOOGLE_|GEMINI_|ANTHROPIC_|LANGCHAIN_|LANGSMITH_|OTEL_)/.test(k)));
    return new Promise((yes, no) => {
      const child = spawn(this.python, [this.script, ...args], { cwd: this.root, env: { ...env, PYTHONPATH: this.root, LANGCHAIN_TRACING_V2: "false", LANGSMITH_TRACING: "false" }, stdio: ["pipe", "pipe", "ignore"] });
      let data = Buffer.alloc(0), completed = false, cancelled = false;
      const abort = () => { cancelled = true; child.kill("SIGKILL"); };
      // Includes interpreter/import startup; the configured network request is
      // bounded separately at 30s and must have time to report its own timeout.
      const timer = setTimeout(abort, 40000); signal.addEventListener("abort", abort, { once: true });
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
      child.stdout.on("data", (chunk: Buffer) => { data = Buffer.concat([data, chunk]); if (data.length > 524288) abort(); });
      child.on("error", () => { if (!completed) { completed = true; cleanup(); no(new Error("BUSINESS_MODEL_UNAVAILABLE")); } });
      child.on("close", code => { if (completed) return; completed = true; cleanup();
        if (cancelled || signal.aborted || data.length > 524288) { no(new Error("BUSINESS_MODEL_DEADLINE")); return; }
        if (code !== 0) {
          let category = "configured_model_unavailable";
          try { const failure = z.strictObject({ unavailable: z.literal(true), reason: z.enum(["model_timeout", "model_rate_limited", "model_configuration_rejected", "model_request_rejected", "model_response_invalid", "configured_model_unavailable"]) }).parse(JSON.parse(data.toString("utf8"))); category = failure.reason; } catch { /* no raw diagnostics */ }
          no(new Error(`BUSINESS_MODEL_${category.toUpperCase()}`)); return;
        }
        try { yes(JSON.parse(data.toString("utf8"))); } catch { no(new Error("BUSINESS_MODEL_UNAVAILABLE")); }
      });
      child.stdin.on("error", () => { /* close/error owns completion */ });
      child.stdin.end(input === null ? undefined : JSON.stringify(input));
    });
  }
  async describe(signal: AbortSignal) { return description.parse(await this.invoke(["--describe"], null, signal)); }
  async generateDirection(input: unknown, signal: AbortSignal) {
    const response = returned.parse(await this.invoke([], { operation: "initial_direction", input, outputSchema: z.toJSONSchema(initialDirectionOutputSchema, { io: "input" }) }, signal));
    const output = initialDirectionOutputSchema.safeParse(JSON.parse(response.outputText));
    if (!output.success) {
      // Only fixed categories and allowlisted paths/counts; never model text,
      // unrecognized key names, values, prompts or Zod messages.
      console.warn(JSON.stringify({ event: "direction_output_invalid", outputBytes: Buffer.byteLength(response.outputText),
        ...summarizeDirectionOutputFailure(output.error) }));
      throw new Error("BUSINESS_MODEL_SCHEMA_INVALID");
    }
    return { ...response, output: output.data };
  }
  async generate(request: Parameters<BusinessModelPort["generate"]>[0], signal: AbortSignal) {
    const response = returned.parse(await this.invoke([], { operation: "business_suggestion", input: request.input,
      outputSchema: z.toJSONSchema(businessSuggestionSchema, { io: "input" }) }, signal));
    if (response.providerKey !== request.providerKey || response.modelKey !== request.modelKey) throw new Error("BUSINESS_MODEL_CONFIGURATION_CHANGED");
    return { responseId: response.responseId, outputText: response.outputText };
  }
}
export function readInitialDirectionModel(environment: NodeJS.ProcessEnv = process.env): ArtemisBusinessModel | null {
  const mode = environment.SG_PRODUCT_BUSINESS_MODEL_MODE ?? "unavailable";
  if (mode === "unavailable" && environment.SG_PRODUCT_ARTEMIS_ROOT === undefined) return null;
  if (mode !== "artemis_configured" || !environment.SG_PRODUCT_ARTEMIS_ROOT) throw new Error("ARTEMIS_BUSINESS_CONFIG_REQUIRED");
  return new ArtemisBusinessModel(environment.SG_PRODUCT_ARTEMIS_ROOT);
}
