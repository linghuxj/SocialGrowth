import { useEffect, useRef, useState } from "react";
import { contractVersion } from "@socialgrowth/product-contracts";
import type { BusinessPlanCurrentView } from "@socialgrowth/product-contracts";
import { ArrowClockwise, CalendarDots, ClipboardText } from "@phosphor-icons/react";
import { BusinessPlanClientError, PreparedBusinessPlanArrange, readBusinessPlan } from "./business-plan-api.js";
import { isDefinitiveProjectRejection, newIdempotencyKey, ProductApiError } from "./operator-api.js";
import { TaskReadinessPanel } from "./task-readiness-panel.js";

const formLabel = (form: string) => ({ facebook_video: "Facebook 视频", facebook_image_text: "Facebook 图文", youtube_shorts: "YouTube Shorts", youtube_video: "YouTube 视频" }[form] ?? form);
const platformLabel = (platform: string) => platform === "facebook" ? "Facebook" : "YouTube";
const outcomeLabel = (outcome: string) => ({ planned: "已根据当前权威事实生成并保存排期与待核查任务。", unchanged: "当前排期未变化。", insufficient_data: "当前资料不足，服务没有安排新任务。", direction_confirmation_required: "模型要求运营先确认方向调整；请回到方向页复核提案。" }[outcome] ?? "请求已返回。");
const arrangeWaitLimitMs = 45_000;

type ProjectTab = "settings" | "materials" | "lifecycle";
type BusinessPlanPanelProps = {
  projectId: string; active: boolean; readOnly: boolean; onExpired: (error: unknown) => void;
  refreshVersion?: number;
  onNavigate?: (tab: ProjectTab) => void;
  onOpenMediaAccounts?: () => void;
  onOpenDevices?: () => void;
};

