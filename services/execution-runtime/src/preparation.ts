import { createHash } from "node:crypto";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RuntimeTask } from "./runtime.ts";
import type { ArtemisPort } from "./artemis.ts";
import { AppProvisioner } from "./app-readiness.ts";
import { RuntimeError } from "./contracts.ts";

export const preparationReportSchema = z
  .object({
    status: z.enum(["ready", "waiting"]),
    reason: z.enum([
      "IDENTITY_VISIBLE",
      "LOGIN_REQUIRED",
      "IDENTITY_NOT_VISIBLE",
      "TARGET_APP_NOT_VISIBLE",
      "DEVICE_OR_APP_UNAVAILABLE",
      "OBSERVER_UNAVAILABLE",
    ]),
    observedAt: z.string().datetime({ offset: true }),
    observationSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    detailCode: z
      .string()
      .regex(/^[A-Z0-9_]{1,80}$/)
      .optional(),
  })
  .strict();
export type PreparationReport = z.infer<typeof preparationReportSchema>;
export interface PreparationLease {
  task: RuntimeTask;
  lease: string;
  expiresAt: string;
}

/** Passive inspection only: never call mobile_run_task or trust a model's mutation count.
 * A visible identity is a prerequisite, NOT a replacement for execution's identity gate. */
export async function inspectPreparation(
  task: RuntimeTask,
  ports: {
    ensureApp: () => Promise<unknown>;
    foreground: () => Promise<string>;
    observe: () => Promise<unknown>;
    now?: () => string;
  },
): Promise<PreparationReport> {
  const report = (
    reason: PreparationReport["reason"],
    observation?: string,
  ): PreparationReport => ({
    status: reason === "IDENTITY_VISIBLE" ? "ready" : "waiting",
    reason,
    observedAt: ports.now?.() ?? new Date().toISOString(),
    ...(observation
      ? { observationSha256: createHash("sha256").update(observation).digest("hex") }
      : {}),
  });
  try {
    await ports.ensureApp();
    if ((await ports.foreground()) !== task.directive.targetAppPackage)
      return report("TARGET_APP_NOT_VISIBLE");
  } catch (error) {
    return {
      ...report("DEVICE_OR_APP_UNAVAILABLE"),
      detailCode: error instanceof RuntimeError ? error.code : "DEVICE_COMMAND_FAILED",
    };
  }
  try {
    const value = await ports.observe();
    if (typeof value !== "string" || !value.trim() || /^Error:/i.test(value))
      return report("OBSERVER_UNAVAILABLE");
    // Localized login/challenge indicators take precedence over any matching text.
    if (
      /登入您的帳戶時發生問題|登录.*(?:失败|问题)|sign in to your account|problem signing|verify (?:your|it's you)|驗證您的身分|验证您的身份|忘記密碼|forgot password/i.test(
        value,
      )
    )
      return report("LOGIN_REQUIRED", value);
    const expected = task.binding.platformIdentity;
    // Require an exact URL token, not a display name, substring or an LLM assertion.
    const urls: string[] = value.match(/https?:\/\/[^\s<>"'\][)]+/g) ?? [];
    return report(urls.includes(expected) ? "IDENTITY_VISIBLE" : "IDENTITY_NOT_VISIBLE", value);
  } catch {
    return report("OBSERVER_UNAVAILABLE");
  }
}

export function preparationPorts(task: RuntimeTask, artemis: Pick<ArtemisPort, "call">) {
  const exec = promisify(execFile);
  return {
    ensureApp: () =>
      new AppProvisioner({
        catalogPath: process.env.SG_APP_CATALOG,
        buildTools: process.env.SG_ANDROID_BUILD_TOOLS,
      }).ensure(task.binding.serial, task.directive.targetAppPackage),
    foreground: async () => {
      const { stdout } = await exec(
        "adb",
        ["-s", task.binding.serial, "shell", "dumpsys", "activity", "activities"],
        { timeout: 15000, maxBuffer: 2 * 1024 * 1024 },
      );
      return (
        stdout.match(/(?:topResumedActivity|mResumedActivity):?[^\n]*?\bu\d+\s+([\w.]+)\//)?.[1] ??
        ""
      );
    },
    observe: () =>
      artemis.call(
        "mobile_get_device_state",
        { device_serial: task.binding.serial, view_type: "hierarchy" },
        20000,
      ),
  };
}
