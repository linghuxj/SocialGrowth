import { useEffect, useRef, useState } from "react";
import type { BusinessPlanCurrentCheckBlocker } from "@socialgrowth/product-contracts";
import { ArrowClockwise, ArrowSquareOut, ClipboardText } from "@phosphor-icons/react";
import { readProjectCurrentChecks, type ProjectCurrentChecksView } from "./project-lifecycle-api.js";
import { createBusinessPlanTaskAttempt, queryBusinessPlanPreflight, readBusinessPlanWorkflow, startBusinessPlanPreflight } from "./business-plan-api.js";
import { readFact } from "./operations-facts.js";
import { ProductApiError } from "./operator-api.js";

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
function workflowLabel(state: string | undefined): string {
  if (state === "queued" || state === "claimed" || state === "running") return "检查中";
  if (state === "submission_unknown" || state === "response_unknown") return "结果未知，只查询原检查，不重复启动";
  if (state === "prepared") return "发布准备已核对，尚未发布";
  if (state === "blocked" || state === "failed") return "需要处理";
  if (state === "verified" || state === "not_published") return "已有结果，需查看原记录";
  return "尚未检查";
}

function blockerAction(destination: BlockerInfo["destination"], navigate?: (tab: ProjectTab) => void,
  openMediaAccounts?: () => void, openDevices?: () => void) {
  if (destination === "media-accounts") return openMediaAccounts;
  if (destination === "devices") return openDevices;
  return destination && navigate ? () => navigate(destination) : undefined;
}

