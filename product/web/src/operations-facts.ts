import { useEffect, useRef, useState } from "react";
import { ProductApiError, OperatorWriteSessionChangedError, listOperatorDeviceFacts, captureOperatorWriteSession, hasCsrfToken } from "./operator-api.js";
import { readProjectDirection } from "./project-direction-api.js";
import { readPlanningDraft } from "./project-planning-api.js";
import { readBusinessPlan } from "./business-plan-api.js";
import { readAccountPreparation } from "./account-preparation-api.js";
import { readAccountAssignments, readMediaAccounts } from "./media-accounts-api.js";
import { readProjectLifecycleIntent, readProjectCurrentChecks } from "./project-lifecycle-api.js";
import { readProjectFeedback } from "./project-feedback-api.js";

export type FactState<T> = { status: "loaded"; value: T } | { status: "unknown"; reason: "unavailable" | "unauthorized" | "stale" };
export async function readFact<T>(read: () => Promise<T>, onExpired?: (e: unknown) => void): Promise<FactState<T>> {
  const sameSession = captureOperatorWriteSession();
  try { sameSession(); const value = await read(); sameSession(); return { status: "loaded", value }; }
  catch (e) {
    if (e instanceof ProductApiError && e.status === 401) {
      try { sameSession(); } catch { if (hasCsrfToken()) return { status: "unknown", reason: "stale" }; }
      onExpired?.(e); return { status: "unknown", reason: "unauthorized" };
    }
    try { sameSession(); } catch { return { status: "unknown", reason: "stale" }; }
    return { status: "unknown", reason: e instanceof OperatorWriteSessionChangedError ? "stale" : "unavailable" };
  }
}
export async function readProjectOperationsFacts(projectId: string, onExpired?: (e: unknown) => void) {
  const [direction, planning, businessPlan, accountPreparation, accountAssignments, accounts, devices, lifecycle, feedback, currentChecks] = await Promise.all([
    readFact(() => readProjectDirection(projectId), onExpired), readFact(() => readPlanningDraft(projectId), onExpired),
    readFact(() => readBusinessPlan(projectId), onExpired), readFact(() => readAccountPreparation(projectId), onExpired),
    readFact(() => readAccountAssignments(projectId), onExpired), readFact(readMediaAccounts, onExpired),
    readFact(listOperatorDeviceFacts, onExpired), readFact(() => readProjectLifecycleIntent(projectId), onExpired),
    readFact(() => readProjectFeedback(projectId), onExpired),
    readFact(() => readProjectCurrentChecks(projectId), onExpired),
  ]);
  return { projectId, direction, planning, businessPlan, accountPreparation, accountAssignments, accounts, devices, lifecycle, feedback, currentChecks };
}
export type ProjectOperationsFacts = Awaited<ReturnType<typeof readProjectOperationsFacts>>;
export const factValue = <T,>(fact: FactState<T> | null | undefined): T | undefined => fact?.status === "loaded" ? fact.value : undefined;
export function useProjectOperationsFacts(projectId: string, active: boolean, refreshVersion: number, onExpired: (e: unknown) => void) {
  const [facts, setFacts] = useState<ProjectOperationsFacts | null>(null), [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0), expired = useRef(onExpired);
  expired.current = onExpired;
  useEffect(() => {
    if (!active) return;
    let current = true;
    setFacts(null); setLoading(true);
    void readProjectOperationsFacts(projectId, e => { if (current) expired.current(e); }).then(next => {
      if (current) { setFacts(next); setLoading(false); }
    });
    return () => { current = false; };
  }, [projectId, active, refreshVersion, version]);
  return { facts, loading, refresh: () => setVersion(v => v + 1) };
}
export function operationsRows(facts: ProjectOperationsFacts | null) {
  const direction = factValue(facts?.direction), planning = factValue(facts?.planning), plan = factValue(facts?.businessPlan);
  const allocations = factValue(facts?.accountAssignments), preparation = factValue(facts?.accountPreparation), lifecycle = factValue(facts?.lifecycle);
  const checks = factValue(facts?.currentChecks);
  return [
    { title: "方向与范围", value: !direction ? "事实待读取或读取失败" : direction.approval ? "已确认方向；执行条件仍需核验" : direction.attempt?.state === "requested" ? "模型请求处理中" : direction.proposal ? "方向已生成，等待核对确认" : "尚未确认方向", next: "查看目标与方向", tab: "settings" as const },
    { title: "项目账号与手机", value: !allocations ? "分配事实未知" : allocations.assignments.length ? `已分配 ${allocations.assignments.length} 个账号；发布身份待初始化核验` : "尚未分配账号与手机", next: "查看资源与初始化", tab: "settings" as const },
    { title: "周期与运行规则", value: !planning ? "周期草案事实未知" : planning.draftVersion ? `已保存草案 v${planning.draftVersion}；运行周期另行核验` : "周期草案尚未保存", next: "设置目标与周期", tab: "settings" as const },
    { title: "排期与任务", value: !plan ? "计划事实未知" : plan.plan ? `${plan.plan.scopeState === "current" ? "当前" : "范围已变化的历史"}计划 · ${plan.tasks.length} 个任务等待现行条件检查` : "尚无业务计划", next: "查看排期与任务", tab: "business-plan" as const },
    { title: "任务当前条件", value: !checks ? "任务条件读取失败或待读取；不能据此判断就绪" : checks.tasks.length ? `已核对 ${checks.tasks.length} 个任务，均有待处理条件；核验时间 ${new Date(checks.checkedAt).toLocaleString("zh-CN")}` : "当前没有已排期任务；先核对方向与计划", next: "查看具体条件与下一步", tab: "business-plan" as const },
    { title: "手机操作与回执", value: !preparation ? "初始化记录未知" : preparation.originalOperations.length ? `已记录 ${preparation.originalOperations.length} 个原操作；结果与证据仍需核验` : "尚无本项目手机操作记录", next: "查看初始化记录", tab: "settings" as const },
    { title: "执行与公开发布", value: !plan ? "执行许可未知；不能启动" : "执行与公开发布许可关闭；不能启动手机发布", next: "核对任务执行条件", tab: "business-plan" as const },
    { title: "暂停、恢复与结束", value: !lifecycle ? "生命周期事实未知" : lifecycle.intent === "pause_requested" ? "暂停意图已记录；实际停止需核验" : lifecycle.intent === "resume_requested" ? "恢复意图已记录；现行条件需核验" : lifecycle.intent === "end_requested" ? "结束意图已记录；收尾结果需核验" : "没有已登记的生命周期意图", next: "查看项目生命周期", tab: "lifecycle" as const },
  ];
}
export type OperationsTab = "settings" | "materials" | "business-plan" | "feedback" | "lifecycle";
