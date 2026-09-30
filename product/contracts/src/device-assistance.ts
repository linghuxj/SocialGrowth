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
