import { z } from "zod";
import { compareTimestamps, requestMetadataSchema, timestampSchema, uuidSchema } from "./common.js";

// Additive operator-only project metadata. No approval/execution payload here.
// Names are single-line identifiers; rejecting control bytes is intentional.
// oxlint-disable-next-line no-control-regex
const name = z.string().min(1).max(150).regex(/^[^\s\u0000-\u001f\u007f\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff](?:[^\u0000-\u001f\u007f]*[^\s\u0000-\u001f\u007f\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff])?$/);
export const projectBasicsSchema = z.strictObject({
  name, kind: z.enum(["company_owned", "client_managed"]),
  customerName: name.nullable(), ownerOperatorId: uuidSchema.nullable(),
  notificationEmail: z.email().max(254).nullable(),
}).superRefine((value, context) => {
  if (value.kind === "client_managed" && value.customerName === null) context.addIssue({ code: "custom", path: ["customerName"], message: "Client-managed projects require a customer" });
  if (value.kind === "company_owned" && value.customerName !== null) context.addIssue({ code: "custom", path: ["customerName"], message: "Company projects do not have a managed customer" });
});
export const projectViewSchema = z.strictObject({
  ...projectBasicsSchema.shape, projectId: uuidSchema, factVersion: z.int().min(0),
  phase: z.literal("preparing"), createdByOperatorId: uuidSchema,
  createdAt: timestampSchema, updatedAt: timestampSchema,
}).superRefine((value, context) => {
  const basics = { name: value.name, kind: value.kind, customerName: value.customerName,
    ownerOperatorId: value.ownerOperatorId, notificationEmail: value.notificationEmail };
  if (!projectBasicsSchema.safeParse(basics).success) context.addIssue({ code: "custom", message: "Project basics are inconsistent" });
  if (timestampSchema.safeParse(value.createdAt).success && timestampSchema.safeParse(value.updatedAt).success
    && compareTimestamps(value.updatedAt, value.createdAt) === -1) context.addIssue({ code: "custom", path: ["updatedAt"], message: "Update precedes creation" });
});
export const createProjectRequestSchema = z.strictObject({ metadata: requestMetadataSchema, basics: projectBasicsSchema });
export const updateProjectRequestSchema = z.strictObject({ metadata: requestMetadataSchema, projectId: uuidSchema, expectedFactVersion: z.int().min(0), basics: projectBasicsSchema });
export const projectResponseSchema = z.strictObject({ project: projectViewSchema });
export const listProjectsResponseSchema = z.strictObject({ projects: z.array(projectViewSchema) });
export type ProjectBasics = z.infer<typeof projectBasicsSchema>;
export type ProjectView = z.infer<typeof projectViewSchema>;
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;
