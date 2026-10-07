import { z } from "zod";
import { compareTimestamps, projectPlanningInputsSchema, timestampSchema, uuidSchema } from "@socialgrowth/product-contracts";
const id = uuidSchema.transform(v => v.toLowerCase());
const time = timestampSchema.refine(v => !v.startsWith("0000-"));
const cycleSchema = z.strictObject({ cycleId: id, projectId: id, configVersion: z.int().min(1), businessTimeZone: projectPlanningInputsSchema.shape.businessTimeZone.unwrap(),
  startsAt: time, endsAt: time, trafficMinimum: z.int().min(0) }).refine(v => compareTimestamps(v.startsAt, v.endsAt)! < 0);
const taskSchema = z.strictObject({ taskId: id, projectId: id, contentUnitId: id, platform: z.enum(["facebook", "youtube"]), plannedCycleId: id.nullable(),
  trafficPath: z.enum(["verified", "unknown", "unavailable"]), trafficEvidenceId: id.nullable(),
  publicationState: z.enum(["verified", "pending", "failed", "not_submitted"]), publicationId: id.nullable(), publicationEvidenceId: id.nullable(),
  publishedAt: time.nullable(), verifiedAt: time.nullable(),
}).refine(v => (v.trafficPath === "verified") === (v.trafficEvidenceId !== null)
  && (v.publicationState === "verified" ? v.publicationId !== null && v.publicationEvidenceId !== null && v.verifiedAt !== null : v.publicationEvidenceId === null && v.verifiedAt === null)
  && !(v.publishedAt && v.verifiedAt && compareTimestamps(v.publishedAt, v.verifiedAt)! > 0));
export type ProjectCycle = z.infer<typeof cycleSchema>;
export type CycleTaskFact = z.infer<typeof taskSchema>;
export class ProjectCycleError extends Error {
  constructor(readonly code: "INPUT_INVALID" | "CORRUPT_CYCLES" | "CYCLE_ID_REUSED" | "BOUNDARY_STALE" | "CORRUPT_TASKS") { super(code); }
}
function fail(code: ProjectCycleError["code"]): never { throw new ProjectCycleError(code); }
const configurationConsistent = (previous: ProjectCycle, next: ProjectCycle) => next.configVersion >= previous.configVersion
  && (next.configVersion !== previous.configVersion || (next.businessTimeZone === previous.businessTimeZone && next.trafficMinimum === previous.trafficMinimum));
