import { useEffect, useRef, useState, type FormEvent } from "react";
import type { OperatorView, ProjectBasics, ProjectView } from "@socialgrowth/product-contracts";
import { ArrowLeft, CalendarBlank, DeviceMobile, FileText, Folder, Info, Link, Plus, Target, UsersThree } from "@phosphor-icons/react";
import { isDefinitiveProjectRejection, listProjects, newIdempotencyKey, ProductApiError, saveProject } from "./operator-api.js";
import { MaterialWorkspace } from "./material-workspace.js";
import { ProjectPlanningPanel } from "./project-planning-panel.js";
import { AccountPreparationPanel } from "./account-preparation-panel.js";
import { BusinessPlanPanel } from "./business-plan-panel.js";

interface Draft { basics: ProjectBasics; base?: ProjectView; key: string | null; uncertain?: boolean }
const empty = (): ProjectBasics => ({ name: "", kind: "company_owned", customerName: null, ownerOperatorId: null, notificationEmail: null });
const basicsOf = (p: ProjectView): ProjectBasics => ({ name: p.name, kind: p.kind, customerName: p.customerName, ownerOperatorId: p.ownerOperatorId, notificationEmail: p.notificationEmail });
const time = (value: string) => new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const failures = (error: unknown) => error instanceof ProductApiError && error.response.error.code === "FACT_VERSION_STALE"
  ? "项目已被其他运营更新。输入已保留；请核对当前保存值后再采用最新版本保存。"
  : error instanceof ProductApiError && error.response.error.code === "INPUT_INVALID" ? "基本信息不符合要求。请核对名称及客户的首尾空白、负责人状态和邮箱格式。"
  : error instanceof ProductApiError && error.response.error.code === "IDEMPOTENCY_KEY_REUSED" ? "请求标识已用于不同输入，请先核对原操作的实际结果。"
  : "服务暂时不可用，输入已保留，请重试。";

