import { ArrowClockwise } from "@phosphor-icons/react";
import { factValue, operationsRows, useProjectOperationsFacts, type OperationsTab } from "./operations-facts.js";
interface Props {
  projectId: string; active: boolean; readOnly: boolean; onExpired: (e: unknown) => void;
  refreshVersion?: number; onNavigate: (tab: OperationsTab) => void; onOpenTodos: () => void;
}
export function AutomationOrchestratorPanel({ projectId, active, refreshVersion = 0, onExpired, onNavigate, onOpenTodos }: Props) {
  const { facts, loading, refresh } = useProjectOperationsFacts(projectId, active, refreshVersion, onExpired);
  const direction = factValue(facts?.direction), plan = factValue(facts?.businessPlan), preparation = factValue(facts?.accountPreparation), feedback = factValue(facts?.feedback);
  const failed = facts && Object.values(facts).some(v => typeof v === "object" && v.status === "unknown");
  return <section hidden={!active} className="panel automation-orchestrator" aria-label="AI 自动化总控">
    <div className="section-heading"><div><h2>AI 自动化调度总控</h2><p className="muted">查看本项目当前方向、安排和执行记录，从缺少条件处继续推进。</p></div><button className="outline-button" disabled={loading} onClick={refresh}><ArrowClockwise size={18} />{loading ? "读取中…" : "刷新项目事实"}</button></div>
    {loading && <p role="status">正在读取本项目的计划与执行事实…</p>}
    {failed && <p role="alert" className="feedback">部分事实读取失败，相关状态保持未知。请刷新重试；不能据此判断条件已满足。</p>}
    <h3>当前推进状态</h3>
    <div className="table-wrap"><table><thead><tr><th>环节</th><th>当前事实</th><th>下一步</th></tr></thead><tbody>{operationsRows(facts).map(row => <tr key={row.title}><td>{row.title}</td><td>{row.value}</td><td><button className="text-button" onClick={() => onNavigate(row.tab)}>{row.next}</button></td></tr>)}</tbody></table></div>
    <section className="operations-section"><h3>AI 方向依据</h3>{direction?.approval || direction?.proposal ? <><p>{(direction.approval?.proposal ?? direction.proposal)!.output.direction}</p><details><summary>查看生成依据与限制</summary><p>{(direction.approval?.proposal ?? direction.proposal)!.output.rationale}</p><ul>{(direction.approval?.proposal ?? direction.proposal)!.output.limitations.map((text, i) => <li key={i}>{text}</li>)}</ul></details></> : <p>{direction ? "尚无模型生成的方向。先保存目标、周期与发布身份范围，再从设置生成方向。" : "方向来源未知，请重新读取。"}</p>}<button className="text-button" onClick={() => onNavigate("settings")}>前往目标与方向</button></section>
    <section className="operations-section"><h3>任务与原操作</h3><p>{plan ? `业务计划中有 ${plan.tasks.length} 个任务；当前接口未提供可信发布成功回执。` : "业务计划事实未知。"}</p>{preparation && preparation.originalOperations.length > 0 && <ul>{preparation.originalOperations.map(o => <li key={o.taskAttemptId}>任务 {o.taskId.slice(0, 8)}：{o.latestObservation ? "已有执行端观察，等待核验" : "启动意图已登记，原结果待核实"}。<small> 原 trace：{o.traceId ?? "尚未确认"}</small></li>)}</ul>}<button className="text-button" onClick={() => onNavigate("business-plan")}>核对排期与任务</button></section>
    <section className="operations-section"><h3>效果与后续安排</h3><p>{!feedback ? "反馈来源未知。" : feedback.metrics.length ? `已读取 ${feedback.metrics.length} 行报告快照；请核对指标名称、覆盖时间与内容归因后判断效果。` : "没有可展示的反馈快照；不能视为零值。"}</p><p>当前没有可信复盘建议与后续安排生效来源。</p><button className="text-button" onClick={() => onNavigate("feedback")}>查看效果口径与复盘状态</button></section>
    <section className="operations-section"><h3>人工协助与恢复</h3><p>设备接入待办来自历史未分配设备的事件，不代表本项目异常。登记“已处理”后仍要核验当前设备与原操作，不能直接视为恢复成功。</p><button className="outline-button" onClick={onOpenTodos}>查看设备接入待办</button></section>
  </section>;
}
