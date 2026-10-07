import { emptyProjectPlanningInputs, projectPlanningInputsSchema, type ProjectPlanningInputs } from "@socialgrowth/product-contracts";
export const textFields = ["preOpeningGoal", "postOpeningGoal", "contentRules"] as const;
export const numberFields = ["reviewIntervalDays", "trafficMinimumPerCycle", "observationWindowHours", "tailObservationDays", "maxPublicationsPerDay"] as const;
export type PlanningForm = Record<(typeof textFields)[number] | (typeof numberFields)[number] | "targetCountries" | "targetLanguages" | "businessTimeZone" | "firstCycleStartsAt" | "windowStart" | "windowEnd", string>
  & { postOpeningPriority: "" | NonNullable<ProjectPlanningInputs["postOpeningPriority"]>; contentForms: ProjectPlanningInputs["contentForms"] };
export function planningFormOf(v: ProjectPlanningInputs = emptyProjectPlanningInputs()): PlanningForm {
  return { preOpeningGoal: v.preOpeningGoal ?? "", postOpeningGoal: v.postOpeningGoal ?? "", contentRules: v.contentRules ?? "",
    postOpeningPriority: v.postOpeningPriority ?? "", targetCountries: v.targetCountries.join(", "), targetLanguages: v.targetLanguages.join(", "), contentForms: [...v.contentForms],
    businessTimeZone: v.businessTimeZone ?? "", firstCycleStartsAt: v.firstCycleStartsAt ?? "", windowStart: v.publishingWindow?.startsAt ?? "", windowEnd: v.publishingWindow?.endsAt ?? "",
    reviewIntervalDays: v.reviewIntervalDays?.toString() ?? "", trafficMinimumPerCycle: v.trafficMinimumPerCycle?.toString() ?? "", observationWindowHours: v.observationWindowHours?.toString() ?? "",
    tailObservationDays: v.tailObservationDays?.toString() ?? "", maxPublicationsPerDay: v.maxPublicationsPerDay?.toString() ?? "" };
}
export function planningInputOf(f: PlanningForm): ProjectPlanningInputs {
  const number = (v: string) => {
    if (v === "") return null;
    if (!/^(0|[1-9][0-9]*)$/.test(v) || !Number.isSafeInteger(Number(v))) throw new Error("PLANNING_NUMBER_INVALID");
    return Number(v);
  };
  const list = (s: string) => s === "" ? [] : s.split(/[,，\n]/).map(v => v.trim());
  return projectPlanningInputsSchema.parse({ preOpeningGoal: f.preOpeningGoal || null, postOpeningGoal: f.postOpeningGoal || null, contentRules: f.contentRules || null,
    postOpeningPriority: f.postOpeningPriority || null, targetCountries: list(f.targetCountries), targetLanguages: list(f.targetLanguages), contentForms: f.contentForms,
    businessTimeZone: f.businessTimeZone || null, firstCycleStartsAt: f.firstCycleStartsAt || null,
    publishingWindow: f.windowStart || f.windowEnd ? { startsAt: f.windowStart, endsAt: f.windowEnd } : null,
    reviewIntervalDays: number(f.reviewIntervalDays), trafficMinimumPerCycle: number(f.trafficMinimumPerCycle), observationWindowHours: number(f.observationWindowHours),
    tailObservationDays: number(f.tailObservationDays), maxPublicationsPerDay: number(f.maxPublicationsPerDay) });
}
