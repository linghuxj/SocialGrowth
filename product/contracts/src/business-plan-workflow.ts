import { z } from "zod";
import { timestampSchema, uuidSchema } from "./common.js";
import { materialUploadContentTypeSchema } from "./material-upload.js";

const version = z.int().min(1).max(Number.MAX_SAFE_INTEGER);
const objectBytes = z.int().min(1).max(128 * 1024 * 1024);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const file = z.strictObject({ objectId: uuidSchema, sha256, bytes: objectBytes, contentType: materialUploadContentTypeSchema });
const taskWorkflowState = z.enum(["blocked", "queued", "claimed", "running", "submission_unknown", "prepared", "verified", "not_published", "failed"]);
const operationState = z.enum(["queued", "claimed", "running", "submission_unknown", "prepared", "verified", "not_published", "failed"]);
const submissionState = z.enum(["not_started", "in_progress", "unknown", "prepared", "verified_published", "verified_not_published"]);
const recheckStatus = z.enum(["not_requested", "pending", "verified_recovered", "still_blocked", "unknown"]);
const blocker = z.string().min(1).max(120).refine(value => value.trim() === value);

export const businessPlanWorkflowScopeSchema = z.strictObject({
  projectId: uuidSchema,
  taskId: uuidSchema,
  taskRevision: version,
  planId: uuidSchema,
  planRevision: version,
  projectVersion: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
  approvalId: uuidSchema,
  contentUnitId: uuidSchema,
  variantId: uuidSchema,
  materialRevision: version,
  expectedFiles: z.array(file).min(1).max(20),
  taskAttemptId: uuidSchema,
  identityId: uuidSchema,
  reservedDeviceId: uuidSchema,
  platform: z.enum(["facebook", "youtube"]),
  form: z.enum(["facebook_video", "facebook_image_text", "youtube_shorts", "youtube_video"]),
  scheduledAt: timestampSchema,
});

