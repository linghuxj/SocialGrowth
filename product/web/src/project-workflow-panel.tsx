import { ArrowClockwise, ArrowSquareOut, ClipboardText, FileText, LinkSimple, Robot } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { BusinessPlanWorkflowResponse, OperatorAssistanceTodoDetailResponse, ProjectFeedbackResponse } from "@socialgrowth/product-contracts";
import { ProductApiError } from "./operator-api.js";
import { readFact } from "./operations-facts.js";
import { readProjectFeedback } from "./project-feedback-api.js";
import { readAssistanceTodoDetail, readProjectWorkflow } from "./workflow-api.js";

type ProjectTab = "settings" | "materials" | "business-plan" | "feedback" | "lifecycle";
type BlockerDestination = ProjectTab | "media-accounts" | "devices";
type LoadState = "loading" | "loaded" | "failed" | "unauthorized" | "stale";
type DetailFact = { status: "loaded"; value: OperatorAssistanceTodoDetailResponse } | { status: "unknown" };

const workflowLabels: Record<BusinessPlanWorkflowResponse["tasks"][number]["workflow"]["state"], string> = {
  blocked: "当前有条件阻断",
  queued: "等待系统调度",
  claimed: "执行端已领取",
  running: "任务执行中",
  submission_unknown: "提交结果待核实",
  verified: "可信结果核验已完成",
  not_published: "可信核验为未发布",
  failed: "执行失败",
};

const operationLabels: Record<NonNullable<BusinessPlanWorkflowResponse["tasks"][number]["operation"]>["state"], string> = {
  queued: "已创建，等待调度",
  claimed: "执行端已领取",
  running: "执行进行中",
  submission_unknown: "提交结果未知，需核实原操作",
  verified: "可信核验已完成",
  not_published: "已核验未发布",
  failed: "执行失败",
};

const recheckLabels: Record<OperatorAssistanceTodoDetailResponse["recheck"]["status"], string> = {
  not_requested: "尚未请求系统复核",
  pending: "复核请求已排队或认领；尚未证明系统开始执行",
  verified_recovered: "可信端已核验并接续原任务",
  still_blocked: "系统复核后仍有阻断",
  unknown: "复核结果未知",
};

const platformLabel: Record<BusinessPlanWorkflowResponse["tasks"][number]["platform"], string> = {
  facebook: "Facebook",
  youtube: "YouTube",
};

const formLabel: Record<BusinessPlanWorkflowResponse["tasks"][number]["form"], string> = {
  facebook_video: "视频",
  facebook_image_text: "图文",
  youtube_shorts: "Shorts",
  youtube_video: "常规视频",
};