export function TaskReadinessPanel({ projectId, active, readOnly, onExpired, refreshVersion = 0,
  onNavigate, onOpenMediaAccounts, onOpenDevices,
}: {
  projectId: string;
  active: boolean;
  readOnly: boolean;
  onExpired: (error: unknown) => void;
  refreshVersion?: number;
  onNavigate?: (tab: ProjectTab) => void;
  onOpenMediaAccounts?: () => void;
  onOpenDevices?: () => void;
}) {
  const [state, setState] = useState<ReadState>("loading");
  const [checks, setChecks] = useState<ProjectCurrentChecksView | null>(null);
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [workflowStates, setWorkflowStates] = useState<Record<string, string>>({});
  const [preflightBusy, setPreflightBusy] = useState<string | null>(null);
  const sequence = useRef(0);
  const expiredRef = useRef(onExpired);
  expiredRef.current = onExpired;

  async function refresh() {
    const current = ++sequence.current;
    setState("loading");
    setWorkflowStates({});
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
    void readBusinessPlanWorkflow(projectId).then(workflow => {
      if (current === sequence.current) setWorkflowStates(Object.fromEntries(workflow.tasks.map(task => [task.taskId.toLowerCase(), task.workflow.state])));
    }).catch(error => {
      if (current === sequence.current && error instanceof Error && "status" in error && (error as { status?: number }).status === 401) expiredRef.current(error);
      else if (current === sequence.current) setWorkflowStates(Object.fromEntries(result.value.tasks.map(task => [task.taskId.toLowerCase(), "response_unknown"])));
    });
  }

  async function startPreflight(taskId: string) {
    if (preflightBusy || !current) return;
    const currentTask = current.tasks.find(task => task.taskId.toLowerCase() === taskId.toLowerCase());
    if (!currentTask) return;
    const stateNow = workflowStates[taskId.toLowerCase()];
    setPreflightBusy(taskId);
    try {
      if (["running", "submission_unknown", "response_unknown"].includes(stateNow ?? "")) {
        const workflow = stateNow === "response_unknown" ? await readBusinessPlanWorkflow(projectId) : await queryBusinessPlanPreflight(projectId, taskId);
        setWorkflowStates(Object.fromEntries(workflow.tasks.map(task => [task.taskId.toLowerCase(), task.workflow.state])));
        await refresh();
        return;
      }
      if (!currentTask.attempt) {
        const planRevision = current.plan?.revision;
        if (!planRevision) { setWorkflowStates(value => ({ ...value, [taskId.toLowerCase()]: "blocked" })); return; }
        const attemptRequest = createBusinessPlanTaskAttempt(projectId, taskId, planRevision, currentTask.taskRevision);
        const attempt = await attemptRequest();
        if (attempt.outcome === "blocked" || attempt.attempt === null) {
          setWorkflowStates(value => ({ ...value, [taskId.toLowerCase()]: "blocked" }));
          void refresh();
          return;
        }
        await refresh();
      }
      const request = startBusinessPlanPreflight(projectId, taskId);
      const response = await request();
      setWorkflowStates(value => ({ ...value, [taskId.toLowerCase()]: response.state }));
      void refresh();
    } catch (error) {
      if (error instanceof Error && "status" in error && (error as { status?: number }).status === 401) expiredRef.current(error);
      else if (error instanceof ProductApiError && error.status >= 400 && error.status < 500 && error.status !== 408) {
        setWorkflowStates(value => ({ ...value, [taskId.toLowerCase()]: "blocked" }));
      } else setWorkflowStates(value => ({ ...value, [taskId.toLowerCase()]: "response_unknown" }));
    } finally { setPreflightBusy(null); }
  }

  useEffect(() => {
    if (!active) { sequence.current++; return; }
    void refresh();
    return () => { sequence.current++; };
    // refresh uses the current project and sequence; callback identity must not restart the read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, projectId, refreshVersion]);

  useEffect(() => {
    if (!active || !Object.values(workflowStates).some(value => ["queued", "claimed", "running", "submission_unknown"].includes(value))) return;
    const timer = setTimeout(() => {
      void readBusinessPlanWorkflow(projectId).then(workflow => setWorkflowStates(Object.fromEntries(workflow.tasks.map(task => [task.taskId.toLowerCase(), task.workflow.state])))).catch(error => {
        if (error instanceof Error && "status" in error && (error as { status?: number }).status === 401) expiredRef.current(error);
        else setWorkflowStates(value => Object.fromEntries(Object.keys(value).map(taskId => [taskId, "response_unknown"])));
      });
    }, 2500);
    return () => clearTimeout(timer);
  }, [active, projectId, workflowStates]);

  const current = loadedProjectId === projectId.toLowerCase() && checks?.projectId.toLowerCase() === projectId.toLowerCase() ? checks : null;
  return <section className="task-readiness" aria-label="计划任务当前条件" hidden={!active}>
    <div className="task-readiness__heading">
      <div><h3>任务当前条件</h3><p>逐项显示当前条件。仅已分配的 Facebook 视频任务可启动 Page 与切片发布准备核对；核对会操作手机并停在最终发布前。</p></div>
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
          const workflowState = workflowStates[task.taskId.toLowerCase()];
          return <article className="task-readiness__row" key={task.taskId}>
            <div className="task-readiness__task">
              <strong>{task.platform === "facebook" ? "Facebook" : "YouTube"} · {formLabel[task.form] ?? "成品形式未知"}</strong>
              <span>发布准备状态：{workflowLabel(workflowState)}</span>
              <span>计划 v{task.planRevision} · 任务版本 v{task.taskRevision}</span>
              <span>计划时间：{time(task.scheduledAt)} · 素材版本：v{task.expectedMaterialRevision}</span>
              <details><summary>查看任务编号</summary><code>{task.taskId}</code></details>
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
                <details><summary>查看原尝试编号与状态码</summary>
                  <span>{attempt.taskAttemptId} · {attempt.state}</span>
                  <span>startedAt：{attempt.startedAt === null ? "无（尚未开始）" : attempt.startedAt}</span>
                  <span>创建预留设备：{attempt.reservedDeviceIdAtCreation}</span>
                </details>
              </>}
              {task.platform === "facebook" && task.form === "facebook_video" && <>
                {!readOnly && <button type="button" className="outline-button" disabled={!!preflightBusy || task.blockers.some(code => !["action_inspector_unavailable","network_not_admitted","stop_unconfirmed"].includes(code)) || ["queued","claimed","prepared","verified","not_published"].includes(workflowState ?? "")}
                  onClick={() => void startPreflight(task.taskId)}>{preflightBusy === task.taskId ? "正在连接手机核对…" : ["running","submission_unknown","response_unknown"].includes(workflowState ?? "") ? "查询原核查状态" : attempt ? "检查 Page 与切片发布准备" : "创建原尝试并检查发布准备"}</button>
                }
                {workflowState === "prepared" && <strong role="status">发布准备已核对，尚未发布</strong>}
                {workflowState === "submission_unknown" && <strong role="alert">原核查结果未知，已冻结；先查询原操作，不会重发。</strong>}
                {workflowState === "response_unknown" && <strong role="alert">请求响应中断，原核查状态未知；请查询当前状态，不会重新发起。</strong>}
                {workflowState === "blocked" && <span role="status">当前仍有条件未通过；请先按上方提示处理，再重新读取。</span>}
              </>}
              <small>准备核对会读取已分配 Page、检查切片并停在最终发布前；不会创建另一次原尝试，也不会自动发布。</small>
            </div>
          </article>;
        })}
      </div>}
    </>}
  </section>;
}