export function BusinessPlanPanel({ projectId, active, readOnly, onExpired, refreshVersion = 0,
  onNavigate, onOpenMediaAccounts, onOpenDevices,
}: BusinessPlanPanelProps) {
  const [view, setView] = useState<BusinessPlanCurrentView | null>(null), [loading, setLoading] = useState(false);
  const [checksRefreshVersion, setChecksRefreshVersion] = useState(0);
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [attention, setAttention] = useState(false);
  const [pending, setPending] = useState<PreparedBusinessPlanArrange | null>(null), [pendingRead, setPendingRead] = useState(false), [busy, setBusy] = useState(false);
  const sequence = useRef(0), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; }; }, []);
  async function refresh() {
    const current = ++sequence.current; setLoading(true); setError("");
    try {
      const next = await readBusinessPlan(projectId);
      if (alive.current && current === sequence.current) {
        if (view) setChecksRefreshVersion(value => value + 1);
        setView(next); setError(""); if (pending) setPendingRead(true);
      }
    } catch (cause) {
      if (!alive.current || current !== sequence.current) return;
      if (cause instanceof ProductApiError && cause.status === 401) onExpired(cause);
      else setError("排期与任务事实暂不可用；读取失败不代表没有排期。");
    } finally { if (alive.current && current === sequence.current) setLoading(false); }
  }
  useEffect(() => { if (active) void refresh(); else sequence.current++; }, [active, projectId, refreshVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  async function arrange(command?: PreparedBusinessPlanArrange) {
    const current = view;
    if (busy || readOnly || (!command && (!current?.currentScope.approvalId || !current))) return;
    let original = command;
    if (!original) {
      if (!current?.currentScope.approvalId) return;
      const metadata = { contractVersion, requestId: `request-${crypto.randomUUID()}`, idempotencyKey: newIdempotencyKey() };
      try { original = new PreparedBusinessPlanArrange(projectId, { metadata, expectedProjectVersion: current.currentScope.projectVersion,
        expectedApprovalId: current.currentScope.approvalId, expectedPlanRevision: current.plan?.revision ?? 0 }); }
      catch { setError("当前范围无法构成有效安排请求；请刷新后核对。"); return; }
      setPending(original);
    }
    setBusy(true); setError(""); setMessage(""); sequence.current++;
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const waiting = original.send().then(response => ({ kind: "response" as const, response }), cause => ({ kind: "error" as const, cause }));
      const result = await Promise.race([waiting, new Promise<{ kind: "timeout" }>(resolve => {
        timer = setTimeout(() => resolve({ kind: "timeout" }), arrangeWaitLimitMs);
      })]);
      if (timer) clearTimeout(timer);
      if (result.kind === "timeout") {
        setPending(original); setPendingRead(false);
        setError("安排请求超过等待时限，结果未知。原请求键和范围已冻结；先读取当前事实，再由你决定是否用同一请求继续。读取计划只显示现状，不是原请求回执；若服务尚未保存命令，续接可能再次运行模型。页面没有取消后台请求，也不会自动重发。");
        return;
      }
      if (result.kind === "error") throw result.cause;
      const response = result.response;
      if (!alive.current) return;
      setView(response); setChecksRefreshVersion(value => value + 1); setPending(null); setPendingRead(false); setMessage(outcomeLabel(response.outcome)); setAttention(response.outcome === "insufficient_data" || response.outcome === "direction_confirmation_required");
    } catch (cause) {
      if (!alive.current) return;
      if (cause instanceof ProductApiError && cause.status === 401) { setPendingRead(false); onExpired(cause); return; }
      if (isDefinitiveProjectRejection(cause)) { setPending(null); setPendingRead(false); setError("项目范围或计划版本已经变化。请读取当前事实，核对后再开始新的安排。"); }
      else if (cause instanceof BusinessPlanClientError) { setPendingRead(false); setError("服务响应无法核对；保留原安排请求和请求键，先读取当前事实。"); }
      else { setPendingRead(false); setError("安排结果尚未确认。原请求已冻结；读取当前事实后，只能显式接续同一请求。没有自动重试。"); }
    } finally { if (alive.current) setBusy(false); }
  }
  const rows = view?.tasks ?? [];
  return <section className="business-plan" hidden={!active} aria-label="排期与任务">
    <header className="business-plan__header"><div><p className="business-plan__eyebrow">项目准备 · 排期与任务</p><h2>排期与任务</h2><p>服务器依据当前批准范围和已保存资料生成排期；页面不提交模型文本或任务内容。</p></div>
      <button type="button" className="outline-button" disabled={loading || busy} onClick={() => void refresh()}><ArrowClockwise size={18} />{loading ? "读取中…" : "读取当前事实"}</button></header>
    {error && <p className="business-plan__error" role="alert">{error}</p>}{message && <p className={`business-plan__message${attention ? " is-attention" : ""}`} role="status">{message}</p>}
    {!view && !error && <p role="status">正在读取排期与任务事实…</p>}
    {view && <>
      <section className="business-plan__scope" aria-label="当前批准范围"><div><span>当前项目版本</span><strong>v{view.currentScope.projectVersion}</strong></div>
        <div><span>批准方向</span><strong>{view.currentScope.approvalId ? "已读取批准记录" : "未确认"}</strong></div>
        <div><span>批准周期</span><strong>{view.currentScope.window ? `${new Date(view.currentScope.window.startsAt).toLocaleString("zh-CN")} — ${new Date(view.currentScope.window.endsAt).toLocaleString("zh-CN")}` : "未设置"}</strong></div>
        <p>安排时的范围和版本由服务端事务校验；界面展示不代替资格判断。</p></section>
      <section className="business-plan__plan" aria-label="当前排期"><div className="business-plan__section-heading"><div><CalendarDots size={20} /><h3>当前排期</h3></div>
        {!readOnly && <button type="button" disabled={busy || !view.currentScope.approvalId || !!pending} onClick={() => void arrange()}>{busy ? "提交中…" : "根据当前范围安排"}</button>}</div>
        {view.plan ? <dl><div><dt>排期版本</dt><dd>v{view.plan.revision}</dd></div><div><dt>范围状态</dt><dd>{view.plan.scopeState === "current" ? "与当前范围一致" : "旧范围，待重新核对"}</dd></div>
          <div><dt>记录时间</dt><dd>{new Date(view.plan.recordedAt).toLocaleString("zh-CN")}</dd></div><div><dt>窗口</dt><dd>{new Date(view.plan.window.startsAt).toLocaleString("zh-CN")} — {new Date(view.plan.window.endsAt).toLocaleString("zh-CN")}</dd></div></dl>
          : <p className="business-plan__empty"><ClipboardText size={24} />尚无已保存排期。没有数据时不显示示例进度或模拟任务。</p>}
        {pending && <div className="business-plan__pending" role="status"><p>原安排请求仍待核对；请求键和范围已冻结。读取当前计划只显示现状，不代表原请求回执。若尚未保存命令，续接会使用同一请求键再次运行模型；页面不会自动重发。</p>
          {!readOnly && <button type="button" disabled={busy || !pendingRead} onClick={() => void arrange(pending)}>接续同一安排请求</button>}
          {!pendingRead && <span>请先读取当前事实，然后再决定是否续接原请求。</span>}</div>}
      </section>
      <section className="business-plan__tasks" aria-label="计划任务"><div className="business-plan__section-heading"><div><ClipboardText size={20} /><h3>待核查任务</h3></div><span>{rows.length} 项</span></div>
        {!rows.length ? <p className="business-plan__empty">当前没有任务记录；只有服务端完成安排后才会显示任务。</p> : <div className="table-wrap"><table><thead><tr><th>平台／形式</th><th>语言</th><th>素材版本</th><th>计划时间</th><th>当前状态</th></tr></thead><tbody>{rows.map(task => <tr key={task.taskId}><td>{platformLabel(task.platform)} · {formLabel(task.form)}</td><td>{task.languageTag}</td><td>{task.variantId.slice(0, 8)}… v{task.materialRevision}</td><td>{new Date(task.scheduledAt).toLocaleString("zh-CN")}</td><td>待核查当前条件</td></tr>)}</tbody></table></div>}
        <p className="business-plan__guard">服务端返回的任务仍为 pending_current_checks；当前界面未提供执行或发布动作。排期和任务都不表示实际已运行。</p>
      </section>
      <section className="business-plan__permissions" aria-label="权限状态"><span>执行许可：关闭</span><span>发布许可：关闭</span><span>手机任务派发：未接入</span></section>
    </>}
    <TaskReadinessPanel projectId={projectId} active={active} onExpired={onExpired} refreshVersion={refreshVersion + checksRefreshVersion}
      onNavigate={onNavigate} onOpenMediaAccounts={onOpenMediaAccounts} onOpenDevices={onOpenDevices} />
  </section>;
}
