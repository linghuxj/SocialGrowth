import { z } from "zod";
import { centralPublicationTaskSchema } from "./task-dispatch.js";
import { uuidSchema } from "./common.js";
// Structure only: this contract does not establish current task authority,
// physical fencing, source rights or file preparation on a real phone.
export const artemisPreflightAssignmentSchema = z.strictObject({ task: centralPublicationTaskSchema,
  serial: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/).refine(v => !v.startsWith("emulator-")),
  platformIdentity: z.string().min(1).max(256),
  media: z.array(z.strictObject({ objectId: uuidSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/), path: z.string().regex(/^\/sdcard\/(?:Movies|Pictures)\/SocialGrowth\/[a-f0-9]{64}\.(?:mp4|png|jpg|webp)$/) })).min(1).max(20),
}).superRefine((v, ctx) => {
  if (v.media.length !== v.task.objects.length || v.media.some((m, i) => m.objectId.toLowerCase() !== v.task.objects[i]!.objectId.toLowerCase()
    || m.sha256 !== v.task.objects[i]!.sha256 || !m.path.split("/").at(-1)!.startsWith(`${m.sha256}.`))) ctx.addIssue({ code: "custom", message: "Prepared objects do not match ordered task versions" });
});
export const artemisPreflightObservationSchema = z.strictObject({ traceId: uuidSchema.nullable(),
  state: z.enum(["running", "launch_unknown", "reported_ready", "needs_human", "result_unknown", "stop_unconfirmed"]),
  publicationState: z.literal("unverified"), publicationAllowed: z.literal(false), evidenceIds: z.array(uuidSchema).max(20),
}).refine(v => new Set(v.evidenceIds.map(id => id.toLowerCase())).size === v.evidenceIds.length
  && (v.traceId !== null || v.state === "launch_unknown") && (!["reported_ready", "needs_human"].includes(v.state) || v.evidenceIds.length > 0), "Observation provenance is inconsistent");
export type ArtemisPreflightAssignment = z.infer<typeof artemisPreflightAssignmentSchema>;
export type PreflightObservation = z.infer<typeof artemisPreflightObservationSchema>;
export interface ArtemisPreflightJournal {
  claim(assignment: ArtemisPreflightAssignment, fingerprint: string): Promise<{ state: "new" } | { state: "existing"; traceId: string | null }>;
  read(assignment: ArtemisPreflightAssignment, fingerprint: string): Promise<{ traceId: string | null } | null>;
  bindTrace(taskAttemptId: string, fingerprint: string, traceId: string): Promise<void>;
  record(taskAttemptId: string, fingerprint: string, observation: PreflightObservation): Promise<void>;
}
