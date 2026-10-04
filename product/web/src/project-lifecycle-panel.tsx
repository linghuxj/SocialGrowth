import { ArrowClockwise, WarningCircle } from "@phosphor-icons/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MaterialCurrentView } from "./material-api.js";
import { listProjectMaterials, readProjectMaterial } from "./material-api.js";
import { ProductApiError } from "./operator-api.js";
import {
  PreparedMaterialWithdrawal,
  PreparedProjectLifecycleIntent,
  ProjectLifecycleApiError,
  readProjectLifecycleIntent,
  readProjectCurrentChecks,
  type ProjectCurrentChecksView,
  type ProjectLifecycleIntentView,
} from "./project-lifecycle-api.js";

type PendingCommand =
  | { kind: "project"; command: PreparedProjectLifecycleIntent }
  | { kind: "material"; command: PreparedMaterialWithdrawal; material: MaterialCurrentView };

type Props = {
  projectId: string;
  active: boolean;
  readOnly: boolean;
  onExpired: (error: unknown) => void;
  onFactsChanged: () => void;
};

const intentLabels: Record<NonNullable<ProjectLifecycleIntentView["intent"]>, string> = {
  pause_requested: "已记录暂停意图",
  resume_requested: "已记录恢复前复核意图",
  end_requested: "已记录正式结束意图",
};
const blockerLabels: Record<ProjectCurrentChecksView["tasks"][number]["blockers"][number], string> = {
  plan_missing: "计划事实缺失", task_missing: "任务事实缺失", plan_stale: "计划版本过期", project_scope_changed: "项目范围已变化",
  material_missing: "素材文件事实缺失", material_revision_changed: "素材版本已变化", material_not_eligible: "素材尚未具备候选条件",
  material_withdrawn: "素材已内部撤回", project_pause_requested: "项目暂停意图待处理", project_resume_requested: "项目恢复意图待复核",
  project_end_requested: "项目结束意图待处理", task_cancelled_before_start: "任务已记录为开始前取消", identity_reservation_missing: "账号身份保留事实缺失",
  attempt_assignment_stale: "任务设备分配已变化", device_association_missing: "设备关联事实缺失", installation_missing: "安装身份事实缺失",
  device_paused: "设备处于暂停事实", stop_unconfirmed: "停止事实未确认", participation_missing: "设备参与事实缺失",
  network_not_admitted: "设备网络准入未确认", action_inspector_unavailable: "动作权限检查不可用", current_fact_unknown: "当前必要事实未知",
};

function timestamp(value: string | null): string {
  if (!value) return "未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间格式未知";
  return `${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date)} UTC`;
}

function errorText(error: unknown): string {
  if (error instanceof ProductApiError) {
    const code = error.response.error.code;
    if (code === "FACT_VERSION_STALE") return "事实版本已变化；本次命令被服务拒绝。正在刷新当前事实。";
    if (code === "IDEMPOTENCY_KEY_REUSED") return "服务报告原请求键与已有请求冲突；结果保持未知，不能改用新请求。";
    if (error.status === 401) return "运营会话已失效；原命令结果仍需核对，不能改用新请求。";
  }
  if (error instanceof ProjectLifecycleApiError) return "生命周期事实暂时无法读取或校验；没有把未知当作未发生。";
  return "请求结果未知；原请求内容和请求键保持冻结。请核对当前事实或接续原请求。";
}

