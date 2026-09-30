import { z } from "zod";
import { projectLabelSchema, requestMetadataSchema, timestampSchema, uuidSchema } from "@socialgrowth/product-contracts";
const id = uuidSchema.transform(v => v.toLowerCase());
export const assistanceEventSchema = z.strictObject({ eventId: id, occurrenceId: id, deviceId: id, expectedDeviceVersion: z.int().min(0), kind: z.literal("network_access_help") });
export const assistanceNoteRequestSchema = z.strictObject({ metadata: requestMetadataSchema, todoId: id, expectedFactVersion: z.int().min(0),
  kind: z.enum(["note", "reported_processed"]), text: projectLabelSchema });
export const assistanceTodoViewSchema = z.strictObject({ todoId: id, occurrenceId: id, providerId: id, initialResponsibleOperatorId: id,
  kind: z.literal("network_access_help"), status: z.enum(["open", "awaiting_recheck"]), factVersion: z.int().min(0),
  createdAt: timestampSchema, updatedAt: timestampSchema,
  impacts: z.array(z.strictObject({ deviceId: id, associationId: id, recordedDeviceVersion: z.int().min(0), recordedAt: timestampSchema })).min(1),
  notes: z.array(z.strictObject({ noteId: id, actorId: id, kind: z.enum(["note", "reported_processed"]), text: projectLabelSchema, recordedAt: timestampSchema })),
  notification: z.strictObject({ status: z.literal("awaiting_configuration") }),
});
export type AssistanceTodoView = z.infer<typeof assistanceTodoViewSchema>;
// Internal schemas, not HTTP/client authority. Producers must verify the actual
// human-required occurrence; normal endpoint changes must never call intake.
