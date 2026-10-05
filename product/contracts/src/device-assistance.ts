import { z } from "zod";
import { compareTimestamps, requestMetadataSchema, timestampSchema, uuidSchema } from "./common.js";
import { projectLabelSchema } from "./project.js";
// This new consumer supports the common TS/Python local calendar years 0001–9999.
// Keep the full shared ISO grammar, including long fractions and offsets, in
// the generated pattern too; a runtime-only refinement would leave Python open.
const isoPattern = z.toJSONSchema(timestampSchema).pattern;
if (typeof isoPattern !== "string" || !isoPattern.startsWith("^")) throw new Error("Expected anchored ISO timestamp grammar");
const assistanceTimestampSchema = z.string().regex(new RegExp(isoPattern.replace(/^\^/, "^(?!0000-)")));
// Historical origin scope, NOT current project allocation or execution status.
export const deviceAssistanceTodoSummarySchema = z.strictObject({
  todoId: uuidSchema, occurrenceId: uuidSchema, providerId: uuidSchema,
  initialResponsibleOperatorId: uuidSchema, originScope: z.literal("unassigned_device"),
  kind: z.literal("network_access_help"), status: z.enum(["open", "awaiting_recheck"]),
  factVersion: z.int().min(0), impactCount: z.int().min(1), noteCount: z.int().min(0),
  notificationStatus: z.literal("awaiting_configuration"), createdAt: assistanceTimestampSchema, updatedAt: assistanceTimestampSchema,
}).superRefine((v, ctx) => {
  if (v.status === "awaiting_recheck" && v.noteCount === 0) ctx.addIssue({ code: "custom", message: "Recheck status needs a recorded processing report" });
  if (timestampSchema.safeParse(v.createdAt).success && timestampSchema.safeParse(v.updatedAt).success && compareTimestamps(v.updatedAt, v.createdAt) === -1) ctx.addIssue({ code: "custom", message: "Assistance update predates creation" });
});
export const listDeviceAssistanceTodosResponseSchema = z.strictObject({
  todos: z.array(deviceAssistanceTodoSummarySchema).max(50), nextAfterTodoId: uuidSchema.nullable(),
}).superRefine((v, ctx) => {
  if (new Set(v.todos.map(t => t.todoId.toLowerCase())).size !== v.todos.length
    || (v.nextAfterTodoId !== null && v.nextAfterTodoId.toLowerCase() !== v.todos.at(-1)?.todoId.toLowerCase())) ctx.addIssue({ code: "custom", message: "Assistance page cursor or identity is inconsistent" });
});
export type DeviceAssistanceTodoSummary = z.infer<typeof deviceAssistanceTodoSummarySchema>;
export const recordDeviceAssistanceNoteRequestSchema = z.strictObject({ metadata: requestMetadataSchema,
  todoId: uuidSchema, expectedFactVersion: z.int().min(0), kind: z.enum(["note", "reported_processed"]), text: projectLabelSchema });
export const recordDeviceAssistanceNoteResponseSchema = z.strictObject({ todo: deviceAssistanceTodoSummarySchema });
// Provider sees their own item identity and progress, not operator responsibility,
// other providers, raw device errors, internal notes or notification configuration.
export const providerDeviceAssistanceTodoSummarySchema = z.strictObject({
  todoId: deviceAssistanceTodoSummarySchema.shape.todoId, originScope: deviceAssistanceTodoSummarySchema.shape.originScope,
  kind: deviceAssistanceTodoSummarySchema.shape.kind, status: deviceAssistanceTodoSummarySchema.shape.status,
  factVersion: deviceAssistanceTodoSummarySchema.shape.factVersion, impactCount: deviceAssistanceTodoSummarySchema.shape.impactCount,
  noteCount: deviceAssistanceTodoSummarySchema.shape.noteCount, createdAt: assistanceTimestampSchema, updatedAt: assistanceTimestampSchema,
}).superRefine((v, ctx) => {
  if (v.status === "awaiting_recheck" && v.noteCount === 0) ctx.addIssue({ code: "custom", message: "Recheck status needs a recorded processing report" });
  if (assistanceTimestampSchema.safeParse(v.createdAt).success && assistanceTimestampSchema.safeParse(v.updatedAt).success && compareTimestamps(v.updatedAt, v.createdAt) === -1) ctx.addIssue({ code: "custom", message: "Assistance update predates creation" });
});
export const providerDeviceAssistanceImpactSchema = z.strictObject({
  deviceId: uuidSchema,
  deviceLabel: z.string().min(1).max(100),
  // Historical device fact version captured by the event producer, not a
  // current device-health or live-check result.
  recordedDeviceVersion: z.int().min(0),
});
export const providerDeviceAssistanceTodoSchema = providerDeviceAssistanceTodoSummarySchema.extend({
  impacts: z.array(providerDeviceAssistanceImpactSchema),
}).superRefine((v, ctx) => {
  if (new Set(v.impacts.map(i => i.deviceId.toLowerCase())).size !== v.impacts.length) {
    ctx.addIssue({ code: "custom", message: "Assistance impacts cannot repeat device identities" });
  }
});
export const listProviderDeviceAssistanceTodosResponseSchema = z.strictObject({ todos: z.array(providerDeviceAssistanceTodoSchema).max(50), nextAfterTodoId: uuidSchema.nullable() })
  .superRefine((v, ctx) => {
    if (new Set(v.todos.map(t => t.todoId.toLowerCase())).size !== v.todos.length
      || (v.nextAfterTodoId !== null && v.nextAfterTodoId.toLowerCase() !== v.todos.at(-1)?.todoId.toLowerCase())) ctx.addIssue({ code: "custom", message: "Assistance page cursor or identity is inconsistent" });
  });
