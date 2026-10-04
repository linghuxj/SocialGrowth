import { z } from "zod";
import { uuidSchema } from "./common.js";

// Independent preparation protocol. These definitions select work; they do not
// grant CT-06 action permission or extend the deployed publication protocol.
export const executionLibraryVersion = "2026-10-02.preparation-v1" as const;
export const preparationOperationIdSchema = z.enum([
  "inspect_app", "ensure_trusted_app", "verify_parent_login", "assist_existing_login",
  "inspect_publishing_identity", "create_facebook_page", "create_youtube_channel",
  "verify_publishing_identity", "browse_feed",
]);
export type PreparationOperationId = z.infer<typeof preparationOperationIdSchema>;
interface OperationDefinition {
  id: PreparationOperationId;
  name: string;
  platforms: readonly ("facebook" | "youtube")[];
  requiredInputs: readonly string[];
  completionFacts: readonly string[];
  instructions: string;
}
export const preparationExecutionLibrary: readonly OperationDefinition[] = [
  { id: "inspect_app", name: "检查平台 App", platforms: ["facebook", "youtube"], requiredInputs: ["device", "platform"], completionFacts: ["installed_package", "usable_app"], instructions: "Observe the exact device and target app. Report missing or unusable honestly; do not install during this check." },
  { id: "ensure_trusted_app", name: "安装并核验可信 App", platforms: ["facebook", "youtube"], requiredInputs: ["trusted_app_catalog", "installation_scope"], completionFacts: ["verified_package_and_signature", "usable_app"], instructions: "Use only the authorized signed APK catalog and recheck readiness. No arbitrary downloads, uninstall or data clearing." },
  { id: "verify_parent_login", name: "核验现有登录账号", platforms: ["facebook", "youtube"], requiredInputs: ["selected_account"], completionFacts: ["exact_parent_login"], instructions: "Resolve the selected internal account server-side and verify the exact intended parent login using current trusted evidence, not its display name. A different login requires reassignment; never switch accounts." },
  { id: "assist_existing_login", name: "协助登录已申请账号", platforms: ["facebook", "youtube"], requiredInputs: ["selected_account", "secure_human_assistance"], completionFacts: ["exact_parent_login"], instructions: "Sign in only to the pre-existing account bound to the selected internal account reference. Credentials may enter only through the explicitly authorized sensitive sink, never model/task text. Never register a Facebook personal or Google login account. Stop at unsupported system UI." },
  { id: "inspect_publishing_identity", name: "检查已有 Page／频道", platforms: ["facebook", "youtube"], requiredInputs: ["verified_parent", "target_identity"], completionFacts: ["identity_presence_or_absence", "identity_candidates"], instructions: "Inspect the intended Page/channel under the verified parent. Do not infer absence from an empty/error screen. Ambiguity needs human clarification; reuse an existing identity without renaming." },
  { id: "create_facebook_page", name: "创建缺少的 FB Page", platforms: ["facebook"], requiredInputs: ["verified_absence", "creation_scope", "name", "category", "description"], completionFacts: ["creation_submission_observation"], instructions: "Create only one specified Facebook Page under the verified parent, after verified absence. Submit creation at most once. An uncertain result must stop for reconciliation, never retry. Do not publish content." },
  { id: "create_youtube_channel", name: "创建缺少的 YouTube 频道", platforms: ["youtube"], requiredInputs: ["verified_absence", "creation_scope", "name", "handle"], completionFacts: ["creation_submission_observation"], instructions: "Create only one specified YouTube channel under the verified Google login after verified absence. Submit at most once. If the flow leaves the authorized app/site scope, request human assistance. Never retry an uncertain creation or publish content." },
  { id: "verify_publishing_identity", name: "核验发布身份及管理权限", platforms: ["facebook", "youtube"], requiredInputs: ["verified_parent", "target_identity"], completionFacts: ["full_platform_id", "identity_type", "exact_name", "management_access", "evidence"], instructions: "Read the full Page/channel ID and verify type, intended name and management access with actual evidence. A creation report or successful login is not verified readiness." },
  { id: "browse_feed", name: "有限时长模拟浏览", platforms: ["facebook", "youtube"], requiredInputs: ["verified_identity", "allowed_content_scope", "duration_bound", "stop_conditions"], completionFacts: ["actual_observation", "elapsed_time", "stop_reason"], instructions: "Use Artemis visual decisions to vary permitted reading and scrolling within the supplied time/content bounds. Do not fabricate views/results. Browsing grants no like, follow, comment, share, account change or publication authority." },
];

