import { useEffect, useRef, useState } from "react";
import type { BusinessPlanCurrentCheckBlocker } from "@socialgrowth/product-contracts";
import { ArrowClockwise, ArrowSquareOut, ClipboardText } from "@phosphor-icons/react";
import { readProjectCurrentChecks, type ProjectCurrentChecksView } from "./project-lifecycle-api.js";
import { readFact } from "./operations-facts.js";
import "./task-readiness-panel.css";

type ProjectTab = "settings" | "materials" | "lifecycle";
type ReadState = "loading" | "loaded" | "failed" | "unauthorized" | "stale";
type BlockerInfo = { label: string; next: string; destination?: ProjectTab | "media-accounts" | "devices" };

const formLabel: Record<string, string> = {
  facebook_video: "Facebook 视频", facebook_image_text: "Facebook 图文",
  youtube_shorts: "YouTube Shorts", youtube_video: "YouTube 视频",
};

const blockerInfo: Record<BusinessPlanCurrentCheckBlocker, BlockerInfo> = {
  plan_missing: { label: "当前没有有效排期", next: "先核对项目范围与方向，再生成排期。", destination: "settings" },
  task_missing: { label: "任务记录缺失", next: "刷新当前检查；仍缺失时回到排期与任务核对。", destination: "settings" },
  plan_stale: { label: "排期使用了较早范围", next: "核对设置和已确认方向，然后重新安排。", destination: "settings" },
  project_scope_changed: { label: "项目范围已变化", next: "核对当前设置与批准范围。", destination: "settings" },
  material_missing: { label: "当前素材文件缺失", next: "查看素材及版本，补齐本任务需要的文件。", destination: "materials" },
  material_revision_changed: { label: "素材版本已变化", next: "核对当前素材版本与本任务引用版本。", destination: "materials" },
  material_not_eligible: { label: "素材尚未满足准入条件", next: "查看素材检查结果和仍需补充的资料。", destination: "materials" },
  material_withdrawn: { label: "本任务引用的素材已撤回", next: "核对素材状态，再决定是否重新安排。", destination: "materials" },
  project_pause_requested: { label: "项目暂停请求待核对", next: "查看项目生命周期记录与当前状态。", destination: "lifecycle" },
  project_resume_requested: { label: "项目恢复请求待核对", next: "查看项目生命周期记录与当前状态。", destination: "lifecycle" },
  project_end_requested: { label: "项目结束请求待核对", next: "查看项目生命周期记录；结束请求可能取消未开始任务。", destination: "lifecycle" },
  task_cancelled_before_start: { label: "任务已在开始前取消", next: "核对取消来源与任务关联，再决定是否重新安排。", destination: "lifecycle" },
  identity_reservation_missing: { label: "发布身份预留缺失", next: "核对项目账号分配与目标身份。", destination: "media-accounts" },
  attempt_assignment_stale: { label: "原尝试的设备分配已过期", next: "核对当前账号与设备分配，保留原尝试供查阅。", destination: "media-accounts" },
  device_association_missing: { label: "任务没有当前设备关联", next: "核对项目设备分配和设备记录。", destination: "devices" },
  installation_missing: { label: "当前设备安装事实缺失", next: "查看设备详情与初始化记录。", destination: "devices" },
  device_paused: { label: "设备参与状态为暂停", next: "在设备页面核对当前参与状态。", destination: "devices" },
  stop_unconfirmed: { label: "原设备操作停止状态未确认", next: "先核对原操作及停止回执，不要把未知当作已停止。", destination: "devices" },
  participation_missing: { label: "当前设备参与确认缺失", next: "在设备页面核对本机当前参与确认。", destination: "devices" },
  network_not_admitted: { label: "设备网络准入尚未确认", next: "核对设备当前网络路径及网络准入记录。", destination: "devices" },
  action_inspector_unavailable: { label: "当前检查器不可用", next: "稍后重新读取当前检查；没有检查结果不代表条件通过。" },
  current_fact_unknown: { label: "一项或多项当前事实未知", next: "重新读取当前检查；未知状态不会按就绪处理。" },
};

function time(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未知" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function fact(value: string | number | boolean | null): string {
  if (value === null) return "未知 / 未返回";
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
}

function blockerAction(destination: BlockerInfo["destination"], navigate?: (tab: ProjectTab) => void,
  openMediaAccounts?: () => void, openDevices?: () => void) {
  if (destination === "media-accounts") return openMediaAccounts;
  if (destination === "devices") return openDevices;
  return destination && navigate ? () => navigate(destination) : undefined;
}

