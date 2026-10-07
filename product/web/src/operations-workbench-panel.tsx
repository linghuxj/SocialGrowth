import { useEffect, useRef, useState } from "react";
import { type ProjectView } from "@socialgrowth/product-contracts";
import { listProjects } from "./operator-api.js";
import { listAssistanceTodos, type AssistanceTodosPage } from "./device-assistance-api.js";
import { readFact, factValue, type FactState } from "./operations-facts.js";
interface Props { active: boolean; readOnly: boolean; refreshVersion: number; onExpired: (e: unknown) => void; onOpenProject: (id: string) => void; onOpenTodos: () => void; onOpenDevices: () => void }
export function OperationsWorkbenchPanel({ active, refreshVersion, onExpired, onOpenProject, onOpenTodos, onOpenDevices }: Props) {
  const [projects, setProjects] = useState<FactState<ProjectView[]> | null>(null), [todos, setTodos] = useState<FactState<AssistanceTodosPage> | null>(null);
  const [loading, setLoading] = useState(false), [moreLoading, setMoreLoading] = useState(false), [moreError, setMoreError] = useState(false);
  const sequence = useRef(0), expired = useRef(onExpired); expired.current = onExpired;
  useEffect(() => {
    const n = ++sequence.current;
    if (!active) return;
    setLoading(true); setProjects(null); setTodos(null); setMoreError(false); setMoreLoading(false);
    void Promise.all([readFact(listProjects, e => { if (n === sequence.current) expired.current(e); }), readFact(listAssistanceTodos, e => { if (n === sequence.current) expired.current(e); })]).then(([p, t]) => { if (n === sequence.current) { setProjects(p); setTodos(t); setLoading(false); } });
    return () => { sequence.current++; };
  }, [active, refreshVersion]);
  async function more() {
    const value = factValue(todos); if (!value?.nextAfterTodoId || moreLoading) return;
    const n = sequence.current; setMoreLoading(true); setMoreError(false);
    const next = await readFact(() => listAssistanceTodos(value.nextAfterTodoId!), e => { if (n === sequence.current) expired.current(e); });
    if (n !== sequence.current) return;
    if (next.status === "loaded") setTodos({ status: "loaded", value: { todos: [...value.todos, ...next.value.todos.filter(t => !value.todos.some(old => old.todoId === t.todoId))], nextAfterTodoId: next.value.nextAfterTodoId } });
    else setMoreError(true);
    setMoreLoading(false);
  }
  const projectList = factValue(projects), todoPage = factValue(todos);
  return <section hidden={!active} className="operations-workbench" aria-label="运营工作台">
    {loading && <p role="status">正在读取项目和设备接入待办…</p>}
    <section className="panel"><div className="section-heading"><div><h2>需要处理的设备接入事项</h2><p className="muted">全局历史接入待办；项目归属与当前设备健康需另行核验。</p></div><button className="outline-button" onClick={onOpenTodos}>进入设备接入待办</button></div>
      {!todoPage ? <p role={todos?.status === "unknown" ? "alert" : "status"}>{todos?.status === "unknown" ? "待办读取失败，数量未知。请使用页面顶部刷新重试。" : "待办事实待读取。"}</p> : <>
        <p>已读取 {todoPage.todos.length} 项{todoPage.nextAfterTodoId ? "，仍有更多记录" : "，已到当前列表末尾"}；提交处理说明后仍需复核。</p>
        {todoPage.todos.length === 0 ? <p>当前列表没有设备接入待办；项目任务与其他异常需进入对应项目核对。</p> : <div className="table-wrap"><table><thead><tr><th>事项</th><th>状态</th><th>影响与记录</th><th>更新时间</th></tr></thead><tbody>{todoPage.todos.map(t => <tr key={t.todoId}><td>手机网络接入协助<small>记录 {t.todoId.slice(0, 8)}</small></td><td>{t.status === "open" ? "需要协助" : "已登记处理，等待复核"}</td><td>{t.impactCount} 台历史影响手机 · {t.noteCount} 条说明</td><td>{new Date(t.updatedAt).toLocaleString("zh-CN")}</td></tr>)}</tbody></table></div>}
        {moreError && <p role="alert">更多记录读取失败，已读取内容保留；请重试加载。</p>}{todoPage.nextAfterTodoId && <button className="text-button" disabled={moreLoading} onClick={() => void more()}>{moreLoading ? "读取中…" : "加载更多接入待办"}</button>}
      </>}
    </section>
    <section className="panel operations-section"><div className="section-heading"><div><h2>项目运营入口</h2><p className="muted">进入项目查看方向、资源、排期、效果和暂停恢复事实。</p></div><button className="outline-button" onClick={onOpenDevices}>查看手机与提供者</button></div>
      {!projectList ? <p role={projects?.status === "unknown" ? "alert" : "status"}>{projects?.status === "unknown" ? "项目读取失败，数量未知。请刷新重试。" : "项目事实待读取。"}</p> : projectList.length === 0 ? <p>尚无项目。请从主导航“项目”建立筹备项目。</p> : <div className="table-wrap"><table><thead><tr><th>项目</th><th>类型</th><th>已保存资料</th><th>下一步</th></tr></thead><tbody>{projectList.map(p => <tr key={p.projectId}><td><strong>{p.name}</strong></td><td>{p.kind === "company_owned" ? "公司自营" : "客户代运营"}</td><td>基本信息 v{p.factVersion}<small>运行状态进入项目核对</small></td><td><button className="text-button" onClick={() => onOpenProject(p.projectId)}>打开项目</button></td></tr>)}</tbody></table></div>}
    </section>
  </section>;
}