const ref = z.string().regex(/^[A-Za-z0-9_-]{1,150}$(?![\s\S])/);
const label = z.string().min(1).max(100).refine(v => v.trim() === v && !v.includes("\u0000"));
const evidence = { evidenceRef: ref.nullable() };
export const preparationTargetSchema = z.discriminatedUnion("platform", [
  z.strictObject({ platform: z.literal("facebook"), name: label, expectedId: z.string().regex(/^\d{5,30}$(?![\s\S])/).nullable(), category: label.nullable(), description: z.string().max(1000) }),
  z.strictObject({ platform: z.literal("youtube"), name: label, expectedId: z.string().regex(/^UC[A-Za-z0-9_-]{22}$(?![\s\S])/).nullable(), handle: label.nullable() }),
]);
export const accountPreparationInputSchema = z.strictObject({
  protocolVersion: z.literal(executionLibraryVersion),
  projectId: uuidSchema, deviceId: uuidSchema, accountId: uuidSchema,
  mode: z.enum(["check_only", "prepare_if_missing"]), target: preparationTargetSchema,
  requestedScope: z.strictObject({ scopeRef: ref, allowTrustedInstall: z.boolean(), allowIdentityCreation: z.boolean() }),
  facts: z.strictObject({
    version: z.int().min(1), currentScopeMatches: z.boolean(), unresolvedDeviceTask: z.boolean(),
    boundIdentityId: z.string().min(1).max(100).nullable(),
    priorCreation: z.enum(["none", "unresolved", "reported", "verified"]),
    app: z.strictObject({ state: z.enum(["unknown", "missing", "ready", "unusable"]), ...evidence }),
    login: z.strictObject({ state: z.enum(["unknown", "logged_out", "verified", "mismatch"]), ...evidence }),
    identity: z.strictObject({ state: z.enum(["unknown", "missing", "reported", "verified", "mismatch", "ambiguous"]),
      observedId: z.string().min(1).max(100).nullable(), observedName: label.nullable(),
      kind: z.enum(["facebook_page", "youtube_channel"]).nullable(), managementVerified: z.boolean(), ...evidence }),
  }),
}).superRefine((v, ctx) => {
  for (const [key, fact] of Object.entries({ app: v.facts.app, login: v.facts.login, identity: v.facts.identity })) {
    if (fact.state !== "unknown" && fact.evidenceRef === null) ctx.addIssue({ code: "custom", path: ["facts", key], message: "Observed facts require evidence references" });
  }
  if (v.facts.identity.state === "verified") {
    const i = v.facts.identity;
    if (i.observedId === null || i.observedName === null || i.kind === null || !i.managementVerified)
      ctx.addIssue({ code: "custom", path: ["facts", "identity"], message: "Verified identity needs ID, type, name and management evidence" });
  }
  if (v.facts.identity.state === "missing") {
    const i = v.facts.identity;
    if (i.observedId !== null || i.observedName !== null || i.kind !== null || i.managementVerified)
      ctx.addIssue({ code: "custom", path: ["facts", "identity"], message: "Missing identity cannot also claim an observed identity or management access" });
  }
});
export type AccountPreparationInput = z.infer<typeof accountPreparationInputSchema>;