const blockerMessages: Record<string, { title: string; next: string; destination?: BlockerDestination }> = {
  plan_missing: { title: "当前没有有效排期", next: "核对项目范围与方向，再生成排期。", destination: "settings" },
  task_missing: { title: "任务记录缺失", next: "重新读取任务事实；仍缺失时核对计划与任务记录。", destination: "business-plan" },
  plan_stale: { title: "排期范围已变化", next: "核对当前设置与方向，再更新尚未开始的安排。", destination: "settings" },
  project_scope_changed: { title: "项目范围已变化", next: "核对当前批准范围。", destination: "settings" },
  material_missing: { title: "素材文件缺失", next: "打开素材及版本，检查任务关联文件是否齐全。", destination: "materials" },
  material_revision_changed: { title: "素材版本已变化", next: "核对本任务引用版本与当前素材版本。", destination: "materials" },
  material_not_eligible: { title: "素材尚未满足准入条件", next: "查看素材检查结果并补齐缺项。", destination: "materials" },
  material_withdrawn: { title: "任务引用素材已撤回", next: "核对素材状态，再按现有安排规则处理。", destination: "materials" },
  project_pause_requested: { title: "项目暂停请求待核对", next: "检查生命周期记录与任务当前状态。", destination: "lifecycle" },
  project_resume_requested: { title: "项目恢复请求待核对", next: "检查生命周期记录与原任务条件。", destination: "lifecycle" },
  project_end_requested: { title: "项目结束请求待核对", next: "核对结束请求及仍未决的原操作。", destination: "lifecycle" },
  identity_reservation_missing: { title: "发布身份预留缺失", next: "核对账号分配与目标 Page／频道。", destination: "media-accounts" },
  attempt_assignment_stale: { title: "原尝试设备预留已变化", next: "核对当前分配；保留原尝试，不将它当作已执行任务。", destination: "media-accounts" },
  device_association_missing: { title: "任务没有当前设备关联", next: "核对项目账号与设备分配。", destination: "devices" },
  installation_missing: { title: "设备安装事实缺失", next: "查看设备接入及初始化记录。", destination: "devices" },
  device_paused: { title: "设备参与状态已暂停", next: "核对设备当前参与状态。", destination: "devices" },
  stop_unconfirmed: { title: "原操作停止状态未确认", next: "先核对原操作和停止事实，不要把未知当作已停止。", destination: "devices" },
  participation_missing: { title: "设备参与确认缺失", next: "核对该设备当前参与确认。", destination: "devices" },
  network_not_admitted: { title: "设备网络准入尚未确认", next: "核对当前网络路径和网络准入记录。", destination: "devices" },
  action_inspector_unavailable: { title: "当前条件检查器不可用", next: "稍后重试读取；不可用不代表条件已通过。" },
  current_fact_unknown: { title: "一项或多项当前事实未知", next: "重新读取当前条件；未知状态不会按就绪处理。" },
  executor_unavailable: { title: "执行服务当前不可用", next: "此任务尚未启动；等待服务恢复后重新核对。" },
  proof_verifier_unavailable: { title: "可信结果核验当前不可用", next: "保留原提交状态，核验服务恢复后查询原操作。" },
};

function displayTime(raw: string | null | undefined): string {
  if (!raw) return "时间未知";
  const value = new Date(raw);
  return Number.isNaN(value.getTime()) ? "时间未知" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(value);
}

function titleForBlocker(code: string) {
  return blockerMessages[code] ?? { title: `系统返回待处理条件：${code}`, next: "查看当前项目条件和设备事实；未核清前不会按就绪处理。" };
}