export const businessPlanWorkflowTaskSchema = z.strictObject({
  taskId: uuidSchema,
  taskRevision: version,
  planId: uuidSchema,
  planRevision: version,
  contentUnitId: uuidSchema,
  variantId: uuidSchema,
  materialRevision: version,
  expectedFiles: z.array(file).max(20),
  identityId: uuidSchema,
  platform: z.enum(["facebook", "youtube"]),
  form: z.enum(["facebook_video", "facebook_image_text", "youtube_shorts", "youtube_video"]),
  scheduledAt: timestampSchema,
  attempt: z.strictObject({ taskAttemptId: uuidSchema, attemptNumber: z.literal(1), state: z.literal("pending_current_checks") }).nullable(),
  operation: z.strictObject({ operationId: z.string().min(1).max(200), state: operationState }).nullable(),
  workflow: z.strictObject({
    state: taskWorkflowState,
    claimId: uuidSchema.nullable(),
    leaseUntil: timestampSchema.nullable(),
    blockers: z.array(blocker).max(64),
    submissionState,
    verifiedResult: z.strictObject({ resultId: z.string().min(1).max(200), verifiedAt: timestampSchema }).nullable(),
    preparedAt: timestampSchema.nullable().default(null),
  }),
  assistanceTodoId: uuidSchema.nullable(),
  recheckStatus,
  recheckBlockers: z.array(blocker).max(32),
}).superRefine((task, ctx) => {
  const workflow = task.workflow;
  if ((workflow.claimId === null) !== (workflow.leaseUntil === null)) {
    ctx.addIssue({ code: "custom", path: ["workflow", "claimId"], message: "A claim and its lease must appear together" });
  }
  if (workflow.state === "claimed" && (workflow.claimId === null || task.operation !== null)) {
    ctx.addIssue({ code: "custom", path: ["workflow", "state"], message: "A claim requires a lease and no started operation" });
  }
  if ((workflow.state === "running" || workflow.state === "submission_unknown") && task.operation === null) {
    ctx.addIssue({ code: "custom", path: ["operation"], message: "Execution state requires an original operation" });
  }
  if (workflow.state === "running" && task.operation?.state !== "running") {
    ctx.addIssue({ code: "custom", path: ["operation", "state"], message: "Running workflow requires a running operation" });
  }
  if (workflow.state === "submission_unknown" && task.operation?.state !== "submission_unknown") {
    ctx.addIssue({ code: "custom", path: ["operation", "state"], message: "Unknown submission must remain bound to its original unknown operation" });
  }
  if ((workflow.state === "prepared" || workflow.state === "verified" || workflow.state === "not_published") && task.operation === null) {
    ctx.addIssue({ code: "custom", path: ["operation"], message: "Verified state requires an original operation" });
  }
  if (workflow.state === "prepared" && (task.operation?.state !== "prepared" || workflow.submissionState !== "prepared" || workflow.preparedAt === null || workflow.verifiedResult !== null)) {
    ctx.addIssue({ code: "custom", path: ["workflow"], message: "Preflight completion must remain distinct from publication verification" });
  }
  if (workflow.state === "verified" && (task.operation?.state !== "verified" || workflow.submissionState !== "verified_published" || workflow.verifiedResult === null)) {
    ctx.addIssue({ code: "custom", path: ["workflow"], message: "Published verification fields must agree" });
  }
  if (workflow.state === "not_published" && (task.operation?.state !== "not_published" || workflow.submissionState !== "verified_not_published" || workflow.verifiedResult === null)) {
    ctx.addIssue({ code: "custom", path: ["workflow"], message: "Not-published verification fields must agree" });
  }
  if (task.operation?.state === "verified" && workflow.state !== "verified") {
    ctx.addIssue({ code: "custom", path: ["operation", "state"], message: "Verified operation must have a matching workflow result" });
  }
  if (task.operation?.state === "not_published" && workflow.state !== "not_published") {
    ctx.addIssue({ code: "custom", path: ["operation", "state"], message: "Not-published operation must have a matching workflow result" });
  }
  if (workflow.state !== "verified" && workflow.state !== "not_published" && workflow.verifiedResult !== null) {
    ctx.addIssue({ code: "custom", path: ["workflow", "verifiedResult"], message: "A result requires a terminal trusted verification" });
  }
  if (workflow.state !== "prepared" && workflow.preparedAt !== null) {
    ctx.addIssue({ code: "custom", path: ["workflow", "preparedAt"], message: "Prepared timestamp requires the prepared state" });
  }
  if ((workflow.state === "prepared") !== (workflow.submissionState === "prepared")
    || (workflow.state === "verified") !== (workflow.submissionState === "verified_published")
    || (workflow.state === "not_published") !== (workflow.submissionState === "verified_not_published")) {
    ctx.addIssue({ code: "custom", path: ["workflow", "submissionState"], message: "Terminal state and submission state must agree" });
  }
  if (workflow.state === "blocked" && workflow.blockers.length === 0) {
    ctx.addIssue({ code: "custom", path: ["workflow", "blockers"], message: "Blocked state must explain its blockers" });
  }
  if (task.operation === null && workflow.submissionState !== "not_started") {
    ctx.addIssue({ code: "custom", path: ["workflow", "submissionState"], message: "Submission facts require an operation" });
  }
  if (task.operation !== null && workflow.submissionState === "not_started") {
    ctx.addIssue({ code: "custom", path: ["workflow", "submissionState"], message: "An operation cannot remain not started" });
  }
  if (task.attempt === null && task.assistanceTodoId !== null) {
    ctx.addIssue({ code: "custom", path: ["assistanceTodoId"], message: "An assistance todo requires exact attempt linkage" });
  }
  if (task.assistanceTodoId === null && task.recheckStatus !== "not_requested") {
    ctx.addIssue({ code: "custom", path: ["recheckStatus"], message: "Recheck status requires a linked todo" });
  }
  if (task.recheckStatus === "verified_recovered" && (task.assistanceTodoId === null || task.attempt === null)) {
    ctx.addIssue({ code: "custom", path: ["recheckStatus"], message: "Recovery must bind to the original attempt and todo" });
  }
});

export const businessPlanWorkflowResponseSchema = z.strictObject({
  projectId: uuidSchema,
  checkedAt: timestampSchema,
  ports: z.strictObject({ executor: z.enum(["connected", "unconnected"]), proofVerifier: z.enum(["connected", "unconnected"]) }),
  tasks: z.array(businessPlanWorkflowTaskSchema).max(1000),
}).superRefine((response, ctx) => {
  const ids = new Set<string>();
  for (const [index, task] of response.tasks.entries()) {
    const key = task.taskId.toLowerCase();
    if (ids.has(key)) ctx.addIssue({ code: "custom", path: ["tasks", index, "taskId"], message: "Duplicate project task" });
    ids.add(key);
  }
});

export type BusinessPlanWorkflowTask = z.infer<typeof businessPlanWorkflowTaskSchema>;
export type BusinessPlanWorkflowResponse = z.infer<typeof businessPlanWorkflowResponseSchema>;
export type BusinessPlanWorkflowScope = z.infer<typeof businessPlanWorkflowScopeSchema>;