// INTERNAL ONLY: consume actual frozen instants from a future approved calendar
// producer. This does not generate IANA/DST boundaries or approve configuration.
export function parseProjectCycles(input: unknown): ProjectCycle[] {
  const parsed = z.array(cycleSchema).safeParse(input); if (!parsed.success) return fail("CORRUPT_CYCLES");
  const rows = parsed.data, ids = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (ids.has(row.cycleId) || (i && (row.projectId !== rows[0]!.projectId || !configurationConsistent(rows[i - 1]!, row) || compareTimestamps(row.startsAt, rows[i - 1]!.endsAt) !== 0))) fail("CORRUPT_CYCLES");
    ids.add(row.cycleId);
  }
  return rows;
}
export function appendProjectCycle(history: unknown, input: unknown, expectedPreviousCycleId: string | null): { cycles: ProjectCycle[]; changed: boolean } {
  const rows = parseProjectCycles(history), parsed = cycleSchema.safeParse(input), previous = id.nullable().safeParse(expectedPreviousCycleId);
  if (!parsed.success || !previous.success) return fail("INPUT_INVALID");
  const row = parsed.data, old = rows.find(v => v.cycleId === row.cycleId);
  if (old) {
    if (JSON.stringify(old) !== JSON.stringify(row)) return fail("CYCLE_ID_REUSED");
    return { cycles: rows, changed: false };
  }
  if ((rows.at(-1)?.cycleId ?? null) !== previous.data || (rows.length && (row.projectId !== rows[0]!.projectId || compareTimestamps(row.startsAt, rows.at(-1)!.endsAt) !== 0 || !configurationConsistent(rows.at(-1)!, row)))) return fail("BOUNDARY_STALE");
  rows.push(row); return { cycles: rows, changed: true };
}
// Central task/path/publication evidence must be verified before this pure
// projection. UUIDs and these flags are shapes, not trusted evidence or permits.
export function evaluateProjectCycles(cycles: unknown, tasks: unknown, evaluatedAt: string) {
  const rows = parseProjectCycles(cycles), parsed = z.array(taskSchema).safeParse(tasks), clock = time.safeParse(evaluatedAt);
  if (!clock.success) return fail("INPUT_INVALID");
  if (!rows.length || !parsed.success) return fail("CORRUPT_TASKS");
  const unique = new Map<string, CycleTaskFact>(), contentSlots = new Map<string, string>(), publications = new Set<string>();
  for (const row of parsed.data) {
    if (row.projectId !== rows[0]!.projectId || (row.plannedCycleId && !rows.some(v => v.cycleId === row.plannedCycleId))) fail("CORRUPT_TASKS");
    const old = unique.get(row.taskId);
    if (old) { if (JSON.stringify(old) !== JSON.stringify(row)) fail("CORRUPT_TASKS"); continue; }
    const slot = `${row.contentUnitId}/${row.platform}`;
    if (contentSlots.has(slot) || (row.publicationId && publications.has(row.publicationId))) fail("CORRUPT_TASKS");
    contentSlots.set(slot, row.taskId); if (row.publicationId) publications.add(row.publicationId); unique.set(row.taskId, row);
  }
  const facts = [...unique.values()], reports = rows.map(cycle => ({ cycleId: cycle.cycleId, projectId: cycle.projectId, configVersion: cycle.configVersion,
    startsAt: cycle.startsAt, endsAt: cycle.endsAt, businessTimeZone: cycle.businessTimeZone, trafficMinimum: cycle.trafficMinimum,
    evaluationStage: compareTimestamps(clock.data, cycle.startsAt)! < 0 ? "not_started" : compareTimestamps(clock.data, cycle.endsAt)! < 0 ? "in_progress" : "ended",
    plannedTaskIds: facts.filter(v => v.plannedCycleId === cycle.cycleId && v.trafficPath === "verified").map(v => v.taskId).sort(),
    failedTaskIds: facts.filter(v => v.plannedCycleId === cycle.cycleId && v.publicationState === "failed").map(v => v.taskId).sort(),
    verificationPendingTaskIds: facts.filter(v => v.plannedCycleId === cycle.cycleId && (v.publicationState === "pending" || (v.verifiedAt && compareTimestamps(v.verifiedAt, clock.data)! > 0))).map(v => v.taskId).sort(),
    notSubmittedTaskIds: facts.filter(v => v.plannedCycleId === cycle.cycleId && v.publicationState === "not_submitted").map(v => v.taskId).sort(),
    trafficPathPendingTaskIds: facts.filter(v => v.plannedCycleId === cycle.cycleId && v.trafficPath !== "verified").map(v => v.taskId).sort(),
    completedTaskIds: facts.filter(v => v.trafficPath === "verified" && v.publicationState === "verified" && v.publishedAt && v.verifiedAt
      && compareTimestamps(v.verifiedAt, clock.data)! <= 0 && compareTimestamps(v.publishedAt, cycle.startsAt)! >= 0 && compareTimestamps(v.publishedAt, cycle.endsAt)! < 0).map(v => v.taskId).sort(),
  })).map(v => ({ ...v, plannedCount: v.plannedTaskIds.length, completedCount: v.completedTaskIds.length, deficit: Math.max(0, v.trafficMinimum - v.completedTaskIds.length) }));
  return { reports, evaluatedAt: clock.data,
    pendingAttributionTaskIds: facts.filter(v => v.publicationState === "verified" && v.trafficPath === "verified" && (!v.publishedAt || (v.verifiedAt && compareTimestamps(v.verifiedAt, clock.data)! > 0)
      || !rows.some(c => v.publishedAt && compareTimestamps(v.publishedAt, c.startsAt)! >= 0 && compareTimestamps(v.publishedAt, c.endsAt)! < 0))).map(v => v.taskId).sort() };
}