export function ProjectPanel({ active, refreshVersion, operators, readOnly, onExpired }: {
  active: boolean; refreshVersion: number; operators: OperatorView[]; readOnly: boolean; onExpired: (error: unknown) => void;
}) {
  const [projects, setProjects] = useState<ProjectView[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "materials" | "settings" | "business-plan">("overview");
  const [materialProjects, setMaterialProjects] = useState<string[]>([]);
  const [planningProjects, setPlanningProjects] = useState<string[]>([]);
  const [businessPlanProjects, setBusinessPlanProjects] = useState<string[]>([]);
  const [planningRefresh, setPlanningRefresh] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const alive = useRef(true), revision = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; revision.current++; }; }, []);
  useEffect(() => {
    if (!active) return;
    const read = ++revision.current;
    setLoading(true);
    void listProjects().then(next => {
      if (alive.current && read === revision.current) setProjects(next);
    }).catch((error: unknown) => {
      if (!alive.current || read !== revision.current) return;
      if (error instanceof ProductApiError && error.status === 401) onExpired(error);
      else setMessage(failures(error));
    }).finally(() => { if (alive.current && read === revision.current) setLoading(false); });
  }, [active, refreshVersion, planningRefresh]);
  const current = projects?.find(p => p.projectId === selected);
  const draft = selected ? drafts[selected] ?? (current ? { basics: basicsOf(current), base: current, key: null } : { basics: empty(), key: null }) : null;
  function change(value: Partial<ProjectBasics>) {
    if (!selected || !draft || draft.uncertain) return;
    setDrafts(prev => ({ ...prev, [selected]: { ...draft, basics: { ...draft.basics, ...value }, key: null } }));
    setMessage("");
  }
  function open(id: string) { setSelected(id); setTab("overview"); setMessage(""); }
  function showMaterials() {
    if (!current) return;
    setMaterialProjects(ids => ids.includes(current.projectId) ? ids : [...ids, current.projectId]); setTab("materials");
  }
  function showPlanning() {
    if (!current) return;
    setPlanningProjects(ids => ids.includes(current.projectId) ? ids : [...ids, current.projectId]); setTab("settings");
  }
  function showBusinessPlan() {
    if (!current) return;
    setBusinessPlanProjects(ids => ids.includes(current.projectId) ? ids : [...ids, current.projectId]); setTab("business-plan");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !draft || readOnly || busy) return;
    const id = selected, input = draft.basics, key = draft.key ?? newIdempotencyKey();
    setDrafts(prev => ({ ...prev, [id]: { ...draft, key, uncertain: true } })); setBusy(true); setMessage("");
    revision.current++; setLoading(false);
    try {
      const result = await saveProject(input, key, draft.base);
      if (!alive.current) return;
      // Ignore an older read that could erase the newly committed project.
      revision.current++; setLoading(false);
      setProjects(prev => [result, ...(prev ?? []).filter(p => p.projectId !== result.projectId)]);
      setDrafts(prev => { const next = { ...prev }; delete next[id]; return next; });
      setSelected(result.projectId);
      setMessage(`“${result.name}”基本信息已保存；仍在筹备，未启动发布，也未发送提醒。`);
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof ProductApiError && error.status === 401) onExpired(error);
      else {
        if (isDefinitiveProjectRejection(error)) {
          setDrafts(prev => ({ ...prev, [id]: { ...draft, key, uncertain: false } }));
        }
        setMessage(failures(error));
      }
    } finally { if (alive.current) setBusy(false); }
  }
  const owner = current?.ownerOperatorId ? operators.find(o => o.operatorId === current.ownerOperatorId) : null;
  const hasDraft = selected !== null && !!drafts[selected];
  return <div className="project-workspace" hidden={!active}>
    {message && <p role="status" className="feedback">{message}</p>}
    {loading && <p role="status">正在读取项目事实…</p>}
    {selected === null ? <section className="panel project-list-panel">
      <div className="section-heading"><div><h1>项目列表</h1><p className="muted">筹备可分批保存；负责人不限制其他运营代办。</p></div>
        {!readOnly && <button disabled={busy} onClick={() => open("new")}><Plus size={18} />新建项目</button>}</div>
      {projects === null ? <p>项目事实尚未读取；请刷新，不把加载失败当作无项目。</p> : projects.length === 0 ? <div className="empty-state"><Folder size={34} /><h3>尚无项目</h3><p>先建立筹备项目，再按实际资料到位顺序准备。</p></div>
        : <div className="table-wrap"><table><thead><tr><th>项目</th><th>类型 / 客户</th><th>当前事实</th><th>负责人</th><th>更新时间</th><th>查看</th></tr></thead>
          <tbody>{projects.map(p => <tr key={p.projectId}><td><strong>{p.name}</strong>{drafts[p.projectId] && <small>有未保存输入</small>}</td><td>{p.kind === "company_owned" ? "公司自营" : "客户代运营"}<small>{p.customerName}</small></td><td><span className="status">筹备中</span><small>方向范围见项目设置</small></td><td>{operators.find(o => o.operatorId === p.ownerOperatorId)?.displayName ?? (p.ownerOperatorId ? "负责人资料待读取" : "尚未指定")}</td><td>{time(p.updatedAt)}</td><td><button className="text-button" disabled={busy} onClick={() => open(p.projectId)}>准备清单</button></td></tr>)}</tbody></table></div>}
      {drafts.new && <button className="text-button" disabled={busy} onClick={() => open("new")}>继续未保存的新建项目</button>}
    </section> : <>
      <div className="project-heading"><h1>{current?.name ?? "新建筹备项目"}</h1><span className="status">筹备中</span><button className="text-button" disabled={busy} onClick={() => openList()}><ArrowLeft size={18} />返回项目列表</button></div>
      {current && <>
        <div className="project-tabs" aria-label="项目内导航"><button className="text-button" aria-current={tab === "overview" ? "page" : undefined} onClick={() => setTab("overview")}>概览</button><button className="text-button" aria-current={tab === "materials" ? "page" : undefined} onClick={showMaterials}>素材</button><button className="text-button" aria-current={tab === "business-plan" ? "page" : undefined} onClick={showBusinessPlan}>排期与任务</button><span>效果与复盘 · 待接入</span><button className="text-button" aria-current={tab === "settings" ? "page" : undefined} onClick={showPlanning}>设置 · 目标与周期</button></div>
        <div hidden={tab !== "overview"}>
        <section className="project-direction-note"><Info size={24} /><div><h3>发布前确认方向，准备可并行推进</h3><p>进入设置读取已确认方向与范围。保存资料不确认方向，也不启动发布；其他准备项按自身条件继续。</p></div></section>
        <section className="panel project-readiness"><h3>准备清单</h3><p className="muted">资料已保存、检查通过、方向确认与设备就绪分别判断，不手工勾选为通过。</p>
          <div className="table-wrap"><table><thead><tr><th>准备事项</th><th>当前事实</th><th>缺什么 / 影响范围</th><th>处理入口</th></tr></thead><tbody>
            <tr><td><Target size={18} aria-hidden />目标与自主范围</td><td>进入设置读取草案与方向确认记录</td><td>草案保存不等于方向确认，不启动发布</td><td><button className="text-button" onClick={showPlanning}>编辑目标草案</button></td></tr>
            <tr><td><FileText size={18} aria-hidden />素材与业务资料</td><td>进入素材页读取当前事实</td><td>上传和资料保存不代表候选准入或名额通过</td><td><button className="text-button" onClick={showMaterials}>整理素材</button></td></tr>
            <tr><td><DeviceMobile size={18} aria-hidden />发布身份与手机</td><td>尚未分配</td><td>未建立项目专用、身份核验及执行条件</td><td>资源分配待接入</td></tr>
            <tr><td><Link size={18} aria-hidden />引流入口</td><td>尚未配置</td><td>未核验有效路径，不计作引流完成</td><td>后续接入入口管理</td></tr>
            <tr><td><CalendarBlank size={18} aria-hidden />周期与运行规则</td><td>进入设置读取周期输入草案</td><td>时区、起点、最低要求和观察输入需人工明确；尚无运行周期</td><td><button className="text-button" onClick={showPlanning}>编辑周期草案</button></td></tr>
            <tr><td><UsersThree size={18} aria-hidden />负责人及提醒</td><td>{owner ? `${owner.displayName}${owner.status === "disabled" ? "（已停用，历史保留）" : ""}` : current.ownerOperatorId ? "负责人资料待读取" : "尚未指定"}<small>{current.notificationEmail ? "提醒邮箱已保存；尚未发送" : "提醒邮箱未配置"}</small></td><td>配置不代表送达；其他运营可代办</td><td><a href="#project-basics">编辑基本信息</a></td></tr>
          </tbody></table></div>
        </section>
        <div className="project-followthrough"><section className="panel"><h3>当前可推进</h3><p>补充基本信息、负责人和提醒邮箱，进入素材页上传成品及整理人工资料。目标和资源准备继续分段接入，不推断已就绪。</p></section><section className="panel"><h3>确认后的执行方式</h3><p>后续确认明确方向后，就绪任务可在批准范围内自主执行；未就绪条件保留阻断，不增加独立启动审批。</p></section></div>
        </div>
      </>}
      {draft && <section className="panel" id="project-basics" hidden={!!current && (tab === "materials" || tab === "business-plan")}><div className="section-heading"><div><h3>{current ? "基本信息" : "建立项目"}</h3><p className="muted">仅保存名称、类型、客户、负责人及提醒邮箱，不保存目标或批准。</p></div><span>{hasDraft ? "本窗口有未保存输入" : current ? `已保存版本 ${current.factVersion}` : "尚未保存"}</span></div>
        {readOnly ? <dl className="project-facts"><dt>项目名称</dt><dd>{draft.basics.name || "尚未填写"}</dd><dt>项目类型</dt><dd>{draft.basics.kind === "company_owned" ? "公司自营" : "客户代运营"}</dd><dt>客户</dt><dd>{draft.basics.customerName ?? "不适用"}</dd><dt>提醒邮箱</dt><dd>{draft.basics.notificationEmail ?? "尚未配置"}</dd></dl> : <form className="project-form" onSubmit={event => void submit(event)}>
          <fieldset disabled={busy || draft.uncertain}><label>项目名称<input required maxLength={150} value={draft.basics.name} onChange={e => change({ name: e.target.value })} /></label>
            <label>项目类型<select value={draft.basics.kind} onChange={e => change({ kind: e.target.value as ProjectBasics["kind"], customerName: null })}><option value="company_owned">公司自营</option><option value="client_managed">客户代运营</option></select></label>
            {draft.basics.kind === "client_managed" && <label>关联客户<input required maxLength={150} value={draft.basics.customerName ?? ""} onChange={e => change({ customerName: e.target.value || null })} /></label>}
            <label>负责人<select value={draft.basics.ownerOperatorId ?? ""} onChange={e => change({ ownerOperatorId: e.target.value || null })}><option value="">尚未指定</option>{operators.filter(o => o.status === "active" || o.operatorId === draft.basics.ownerOperatorId).map(o => <option key={o.operatorId} value={o.operatorId}>{o.displayName}{o.status === "disabled" ? "（已停用，请重新指定）" : ""}</option>)}</select></label>
            <label>提醒邮箱<input type="email" maxLength={254} value={draft.basics.notificationEmail ?? ""} onChange={e => change({ notificationEmail: e.target.value || null })} /></label>
          </fieldset>
          <div className="project-save-actions"><button type="submit" disabled={busy || (!!current && !hasDraft)}>{busy ? "保存中…" : current ? "保存基本信息" : "创建筹备项目"}</button>
            {hasDraft && !draft.uncertain && <button className="outline-button" type="button" disabled={busy} onClick={() => setDrafts(prev => { const next = { ...prev }; delete next[selected]; return next; })}>放弃本次输入</button>}</div>
        </form>}
        {draft.base && current && draft.base.factVersion !== current.factVersion && <div className="project-conflict" role="alert"><h4>保存值已变化，请先核对</h4><p>当前保存：{current.name} · {current.kind === "company_owned" ? "公司自营" : "客户代运营"} · 客户：{current.customerName ?? "无"} · 负责人：{operators.find(o => o.operatorId === current.ownerOperatorId)?.displayName ?? (current.ownerOperatorId ? "负责人资料待读取" : "尚未指定")} · 邮箱：{current.notificationEmail ?? "未配置"}</p><p>你的输入保留在表单中；采用最新版本后再保存将提交表单中的全部基本字段。</p>{!readOnly && !draft.uncertain && <button className="outline-button" disabled={busy} onClick={() => setDrafts(prev => ({ ...prev, [selected]: { basics: draft.basics, base: current, key: null } }))}>已核对，采用最新版本继续编辑</button>}</div>}
        <p className="form-note">负责人是提醒与责任归属，所有有效运营同权。邮箱保存不是送达；不会为缺项自动猜测国家、语言、时区或引流最低数。</p>
        <p className="form-note">返回或切换导航保留本窗口草稿；关闭页面不会保存草稿。</p>
        {draft.uncertain && <p role="status" className="form-note">提交结果尚未确认，暂不改写输入或更换请求。请重试原保存操作，读取同一请求的实际结果。</p>}
      </section>}
    </>}
    {materialProjects.map(id => <MaterialWorkspace key={id} projectId={id} active={active && selected === id && tab === "materials"} readOnly={readOnly} onExpired={onExpired} />)}
    {planningProjects.map(id => <ProjectPlanningPanel key={id} projectId={id} active={active && selected === id && tab === "settings"} readOnly={readOnly} onExpired={onExpired} onFactsChanged={() => setPlanningRefresh(v => v + 1)} />)}
    {planningProjects.map(id => <AccountPreparationPanel key={id} projectId={id} active={active && selected === id && tab === "settings"} readOnly={readOnly} onExpired={onExpired} />)}
    {businessPlanProjects.map(id => <BusinessPlanPanel key={id} projectId={id} active={active && selected === id && tab === "business-plan"} readOnly={readOnly} onExpired={onExpired} />)}
  </div>;
  function openList() { setSelected(null); setMessage(""); }
}