export function ProjectWorkflowPanel({ projectId, active, readOnly, onExpired, refreshVersion = 0, onNavigate, onOpenTodos, onOpenMediaAccounts, onOpenDevices }:
  { projectId: string; active: boolean; readOnly: boolean; onExpired: (error: unknown) => void; refreshVersion?: number;
    onNavigate?: (tab: ProjectTab) => void; onOpenTodos?: (todoId?: string) => void; onOpenMediaAccounts?: () => void; onOpenDevices?: () => void }) {
  const [state, setState] = useState<LoadState>("loading");
  const [workflow, setWorkflow] = useState<BusinessPlanWorkflowResponse | null>(null);
  const [details, setDetails] = useState<Record<string, DetailFact>>({});
  const [feedback, setFeedback] = useState<ProjectFeedbackResponse | null>(null);
  const [feedbackUnknown, setFeedbackUnknown] = useState(false);
  const [feedbackProjectId, setFeedbackProjectId] = useState<string | null>(null);
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const sequence = useRef(0);
  const onExpiredRef = useRef(onExpired);
  onExpiredRef.current = onExpired;
  const currentProject = projectId.toLowerCase();

  async function refresh() {
    const current = ++sequence.current;
    setState("loading");
    setFeedbackUnknown(true);
    const onCurrentExpired = (error: unknown) => {
      if (current === sequence.current && error instanceof ProductApiError && error.status === 401) onExpiredRef.current(error);
    };
    const fact = await readFact(() => readProjectWorkflow(currentProject), onCurrentExpired);
    if (current !== sequence.current) return;
    setLoadedProjectId(currentProject);
    if (fact.status === "unknown") {
      setState(fact.reason === "unauthorized" ? "unauthorized" : fact.reason === "stale" ? "stale" : "failed");
      return;
    }
    if (fact.value.projectId.toLowerCase() !== currentProject) {
      setState("failed");
      return;
    }
    setWorkflow(fact.value);
    const linked = fact.value.tasks.filter(task => task.assistanceTodoId !== null);
    const todoEntries = await Promise.all(linked.map(async task => {
      const result = await readFact(() => readAssistanceTodoDetail(task.assistanceTodoId!), onCurrentExpired);
      return [task.assistanceTodoId!, result.status === "loaded" && result.value.todo.todoId.toLowerCase() === task.assistanceTodoId!.toLowerCase()
        ? { status: "loaded", value: result.value } as const
        : { status: "unknown" } as const] as const;
    }));
    if (current !== sequence.current) return;
    setDetails(Object.fromEntries(todoEntries));
    setState("loaded");

    const feedbackFact = await readFact(() => readProjectFeedback(currentProject), onCurrentExpired);
    if (current !== sequence.current) return;
    if (feedbackFact.status === "loaded" && feedbackFact.value.projectId.toLowerCase() === currentProject) {
      setFeedback(feedbackFact.value);
      setFeedbackUnknown(false);
    } else {
      setFeedback(null);
      setFeedbackUnknown(true);
    }
    setFeedbackProjectId(currentProject);
  }

  useEffect(() => {
    if (!active) { sequence.current++; return; }
    void refresh();
    return () => { sequence.current++; };
    // Callback identity is held in a ref so an app render cannot restart reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, projectId, refreshVersion]);

  const current = loadedProjectId === currentProject && workflow?.projectId.toLowerCase() === currentProject ? workflow : null;
  const currentFeedback = feedbackProjectId === currentProject ? feedback : null;
  const feedbackState = feedbackProjectId !== currentProject ? "正在读取本项目效果来源；当前不形成效果结论。"
    : feedbackUnknown ? "效果来源状态未知；读取失败不代表零值。"
    : currentFeedback?.sourceState === "available" ? `已读取 ${currentFeedback.metrics.length} 条效果快照；这不代表观察窗口已完成或效果判断已成立。`
      : currentFeedback?.sourceState === "not_configured" ? "效果数据来源尚未接入；保留观察中，不按零值生成复盘结论。"
        : currentFeedback?.sourceState === "unavailable" ? "效果数据来源当前不可用；保留观察中，不按零值生成复盘结论。"
          : "尚无可核验效果报告；观察继续，暂不形成效果结论。";

  return <section className="project-workflow" aria-label="项目任务执行与复核闭环" hidden={!active}>
    <div className="project-workflow__heading">
      <div>
        <h2>任务执行与复核</h2>
        <p>沿着本项目的计划、素材版本、执行记录和结果核验查看进度。日常安排不需要逐条审批；本页不会启动手机、发布内容或替人确认成功。</p>
      </div>
      <button type="button" className="outline-button" onClick={() => void refresh()} disabled={state === "loading"}>
        <ArrowClockwise size={17} />{state === "loading" ? "读取中…" : "重新读取闭环"}
      </button>
    </div>

    {state === "loading" && <p className="project-workflow__state" role="status">正在读取本项目任务与结果；读取完成前，执行及发布状态均未知。</p>}
    {state === "failed" && <div className="project-workflow__state project-workflow__state--error" role="alert">
      <p>任务闭环事实读取失败；这不代表项目没有任务或一切正常。</p><button className="outline-button" onClick={() => void refresh()}>重试读取</button>
    </div>}
    {state === "unauthorized" && <p className="project-workflow__state project-workflow__state--error" role="alert">登录已失效，本次任务状态未读取。请重新登录后再查看。</p>}
    {state === "stale" && <p className="project-workflow__state project-workflow__state--error" role="alert">读取期间登录会话已变化；本次响应未用于更新页面。请重新读取。</p>}

    {current && <>
      {state !== "loaded" && <p className="project-workflow__stale" role="status">以下为上次读取结果（{displayTime(current.checkedAt)}）；本次状态未知，请勿据此操作。</p>}
      <section className="project-workflow__services" aria-label="执行与核验服务状态">
        <div><strong>执行服务</strong><span>{current.ports.executor === "connected" ? "服务接口已连接；不代表手机当前可执行" : "服务未连接，任务不具备派发条件"}</span></div>
        <div><strong>可信结果核验</strong><span>{current.ports.proofVerifier === "connected" ? "核验器已连接；仍须逐项核验业务结果" : "核验器未连接，结果保持未知"}</span></div>
        <small>读取时间：{displayTime(current.checkedAt)} · 执行许可与发布许可仍按现有门禁控制</small>
      </section>

      <div className="project-workflow__section-title"><h3>本项目真实任务</h3><span>{current.tasks.length} 项</span></div>
      {!current.tasks.length ? <div className="project-workflow__empty">
        <ClipboardText size={20} /><div><strong>当前排期没有可显示的任务记录</strong><p>这不代表项目已就绪或已完成执行。先在排期页确认计划及任务生成结果。</p>
          {onNavigate && <button className="text-button" onClick={() => onNavigate("business-plan")}>查看排期与任务<ArrowSquareOut size={14} /></button>}</div>
      </div> : <div className="project-workflow__tasks">
        {current.tasks.map(task => {
          const detail = task.assistanceTodoId ? details[task.assistanceTodoId.toLowerCase()] : undefined;
          const blockers = task.workflow.blockers.map(code => ({ code, ...titleForBlocker(code) }));
          const recheckBlockers = detail?.status === "loaded" ? detail.value.recheck.blockers : task.recheckBlockers;
          const recheckState = detail?.status === "loaded" ? detail.value.recheck.status : task.recheckStatus;
          const canNavigateTo = (destination: BlockerDestination) => destination === "media-accounts" ? Boolean(onOpenMediaAccounts)
            : destination === "devices" ? Boolean(onOpenDevices) : Boolean(onNavigate);
          return <article className="project-workflow__task" key={task.taskId}>
            <header className="project-workflow__task-head">
              <div><h4>{platformLabel[task.platform]} · {formLabel[task.form]}</h4><p>任务 {task.taskId} · 计划 v{task.planRevision} · 任务修订 v{task.taskRevision}</p></div>
              <span className={`project-workflow__status project-workflow__status--${task.workflow.state}`}>{workflowLabels[task.workflow.state]}</span>
            </header>

            <dl className="project-workflow__facts">
              <div><dt>计划时间</dt><dd>{displayTime(task.scheduledAt)}</dd></div>
              <div><dt>内容与素材修订</dt><dd>{task.contentUnitId} · {task.variantId} v{task.materialRevision}</dd></div>
              <div><dt>目标发布身份</dt><dd>{task.identityId}</dd></div>
              <div><dt>当前尝试</dt><dd>{task.attempt ? `${task.attempt.taskAttemptId} · ${task.attempt.state === "pending_current_checks" ? "逻辑预约，等待当前条件核验；尚未开始手机执行" : "状态未知"}` : "尚无任务尝试记录"}</dd></div>
              <div><dt>真实执行 operation</dt><dd>{task.operation ? `${task.operation.operationId} · ${operationLabels[task.operation.state]}` : "尚无真实 operation；任务预约不代表手机已启动"}</dd></div>
              <div><dt>提交状态</dt><dd>{task.workflow.submissionState === "not_started" ? "尚未提交" : task.workflow.submissionState === "in_progress" ? "提交进行中" : task.workflow.submissionState === "unknown" ? "提交结果未知；先核实原操作，不重复提交" : task.workflow.submissionState === "verified_published" ? "可信核验为已发布" : "可信核验为未发布"}</dd></div>
            </dl>

            <details className="project-workflow__manifest">
              <summary><FileText size={16} />查看任务绑定的素材文件（{task.expectedFiles.length} 个）</summary>
              {task.expectedFiles.length ? <ul>{task.expectedFiles.map(file => <li key={`${file.objectId}:${file.sha256}`}>
                <strong>{file.objectId}</strong><span>{file.contentType} · {file.bytes.toLocaleString("zh-CN")} 字节</span><code>SHA-256 {file.sha256}</code>
              </li>)}</ul> : <p>计划没有返回文件清单；文件存在及设备端可用状态未知。</p>}
              <p>以上是任务期望关联的文件，不证明文件当前可读取或已传到手机。</p>
            </details>

            {blockers.length > 0 && <section className="project-workflow__blockers" aria-label="当前任务阻断及处理办法">
              <h5>当前条件与下一步</h5>
              {blockers.map(({ code, title, next, destination }) => <div key={code} className="project-workflow__blocker">
                <div><strong>{title}</strong><p>{next}</p></div>
                {destination && canNavigateTo(destination) && <button className="text-button" onClick={() => {
                  if (destination === "media-accounts") onOpenMediaAccounts?.();
                  else if (destination === "devices") onOpenDevices?.();
                  else onNavigate?.(destination);
                }}>前往处理<ArrowSquareOut size={14} /></button>}
              </div>)}
            </section>}

            {task.workflow.verifiedResult && <p className="project-workflow__verified">可信核验记录 {task.workflow.verifiedResult.resultId} · 核验时间 {displayTime(task.workflow.verifiedResult.verifiedAt)}。效果数据与复盘结论仍须分别读取。</p>}

            <section className="project-workflow__assistance" aria-label="人工协助与自动复核">
              <div className="project-workflow__assistance-heading"><Robot size={18} /><h5>人工协助与系统复核</h5></div>
              {!task.assistanceTodoId ? <p>本任务没有服务端记录的协助待办关联；全局或仅设备级待办不会按设备推断到本项目。</p> : <>
                {detail?.status === "unknown" && <p className="project-workflow__inline-warning">协助记录读取失败；处理与复核状态未知。请重试整个闭环读取。</p>}
                {detail?.status === "loaded" && <p>协助事项 {detail.value.todo.todoId} · {detail.value.todo.status === "awaiting_recheck" ? "人员已提交处理说明，等待系统复核" : "待办仍需处理"} · 最近更新 {displayTime(detail.value.todo.updatedAt)} · 处理记录 {detail.value.todo.noteCount} 条</p>}
                <p className="project-workflow__recheck"><strong>{recheckLabels[recheckState]}</strong>{recheckBlockers.length > 0 && <span> 当前复核返回：{recheckBlockers.map(code => titleForBlocker(code).title).join("；")}</span>}
                  {detail?.status === "loaded" && <small>复核时间：{displayTime(detail.value.recheck.checkedAt)}</small>}</p>
                {onOpenTodos && <button className="text-button" onClick={() => onOpenTodos(task.assistanceTodoId!)}>查看协助待办与记录<ArrowSquareOut size={14} /></button>}
              </>}
              <p className="project-workflow__guard">现场人员提交“已处理”只是复核请求。通过结果只能由系统复核产生；通过不代表本任务已续跑，请以此处原任务和 operation 状态为准。未知提交先核实原 operation，不重复提交。</p>
              <p className="project-workflow__guard">本人恢复请求由设备管理 App 发起；Web 只展示进度，不代替本人请求，也不增加运营逐任务审批。</p>
            </section>
          </article>;
        })}
      </div>}

      <section className="project-workflow__feedback" aria-label="效果观察与复盘状态">
        <div><h3>效果观察与复盘</h3><p>{feedbackState}</p>
          <p>当前闭环不显示预测提升或模拟结果。效果观察窗口未满或真实来源缺失时，复盘延期；数据不足不视作零值，也不要求为了“优化”而强行改变安排。</p>
        </div>
        {onNavigate && <button className="text-button" onClick={() => onNavigate("feedback")}>查看效果与复盘<ArrowSquareOut size={14} /></button>}
      </section>
      {readOnly && <p className="project-workflow__readonly">当前处于只读模式。可查看事实与导航，但不能记录处理说明。</p>}
    </>}
  </section>;
}