export function TaskReadinessPanel({ projectId, active, onExpired, refreshVersion = 0,
  onNavigate, onOpenMediaAccounts, onOpenDevices,
}: {
  projectId: string;
  active: boolean;
  onExpired: (error: unknown) => void;
  refreshVersion?: number;
  onNavigate?: (tab: ProjectTab) => void;
  onOpenMediaAccounts?: () => void;
  onOpenDevices?: () => void;
}) {
  const [state, setState] = useState<ReadState>("loading");
  const [checks, setChecks] = useState<ProjectCurrentChecksView | null>(null);
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const sequence = useRef(0);
  const expiredRef = useRef(onExpired);
  expiredRef.current = onExpired;

  async function refresh() {
    const current = ++sequence.current;
    setState("loading");
    const result = await readFact(() => readProjectCurrentChecks(projectId), error => {
      if (current === sequence.current) expiredRef.current(error);
    });
    if (current !== sequence.current) return;
    setLoadedProjectId(projectId.toLowerCase());
    if (result.status === "unknown") {
      setState(result.reason === "unauthorized" ? "unauthorized" : result.reason === "stale" ? "stale" : "failed");
      return;
    }
    if (result.value.projectId.toLowerCase() !== projectId.toLowerCase()) {
      setState("failed");
      return;
    }
    setChecks(result.value);
    setState("loaded");
  }

  useEffect(() => {
    if (!active) { sequence.current++; return; }
    void refresh();
    return () => { sequence.current++; };
    // refresh uses the current project and sequence; callback identity must not restart the read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, projectId, refreshVersion]);

  const current = loadedProjectId === projectId.toLowerCase() && checks?.projectId.toLowerCase() === projectId.toLowerCase() ? checks : null;
  return <section className="task-readiness" aria-label="计划任务当前条件" hidden={!active}>
    <div className="task-readiness__heading">
      <div><h3>任务当前条件</h3><p>逐项显示本次读取时的条件、阻断原因与可前往的处理页面。页面只读取核验，不会启动手机或发布内容。</p></div>
      <button type="button" className="outline-button" onClick={() => void refresh()} disabled={state === "loading"}>
        <ArrowClockwise size={17} />{state === "loading" ? "读取中…" : "重新读取条件"}
      </button>
    </div>
    {state === "loading" && <p className="task-readiness__state" role="status">正在读取本项目的任务条件；读取完成前不判断任务是否就绪。若下方仍显示上次结果，它只代表上次检查时的状态。</p>}
    {state === "failed" && <div className="task-readiness__state task-readiness__state--error" role="alert">
      <p>当前条件读取失败，任务是否就绪未知。请重试；读取失败不代表没有阻断。</p>
      <button type="button" className="outline-button" onClick={() => void refresh()}>重试读取</button>
    </div>}
    {state === "unauthorized" && <p className="task-readiness__state task-readiness__state--error" role="alert">登录状态已失效，当前条件未读取。请重新登录后查看。</p>}
    {state === "stale" && <p className="task-readiness__state task-readiness__state--error" role="alert">读取期间登录会话已变化，本次响应没有用于更新当前状态。请重新读取。</p>}
    {current && <>
      {state !== "loaded" && <p className="task-readiness__stale" role="status">以下是历史检查结果（检查于 {time(current.checkedAt)}），当前条件未知；请读取成功后再判断。</p>}
      <div className="task-readiness__summary">
        <span>检查时间：{time(current.checkedAt)}（当时）</span>
        <span>排期：{current.plan ? `v${current.plan.revision}` : "未读取到当前排期"}</span>
        <span>任务：{current.tasks.length} 项</span>
        <strong>执行许可：关闭 · 发布许可：关闭</strong>
      </div>
      {!current.tasks.length ? <div className="task-readiness__empty">
        <ClipboardText size={20} /><p>{current.plan ? "当前排期没有任务记录。" : "当前没有排期与任务记录。"}没有任务可核验，也不代表项目已就绪。</p>
      </div> : <div className="task-readiness__list">
        {current.tasks.map(task => {
          const attempt = task.attempt;
          const assignment = attempt?.assignmentRelation === "current" ? "创建时设备预留与当前分配一致"
            : attempt?.assignmentRelation === "stale" ? "创建时设备预留已过期"
              : attempt ? "创建时设备预留关系未知" : "尚无原尝试记录";
          const mismatch = current.plan !== null && (task.planId.toLowerCase() !== current.plan.planId.toLowerCase()
            || task.planRevision !== current.plan.revision);
          const blockerEntries = task.blockers.map(code => ({ code, ...blockerInfo[code] }));
          return <article className="task-readiness__row" key={task.taskId}>
            <div className="task-readiness__task">
              <strong>{task.platform === "facebook" ? "Facebook" : "YouTube"} · {formLabel[task.form] ?? "成品形式未知"}</strong>
              <span>任务 {task.taskId} · 计划 v{task.planRevision} · 任务版本 v{task.taskRevision}</span>
              <span>计划时间：{time(task.scheduledAt)} · 素材版本：v{task.expectedMaterialRevision}</span>
            </div>
            <div className="task-readiness__conditions">
              {mismatch && <p className="task-readiness__stale">任务引用的计划与本次读取的当前计划版本不一致；请先核对最新计划。</p>}
              <strong>{task.blockers.length ? `${task.blockers.length} 项条件未通过或未知` : "当前检查没有返回阻断项"}</strong>
              {blockerEntries.map(({ code, label, next, destination }) => {
                const action = blockerAction(destination, onNavigate, onOpenMediaAccounts, onOpenDevices);
                return <div className="task-readiness__blocker" key={code}>
                  <p><b>{label}</b><span>{next}</span></p>
                  {action && <button type="button" className="text-button" onClick={action}>{destination === "media-accounts" ? "查看账号分配" : destination === "devices" ? "查看设备" : "前往处理"}<ArrowSquareOut size={14} /></button>}
                </div>;
              })}
              <details className="task-readiness__facts">
                <summary>查看本次返回的条件值</summary>
                <p>以下是 {time(current.checkedAt)} 的读取快照。字段为“未知 / 未返回”时，不推断为通过。</p>
                <dl>
                  <div><dt>任务批准范围版本</dt><dd>{task.current.projectVersion === null ? "未知 / 未返回" : `v${task.current.projectVersion}`}</dd></div>
                  <div><dt>本次批准记录</dt><dd>{fact(task.current.approvalId)}</dd></div>
                  <div><dt>任务预留发布身份</dt><dd>{task.identityId}</dd></div>
                  <div><dt>素材修订（预期 / 当前）</dt><dd>{fact(task.expectedMaterialRevision)} / {fact(task.current.materialRevision)}</dd></div>
                  <div><dt>素材状态 / 候选资格</dt><dd>{fact(task.current.materialStatus)} / {fact(task.current.materialCandidateAllowed)}</dd></div>
                  <div><dt>当前素材文件</dt><dd>{task.currentFiles === null ? "未知 / 未返回" : `${task.currentFiles.length} 个文件`}</dd></div>
                  <div><dt>撤回状态</dt><dd>{fact(task.current.materialWithdrawn)}</dd></div>
                  <div><dt>设备分配（预留 / 当前）</dt><dd>{attempt?.reservedDeviceIdAtCreation ?? "无原尝试预留"} / {fact(task.current.reservedDeviceId)}</dd></div>
                  <div><dt>设备关联当前有效</dt><dd>{fact(task.current.associationCurrent)}</dd></div>
                  <div><dt>设备安装代次</dt><dd>{fact(task.current.installationGeneration)}</dd></div>
                  <div><dt>设备控制 / 停止确认</dt><dd>{fact(task.current.controlIntent)} / {fact(task.current.controlStop)}</dd></div>
                  <div><dt>项目生命周期请求</dt><dd>{fact(task.current.projectLifecycleIntent)}</dd></div>
                  <div><dt>本机参与确认 / 网络准入</dt><dd>{fact(task.current.participationCurrent)} / {fact(task.current.networkAdmitted)}</dd></div>
                  <div><dt>较早影响记录</dt><dd>{task.impactReferences.length} 项</dd></div>
                </dl>
              </details>
            </div>
            <div className="task-readiness__attempt">
              <strong>{attempt ? "原尝试记录" : "尚无原尝试"}</strong>
              <span>{assignment}</span>
              {attempt && <>
                <span>尝试 {attempt.taskAttemptId} · {attempt.state === "pending_current_checks" ? "待当前条件核验" : attempt.state}</span>
                <span>startedAt：{attempt.startedAt === null ? "无（尚未开始）" : attempt.startedAt}</span>
                <span>创建预留设备：{attempt.reservedDeviceIdAtCreation}</span>
              </>}
              <small>本检查不创建新尝试，不派发设备任务。所有任务的执行与发布许可仍关闭。</small>
            </div>
          </article>;
        })}
      </div>}
    </>}
  </section>;
}