export function ProjectLifecyclePanel({ projectId, active, readOnly, onExpired, onFactsChanged }: Props) {
  const [lifecycle, setLifecycle] = useState<ProjectLifecycleIntentView | null>(null);
  const [currentChecks, setCurrentChecks] = useState<ProjectCurrentChecksView | null>(null);
  const [materials, setMaterials] = useState<MaterialCurrentView[]>([]);
  const [nextMaterialCursor, setNextMaterialCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [endConfirmed, setEndConfirmed] = useState(false);
  const [pending, setPending] = useState<PendingCommand | null>(null);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const alive = useRef(true);
  const sequence = useRef(0);
  const refreshGeneration = useRef(0);
  const pendingRef = useRef<PendingCommand | null>(null);
  const busyRef = useRef(false);
  const loadingRef = useRef(false);
  const loadingProjectRef = useRef<string | null>(null);
  const loadingActiveEpochRef = useRef(0);
  const activeRef = useRef(active);
  const previousActiveRef = useRef(active);
  const activeEpochRef = useRef(0);
  const projectKey = projectId.toLowerCase();
  const projectKeyRef = useRef(projectKey);
  const displayedProjectRef = useRef(projectKey);
  if (previousActiveRef.current !== active) {
    previousActiveRef.current = active;
    activeEpochRef.current++;
  }
  activeRef.current = active;
  projectKeyRef.current = projectKey;

  function updatePending(next: PendingCommand | null) {
    pendingRef.current = next;
    setPending(next);
  }

  function pendingProject(command: PendingCommand): string {
    return command.command.projectId;
  }

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; sequence.current++; };
  }, []);

  const reportExpired = useCallback((error: unknown) => {
    if (error instanceof ProductApiError && error.status === 401) onExpired(error);
  }, [onExpired]);

  const refresh = useCallback(async (append = false, force = false) => {
    if (!force && loadingRef.current && loadingProjectRef.current === projectKey
      && loadingActiveEpochRef.current === activeEpochRef.current) return;
    const currentSequence = ++sequence.current;
    const currentRefreshGeneration = ++refreshGeneration.current;
    const requestActiveEpoch = activeEpochRef.current;
    const requestProject = projectKey;
    const requestPending = pendingRef.current;
    loadingRef.current = true;
    loadingProjectRef.current = requestProject;
    loadingActiveEpochRef.current = requestActiveEpoch;
    setLoading(true);
    setErrorMessage("");
    try {
      const [nextLifecycle, nextChecks, page] = await Promise.all([
        readProjectLifecycleIntent(projectKey),
        readProjectCurrentChecks(projectKey),
        listProjectMaterials(projectKey, append ? nextMaterialCursor : null, 50),
      ]);
      if (!alive.current || currentSequence !== sequence.current || !activeRef.current || activeEpochRef.current !== requestActiveEpoch
        || projectKeyRef.current !== requestProject) return;
      setLifecycle(nextLifecycle);
      setCurrentChecks(nextChecks);
      setMaterials(current => append ? [...current, ...page.materials] : page.materials);
      setNextMaterialCursor(page.nextAfterVariantId);
      if (requestPending?.kind === "project" && pendingRef.current === requestPending
        && pendingProject(requestPending) === requestProject && nextLifecycle.requestId === requestPending.command.requestId
        && nextLifecycle.intent === `${requestPending.command.intent}_requested`) {
        updatePending(null);
        setMessage("已通过当前权威生命周期事实核对原请求回执；任务停止或手机现场状态仍须单独核实。");
      }
    } catch (error) {
      if (!alive.current || currentSequence !== sequence.current || !activeRef.current || activeEpochRef.current !== requestActiveEpoch
        || projectKeyRef.current !== requestProject) return;
      reportExpired(error);
      setErrorMessage(errorText(error));
    } finally {
      if (currentRefreshGeneration === refreshGeneration.current) {
        loadingRef.current = false;
        loadingProjectRef.current = null;
      }
      if (alive.current && currentRefreshGeneration === refreshGeneration.current) setLoading(false);
    }
  }, [nextMaterialCursor, projectKey, reportExpired]);

  useLayoutEffect(() => {
    if (displayedProjectRef.current !== projectKey) {
      displayedProjectRef.current = projectKey;
      setLifecycle(null);
      setCurrentChecks(null);
      setMaterials([]);
      setNextMaterialCursor(null);
      setEndConfirmed(false);
      setMessage("");
      setErrorMessage("");
    }
  }, [projectKey]);

  useEffect(() => { if (active) void refresh(false); }, [active, projectKey]);

  async function send(command: PendingCommand) {
    if (busyRef.current || readOnly || !activeRef.current || projectKeyRef.current !== pendingProject(command)
      || (pendingRef.current && pendingRef.current !== command)) return;
    const commandProject = pendingProject(command);
    const commandActiveEpoch = activeEpochRef.current;
    const stillInCommandView = () => activeRef.current && activeEpochRef.current === commandActiveEpoch
      && projectKeyRef.current === commandProject;
    busyRef.current = true;
    sequence.current++;
    setBusy(true);
    setErrorMessage("");
    updatePending(command);
    try {
      if (command.kind === "project") {
        const response = await command.command.send();
        if (!alive.current) return;
        if (pendingRef.current === command && stillInCommandView()) {
          setMessage(`${intentLabels[response.intent]}；关联任务影响 ${response.impactedTaskCount} 项，确认未开始且无执行记录的取消 ${response.cancelledTaskCount} 项。没有确认手机物理停止。请求 ${response.requestId}。`);
        }
      } else {
        const response = await command.command.send();
        if (!alive.current) return;
        if (pendingRef.current === command && stillInCommandView()) {
          setMessage(`已记录该素材版本的内部撤回；关联任务影响 ${response.impactedTaskCount} 项，确认未开始且无执行记录的取消 ${response.cancelledTaskCount} 项。未操作外部平台内容。请求 ${response.requestId}。`);
        }
      }
      if (pendingRef.current === command) updatePending(null);
      if (stillInCommandView()) {
        onFactsChanged();
        await refresh(false, true);
      }
    } catch (error) {
      if (!alive.current) return;
      reportExpired(error);
      const definitiveStale = error instanceof ProductApiError && error.status === 409
        && error.response.error.code === "FACT_VERSION_STALE";
      if (definitiveStale) {
        if (pendingRef.current === command) updatePending(null);
        if (stillInCommandView()) {
          setErrorMessage(errorText(error));
          await refresh(false, true);
        }
      } else if (pendingRef.current === command && stillInCommandView()) {
        setErrorMessage(errorText(error));
      }
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }

  function startLifecycle(intent: "pause" | "resume" | "end") {
    if (!lifecycle || pendingRef.current || readOnly || busyRef.current || loadingRef.current) return;
    if (intent === "end" && !endConfirmed) {
      setErrorMessage("正式结束会成为终态；请先确认结束范围。未开始且无执行记录的任务可能被取消，未知任务不会被当作已取消。");
      return;
    }
    try {
      setErrorMessage("");
      void send({ kind: "project", command: new PreparedProjectLifecycleIntent(projectKey, lifecycle.lifecycleRevision, intent) });
    } catch (error) {
      setErrorMessage(errorText(error));
    }
  }

  function startWithdrawal(material: MaterialCurrentView) {
    if (pendingRef.current || readOnly || busyRef.current || loadingRef.current || material.withdrawal?.state !== "not_withdrawn") return;
    const confirmed = window.confirm(`内部撤回素材“${material.declaration.name}”的当前版本 v${material.currentRevision}？这将禁止后续重用；不会删除任何外部平台内容。`);
    if (!confirmed) return;
    try {
      setErrorMessage("");
      void send({
        kind: "material",
        material,
        command: new PreparedMaterialWithdrawal(projectKey, material.variantId, material.currentRevision),
      });
    } catch (error) {
      setErrorMessage(errorText(error));
    }
  }

  async function verifyPending() {
    const command = pendingRef.current;
    if (!command || busyRef.current || !activeRef.current || projectKeyRef.current !== pendingProject(command)) return;
    const requestSequence = ++sequence.current;
    const requestActiveEpoch = activeEpochRef.current;
    const requestProject = pendingProject(command);
    if (command.kind === "project") {
      try {
        const current = await readProjectLifecycleIntent(requestProject);
        if (!alive.current || requestSequence !== sequence.current || !activeRef.current || activeEpochRef.current !== requestActiveEpoch
          || projectKeyRef.current !== requestProject || pendingRef.current !== command) return;
        if (current.intent === `${command.command.intent}_requested` && current.requestId === command.command.requestId) {
          updatePending(null);
          setMessage("已通过项目当前权威意图及相同请求编号核对原命令；不代表手机现场停止。");
        } else {
          setMessage("项目当前意图没有证明冻结命令已记录；原 body 与请求键仍保留。");
        }
      } catch (error) {
        if (requestSequence !== sequence.current || activeEpochRef.current !== requestActiveEpoch || pendingRef.current !== command) return;
        reportExpired(error);
        setErrorMessage(errorText(error));
      }
      return;
    }
    if (command.kind === "material") {
      try {
        const current = await readProjectMaterial(requestProject, command.command.variantId);
        if (!alive.current || requestSequence !== sequence.current || !activeRef.current || activeEpochRef.current !== requestActiveEpoch
          || projectKeyRef.current !== requestProject || pendingRef.current !== command) return;
        if (current.withdrawal?.state === "withdrawn" && current.withdrawal.requestId === command.command.requestId) {
          updatePending(null);
          setMessage("已由素材当前事实核对到原请求编号；仅确认内部撤回，不代表平台删除。");
        } else if (current.withdrawal?.state === "withdrawn") {
          setMessage("当前素材已撤回，但当前请求编号与冻结命令不同；原请求结果仍未知。");
        } else {
          setMessage("当前素材事实没有证明原命令已记录；冻结原 body 与请求键仍可接续。");
        }
      } catch (error) {
        if (requestSequence !== sequence.current || activeEpochRef.current !== requestActiveEpoch || pendingRef.current !== command) return;
        reportExpired(error);
        setErrorMessage(errorText(error));
      }
      return;
    }
  }

  const ended = lifecycle?.intent === "end_requested";
  return <section hidden={!active} className="project-lifecycle" aria-label="项目生命周期">
    <div className="section-heading">
      <div><h2>项目生命周期</h2><p className="muted">项目意图、素材内部撤回和任务当前事实分别读取。恢复请求只触发恢复前复核，不会自动重启任务或发布；素材撤回不删除平台内容。</p></div>
      <button className="outline-button" type="button" disabled={loading || busy} onClick={() => void refresh(false)}>
        <ArrowClockwise size={18} />{loading ? "核对中…" : "核对当前事实"}
      </button>
    </div>
    {loading && <p role="status">正在读取项目意图与当前素材事实…</p>}
    {errorMessage && <div className="project-lifecycle__alert" role="alert"><WarningCircle size={20} /><p>{errorMessage}</p></div>}
    {message && <p className="project-lifecycle__message" role="status">{message}</p>}
    {lifecycle && <section className="project-lifecycle__card" aria-label="项目意图事实">
      <div className="project-lifecycle__section-heading"><div><h3>项目暂停、恢复与结束</h3><p>最新持久意图及其请求编号，不是项目实际执行完成回执。</p></div><span>生命周期版本 v{lifecycle.lifecycleRevision}</span></div>
      <dl className="project-lifecycle__facts">
        <div><dt>最新意图</dt><dd>{lifecycle.intent ? intentLabels[lifecycle.intent] : "尚无项目生命周期意图"}</dd></div>
        <div><dt>记录时间</dt><dd>{timestamp(lifecycle.recordedAt)}</dd></div>
        <div><dt>原请求编号</dt><dd>{lifecycle.requestId ?? "无"}</dd></div>
      </dl>
      {!readOnly && <div className="project-lifecycle__actions">
        <button type="button" disabled={busy || !!pending || ended || lifecycle.intent === "pause_requested"} onClick={() => startLifecycle("pause")}>请求暂停发布</button>
        <button type="button" className="outline-button" disabled={busy || !!pending || ended || lifecycle.intent !== "pause_requested"} onClick={() => startLifecycle("resume")}>请求检查恢复条件</button>
        <button type="button" className="danger-button" disabled={busy || !!pending || ended} onClick={() => startLifecycle("end")}>正式结束项目</button>
      </div>}
      {!readOnly && !ended && <label className="project-lifecycle__confirm"><input type="checkbox" checked={endConfirmed} disabled={busy || !!pending} onChange={event => setEndConfirmed(event.currentTarget.checked)} />我确认项目正式结束不可普通恢复；未知提交仍需独立核实。</label>}
      {pending && pendingProject(pending) !== projectKey && <div className="project-lifecycle__pending" role="status"><p>另一个项目仍有未核对的原命令（项目 {pendingProject(pending)}）。返回该项目继续原请求或只读核对；不会为当前项目发送新命令。</p></div>}
      {pending?.kind === "project" && pendingProject(pending) === projectKey && <div className="project-lifecycle__pending"><p>请求结果未知或仍待核对。新生命周期操作已冻结；原 body 与请求键保留在当前页面。</p><span>请求 {pending.command.requestId}</span><button type="button" className="outline-button" disabled={busy || readOnly} onClick={() => void send(pending)}>接续原请求</button><button type="button" className="text-button" disabled={busy} onClick={() => void verifyPending()}>只读核对原回执</button></div>}
    </section>}
    <section className="project-lifecycle__card" aria-label="计划任务当前核对">
      <div className="project-lifecycle__section-heading"><div><h3>受影响任务当前事实</h3><p>只读当前检查与不可变取消记录；不表示手机已停止或任务已执行。</p></div><span>{currentChecks?.tasks.length ?? 0} 项</span></div>
      {currentChecks?.plan === null && <p className="project-lifecycle__empty">当前没有已读计划事实；本页没有创建计划或任务。</p>}
      {currentChecks && currentChecks.tasks.length === 0 && currentChecks.plan !== null && <p className="project-lifecycle__empty">当前计划没有可读任务行。</p>}
      <div className="project-lifecycle__tasks">{currentChecks?.tasks.map(task => <article className="project-lifecycle__task" key={task.taskId}>
        <div className="project-lifecycle__section-heading"><div><h4>任务 {task.taskId.slice(0, 8)}</h4><p>计划 v{task.planRevision} · 任务 v{task.taskRevision} · 素材 v{task.expectedMaterialRevision}</p></div><span>{task.cancelledBeforeStart ? "开始前取消已记录" : task.attempt ? "逻辑尝试已登记" : "无尝试回执"}</span></div>
        {task.cancelledBeforeStart && <p className="project-lifecycle__message">取消事实：{task.cancelledBeforeStart.reason === "project_end" ? "正式结束" : "素材内部撤回"} · 请求 {task.cancelledBeforeStart.requestId} · {timestamp(task.cancelledBeforeStart.recordedAt)}</p>}
        {task.current.projectLifecycleIntent && <p>项目意图：{intentLabels[task.current.projectLifecycleIntent]}</p>}
        {task.current.materialWithdrawn === null ? <p>素材撤回事实未知。</p> : task.current.materialWithdrawn && <p>当前素材已撤回；不代表外部平台内容已删除。</p>}
        {task.attempt && <p>逻辑尝试 {task.attempt.taskAttemptId}；执行与发布许可均为关闭。</p>}
        {task.blockers.length > 0 && <ul>{task.blockers.map(blocker => <li key={blocker}>{blockerLabels[blocker]}</li>)}</ul>}
        {task.impactReferences.length > 0 && <details><summary>历史影响记录（{task.impactReferences.length}）</summary><ol>{task.impactReferences.map(impact => <li key={impact.impactRevision}>v{impact.impactRevision} · {impact.reason === "project_lifecycle_intent_changed" ? "项目意图变化" : impact.reason === "material_withdrawn" ? "素材撤回" : impact.reason === "material_revision_changed" ? "素材版本变化" : "项目范围变化"} · {timestamp(impact.recordedAt)}</li>)}</ol></details>}
      </article>)}</div>
    </section>
    <section className="project-lifecycle__card" aria-label="项目素材内部撤回">
      <div className="project-lifecycle__section-heading"><div><h3>素材后续使用</h3><p>正式撤回仅阻止该素材版本继续进入后续安排，不会删除已发布内容。</p></div><span>{materials.length} 项已读</span></div>
      {!loading && materials.length === 0 && !errorMessage && <p className="project-lifecycle__empty">当前读取结果没有素材行；不代表项目已完成或发布历史为空。</p>}
      <div className="project-lifecycle__materials">
        {materials.map(material => <article className="project-lifecycle__material" key={material.variantId}>
          <div><h4>{material.declaration.name}</h4><p>{material.identity.mediaKind} · {material.languageTag} · 版本 v{material.currentRevision}</p></div>
          <div className="project-lifecycle__material-state">
            {material.withdrawal === null ? "撤回来源未知，当前不可操作"
              : material.withdrawal.state === "withdrawn" ? `内部撤回已记录 · ${timestamp(material.withdrawal.recordedAt)} · 请求 ${material.withdrawal.requestId}`
                : `当前未撤回 · ${material.status === "candidate" ? "候选" : "待核验"}`}
          </div>
          {!readOnly && material.withdrawal?.state === "not_withdrawn" && <button type="button" className="outline-button" disabled={busy || !!pending || ended} onClick={() => startWithdrawal(material)}>撤回此素材版本</button>}
        </article>)}
      </div>
      {pending?.kind === "material" && pendingProject(pending) === projectKey && <div className="project-lifecycle__pending" aria-label="待核对的素材撤回命令"><p>素材撤回结果未知或仍待核对。目标素材 {pending.command.variantId} · 事实版本 v{pending.command.expectedMaterialRevision}；原请求编号 {pending.command.requestId}。新命令已冻结，不能改用新请求键。</p><button type="button" className="outline-button" disabled={busy || readOnly} onClick={() => void send(pending)}>接续原素材撤回请求</button><button type="button" className="text-button" disabled={busy} onClick={() => void verifyPending()}>只读核对原素材回执</button></div>}
      {nextMaterialCursor && <button type="button" className="text-button" disabled={loadingMore || loading || !!pending} onClick={() => {
        setLoadingMore(true);
        void refresh(true).finally(() => setLoadingMore(false));
      }}>{loadingMore ? "读取更多中…" : "读取更多素材"}</button>}
    </section>
    <p className="project-lifecycle__footnote">暂停只记录停止新增发布的意图，不终止效果观察，也不证明手机已停止。已提交任务结果、资源释放与内容撤下仍需各自独立核实；本页不执行平台删除。</p>
  </section>;
}
