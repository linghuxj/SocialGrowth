import { useEffect, useRef, useState } from "react";
import { contractVersion, projectPlanningInputsSchema, type ProjectPlanningDraftView } from "@socialgrowth/product-contracts";
import { ArrowClockwise, CalendarBlank, Target } from "@phosphor-icons/react";
import { isDefinitiveProjectRejection, newIdempotencyKey, ProductApiError } from "./operator-api.js";
import { PreparedPlanningDraft, readPlanningDraft, samePlanningInputs } from "./project-planning-api.js";
import { numberFields, planningFormOf, planningInputOf, type PlanningForm } from "./project-planning-editor.js";
import { ProjectDirectionPanel } from "./project-direction-panel.js";
import { ProjectCycleConfigPanel } from "./project-cycle-config-panel.js";
const zones = projectPlanningInputsSchema.shape.businessTimeZone.unwrap().options;
const numericLabels = { reviewIntervalDays: "复盘间隔（天）", trafficMinimumPerCycle: "项目每周期引流最低任务数", observationWindowHours: "内容观察窗口（小时）", tailObservationDays: "结束后收尾观察（天）", maxPublicationsPerDay: "每日总发布上界" };
const forms = { facebook_video: "Facebook 视频", facebook_image_text: "Facebook 图文", youtube_shorts: "YouTube Shorts", youtube_video: "YouTube 常规视频" };
export function ProjectPlanningPanel({ projectId, active, readOnly, onExpired, onFactsChanged }: {
  projectId: string; active: boolean; readOnly: boolean; onExpired: (e: unknown) => void; onFactsChanged: () => void;
}) {
  const [base, setBase] = useState<ProjectPlanningDraftView | null>(null), [observed, setObserved] = useState<ProjectPlanningDraftView | null>(null);
  const [form, setForm] = useState(planningFormOf), [dirty, setDirty] = useState(false), [section, setSection] = useState<"goals" | "cycle">("goals");
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [pending, setPending] = useState<PreparedPlanningDraft | null>(null), [message, setMessage] = useState("");
  const alive = useRef(true), sequence = useRef(0), sending = useRef(false), loadingRef = useRef(false), draftRef = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; loadingRef.current = false; }; }, []);
  useEffect(() => { if (active && !base) void refresh(); }, [active]);
  function failed(e: unknown): boolean {
    if (e instanceof ProductApiError && e.status === 401) { onExpired(e); return true; } return false;
  }
  async function refresh() {
    if (loadingRef.current || sending.current) return;
    const read = ++sequence.current; loadingRef.current = true; setLoading(true);
    try {
      const next = await readPlanningDraft(projectId); if (!alive.current || read !== sequence.current) return;
      if (draftRef.current || pending) { setObserved(next); setMessage("当前保存值已读取，表单输入及原请求仍保留，请核对。 "); }
      else { setBase(next); setForm(planningFormOf(next.inputs)); setObserved(null); setMessage(""); }
    } catch (e) { if (alive.current && read === sequence.current && !failed(e)) setMessage("规划事实读取失败，不能判断为未配置；请重试。"); }
    finally { if (alive.current && read === sequence.current) { loadingRef.current = false; setLoading(false); } }
  }
  function edit<K extends keyof PlanningForm>(key: K, value: PlanningForm[K]) {
    if (readOnly || sending.current || pending || !base) return;
    draftRef.current = true; setDirty(true); setForm(prev => ({ ...prev, [key]: value })); setMessage("");
  }
  async function save() {
    if (readOnly || sending.current || !base || (!dirty && !pending)) return;
    let request: PreparedPlanningDraft;
    try {
      request = pending ?? new PreparedPlanningDraft({ projectId, expectedProjectVersion: base.projectFactVersion, expectedDraftVersion: base.draftVersion,
        inputs: planningInputOf(form), metadata: { contractVersion, requestId: `request-${crypto.randomUUID()}`, idempotencyKey: newIdempotencyKey() } });
    } catch { setMessage("请核对文本、非重复国家/语言标签、整数与带时区的 ISO 时间；窗口两端必须齐全且结束在开始之后。输入保留。"); return; }
    sending.current = true; setBusy(true); setPending(request); sequence.current++; loadingRef.current = false; setLoading(false);
    try {
      const next = await request.send(); if (!alive.current) return;
      setPending(null); onFactsChanged();
      if (samePlanningInputs(planningInputOf(form), next.inputs)) {
        setBase(next); setForm(planningFormOf(next.inputs)); draftRef.current = false; setDirty(false); setObserved(null);
        setMessage("目标与周期草案已保存，尚未批准；没有生成排期、开启周期或派发任务。");
      } else {
        setObserved(next); setMessage("原请求已返回当前草案，但当前内容与本人输入不同；未覆盖你的输入，请逐项核对再采用保存基线。");
      }
    } catch (e) {
      if (!alive.current || failed(e)) return;
      if (isDefinitiveProjectRejection(e)) {
        setPending(null); setMessage(e instanceof ProductApiError && e.response.error.code === "FACT_VERSION_STALE"
          ? "项目或草案保存版本已变化；输入保留，请刷新核对后明确采用最新版本。" : "草案被明确拒绝，输入保留，可修正后重新保存。");
      } else setMessage("保存结果尚未确认，输入与原请求已冻结；请接续原保存，不更换请求或猜测成功。");
    } finally { if (alive.current) { sending.current = false; setBusy(false); } }
  }
  return <section hidden={!active} className="planning-workspace" aria-label="项目目标与周期草案">
    <div className="section-heading"><div><h2>目标与周期草案</h2><p className="muted">仅筹备输入；确认方向与 AI 生效排期另行判断。</p></div><button className="outline-button" disabled={loading || busy} onClick={() => void refresh()}><ArrowClockwise size={18} />刷新当前草案</button></div>
    <nav className="project-tabs" aria-label="草案分区"><button className="text-button" aria-current={section === "goals" ? "page" : undefined} onClick={() => setSection("goals")}><Target size={18} />目标与范围</button><button className="text-button" aria-current={section === "cycle" ? "page" : undefined} onClick={() => setSection("cycle")}><CalendarBlank size={18} />周期与观察</button><span>{pending ? "原保存待确认" : dirty ? "有未保存输入" : base?.draftVersion ? `已保存草案 v${base.draftVersion}` : "草案事实尚未确认"}</span></nav>
    {message && <p role="status" className="feedback">{message}</p>}{loading && <p role="status">正在读取规划事实…</p>}
    {!base ? <p>目标与周期事实尚未读取，不能推定为空或不受限制。</p> : <>
      <section className="project-direction-note"><div><h3>当前为筹备草案，不是批准范围</h3><p>项目版本 {base.projectFactVersion}，草案版本 {base.draftVersion}。{base.savedAt ? `保存时间 ${base.savedAt}；保存人 ${base.savedByOperatorId}` : "尚无保存记录"}。此处只展示筹备草案，不能据此判断实际运行周期或批准范围。</p></div></section>
      <fieldset disabled={readOnly || busy || !!pending}>
        <section className="panel planning-form-grid" hidden={section !== "goals"}>
          <label>正式开通前阶段目标<textarea aria-label="正式开通前阶段目标" maxLength={150} value={form.preOpeningGoal} onChange={e => edit("preOpeningGoal", e.target.value)} /></label>
          <label>正式开通后阶段目标<textarea aria-label="正式开通后阶段目标" maxLength={150} value={form.postOpeningGoal} onChange={e => edit("postOpeningGoal", e.target.value)} /></label>
          <label>正式开通后优先级<select aria-label="正式开通后优先级" value={form.postOpeningPriority} onChange={e => edit("postOpeningPriority", e.target.value as PlanningForm["postOpeningPriority"])}><option value="">尚未配置</option><option value="revenue_first">广告收益优先，保留引流</option><option value="traffic_first">引流优先，保留广告收益</option><option value="balanced">两者平衡</option></select></label>
          <label>目标国家标签（逗号分隔）<input value={form.targetCountries} onChange={e => edit("targetCountries", e.target.value)} /></label><label>目标语言标签（逗号分隔）<input value={form.targetLanguages} onChange={e => edit("targetLanguages", e.target.value)} /></label>
          <div><p>允许成品形式</p>{(Object.keys(forms) as (keyof typeof forms)[]).map(key => <label key={key} className="material-inline-check"><input type="checkbox" checked={form.contentForms.includes(key)} onChange={e => edit("contentForms", e.target.checked ? [...form.contentForms, key] : form.contentForms.filter(v => v !== key))} />{forms[key]}</label>)}</div>
          <label>内容规则说明<textarea aria-label="内容规则说明" maxLength={150} value={form.contentRules} onChange={e => edit("contentRules", e.target.value)} /></label>
        </section>
        <section className="panel planning-form-grid" hidden={section !== "cycle"}>
          <label>业务时区<select aria-label="业务时区" value={form.businessTimeZone} onChange={e => edit("businessTimeZone", e.target.value)}><option value="">尚未配置</option>{zones.map(zone => <option key={zone} value={zone}>{zone}</option>)}</select></label>
          <label>首次统计起点（ISO 时间，须含时区）<input value={form.firstCycleStartsAt} onChange={e => edit("firstCycleStartsAt", e.target.value)} placeholder="填写实际时刻，末尾 Z 或 ±HH:MM" /></label>
          {numberFields.map(key => <label key={key}>{numericLabels[key]}<input inputMode="numeric" value={form[key]} onChange={e => edit(key, e.target.value)} /></label>)}
          <label>发布有效窗口开始（ISO 含时区）<input value={form.windowStart} onChange={e => edit("windowStart", e.target.value)} /></label><label>发布有效窗口结束（ISO 含时区，结束不含）<input value={form.windowEnd} onChange={e => edit("windowEnd", e.target.value)} /></label>
        </section>
      </fieldset>
      <div hidden={section !== "cycle"}>
        <ProjectCycleConfigPanel projectId={projectId} active={active && section === "cycle"} readOnly={readOnly} onExpired={onExpired} onFactsChanged={onFactsChanged} />
      </div>
      <p className="form-note">空项保持未配置，不自动填候选国家、语言、7天、时区或最低数。时间输入是带明确偏移的实际时刻，不按浏览器或手机时区猜测；本页不做本地时刻/DST换算。</p>
      <p className="form-note">保存覆盖本页两个分区的全部草案字段。运行中修改不走此筹备入口；后续周期变更需从下周期连续生效，当前周期和历史口径不改。</p>
      {!readOnly && <div className="project-save-actions"><button disabled={busy || (!dirty && !pending)} onClick={() => void save()}>{busy ? "保存中…" : pending ? "接续原草案保存" : "保存全部草案"}</button><button className="outline-button" disabled={busy || !!pending || !dirty} onClick={() => { setForm(planningFormOf(base.inputs)); draftRef.current = false; setDirty(false); setObserved(null); }}>放弃本次输入</button></div>}
      {observed && <section className="project-conflict" aria-label="当前草案核对"><h3>当前保存：项目 v{observed.projectFactVersion}／草案 v{observed.draftVersion}</h3><pre>{JSON.stringify(observed.inputs, null, 2)}</pre><p>本人输入仍保留；采用最新版本仅更新保存基线，下一次保存仍提交表单全部字段。</p>{!readOnly && <button className="outline-button" disabled={busy || !!pending} onClick={() => { setBase(observed); setObserved(null); }}>已逐项核对，采用最新版本</button>}</section>}
      <p className="form-note">返回或切换项目保留本窗口输入；关闭页面未保存输入不会落盘。没有额外启动审批，也没有用草案保存代替初始方向确认。</p>
    </>}
    <ProjectDirectionPanel projectId={projectId} active={active} readOnly={readOnly} onExpired={onExpired} onFactsChanged={onFactsChanged} unsaved={dirty || !!pending || busy} />
  </section>;
}