export const deviceAssistanceNoteViewSchema = z.strictObject({ noteId: uuidSchema, actorId: uuidSchema, kind: z.enum(["note", "reported_processed"]), text: projectLabelSchema, recordedAt: assistanceTimestampSchema });
export const operatorAssistanceTodoDetailResponseSchema = z.strictObject({
  todo: deviceAssistanceTodoSummarySchema,
  recheck: z.strictObject({
    status: z.enum(["not_requested", "pending", "verified_recovered", "still_blocked", "unknown"]),
    blockers: z.array(z.string().min(1).max(120)).max(32),
    checkedAt: assistanceTimestampSchema.nullable(),
  }),
}).superRefine((value, ctx) => {
  const r = value.recheck;
  if (r.status === "verified_recovered" && (r.blockers.length > 0 || r.checkedAt === null)) ctx.addIssue({ code: "custom", message: "Recovered status needs a trusted check time and no blockers" });
  if ((r.status === "unknown" || r.status === "still_blocked") && (r.blockers.length === 0 || r.checkedAt === null)) ctx.addIssue({ code: "custom", message: "Unresolved recheck needs blockers and a check time" });
  if (r.status === "not_requested" && (r.blockers.length > 0 || r.checkedAt !== null)) ctx.addIssue({ code: "custom", message: "Unrequested recheck has no result facts" });
});
export type OperatorAssistanceTodoDetailResponse = z.infer<typeof operatorAssistanceTodoDetailResponseSchema>;
export const listDeviceAssistanceNotesResponseSchema = z.strictObject({ todo: deviceAssistanceTodoSummarySchema, notes: z.array(deviceAssistanceNoteViewSchema).max(50), nextAfterNoteId: uuidSchema.nullable() })
  .superRefine((v, ctx) => {
    if (new Set(v.notes.map(n => n.noteId.toLowerCase())).size !== v.notes.length || v.notes.length > v.todo.noteCount
      || (v.nextAfterNoteId !== null && v.nextAfterNoteId.toLowerCase() !== v.notes.at(-1)?.noteId.toLowerCase())) ctx.addIssue({ code: "custom", message: "Assistance notes cursor or count is inconsistent" });
    if (v.notes.some(n => compareTimestamps(n.recordedAt, v.todo.createdAt) === -1 || compareTimestamps(n.recordedAt, v.todo.updatedAt) === 1)) ctx.addIssue({ code: "custom", message: "Assistance note predates item or exceeds current update" });
  });
// Event-time impact facts only. These are not current device state or a
// readiness/verification result.
export const deviceAssistanceImpactSchema = z.strictObject({ deviceId: uuidSchema, recordedDeviceVersion: z.int().min(0), recordedAt: assistanceTimestampSchema });
export type DeviceAssistanceImpact = z.infer<typeof deviceAssistanceImpactSchema>;
export const listDeviceAssistanceImpactsResponseSchema = z.strictObject({ todoId: uuidSchema, impacts: z.array(deviceAssistanceImpactSchema).max(50), nextAfterDeviceId: uuidSchema.nullable() })
  .superRefine((v, ctx) => {
    const ids = v.impacts.map(i => i.deviceId.toLowerCase());
    if (new Set(ids).size !== ids.length || ids.some((id, index) => index > 0 && ids[index - 1]! >= id)
      || (v.nextAfterDeviceId !== null && v.nextAfterDeviceId.toLowerCase() !== ids.at(-1))) ctx.addIssue({ code: "custom", message: "Assistance impact page cursor or ordering is inconsistent" });
  });
export type ListDeviceAssistanceImpactsResponse = z.infer<typeof listDeviceAssistanceImpactsResponseSchema>;
