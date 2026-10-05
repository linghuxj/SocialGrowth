import { Plus, Trash } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { contractVersion, directionIdentitiesSchema, missingDirectionScopeFields, type ProjectDirectionView } from "@socialgrowth/product-contracts";
import { captureOperatorWriteSession, isDefinitiveProjectRejection, newIdempotencyKey, ProductApiError } from "./operator-api.js";
import { readPlanningDraft } from "./project-planning-api.js";
import { PreparedDirectionRequest, readProjectDirection } from "./project-direction-api.js";
const fieldLabels: Record<string, string> = { preOpeningGoal: "开通前目标", postOpeningGoal: "开通后目标", postOpeningPriority: "开通后优先级", targetCountries: "国家", targetLanguages: "语言", contentForms: "成品形式", contentRules: "内容规则", businessTimeZone: "业务时区", firstCycleStartsAt: "首次统计起点", reviewIntervalDays: "复盘间隔（天）", trafficMinimumPerCycle: "引流最低任务数", observationWindowHours: "观察窗口（小时）", tailObservationDays: "收尾观察（天）", maxPublicationsPerDay: "每日发布上界", publishingWindow: "发布有效窗口" };
const values: Record<string, string> = { balanced: "收益与引流平衡", revenue_first: "广告收益优先，保留引流", traffic_first: "引流优先，保留广告收益", facebook_video: "Facebook 视频", facebook_image_text: "Facebook 图文", youtube_shorts: "YouTube Shorts", youtube_video: "YouTube 常规视频" };
export function ProjectDirectionPanel({ projectId, active, readOnly, onExpired, onFactsChanged, unsaved }: {
  projectId: string; active: boolean; readOnly: boolean; unsaved: boolean; onExpired: (e: unknown) => void; onFactsChanged: () => void;
}) {
  const [identities, setIdentities] = useState([{ platform: "", canonicalRef: "", declaredStage: "" }]);
  const [view, setView] = useState<ProjectDirectionView | null>(null), [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false), [pending, setPending] = useState<PreparedDirectionRequest | null>(null);
  const alive = useRef(true), seq = useRef(0), sending = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; seq.current++; }; }, []);
  useEffect(() => { if (active) void refresh(); }, [active]);
  function failed(e: unknown) { if (e instanceof ProductApiError && e.status === 401) onExpired(e); }
  async function refresh() {
    if (sending.current) return;
    const n = ++seq.current;
    try { const next = await readProjectDirection(projectId); if (alive.current && n === seq.current) setView(next); }
    catch (e) { if (alive.current && n === seq.current) { failed(e); setMessage("方向事实读取失败，请重试；不能判断为尚未确认。"); } }
  }
  async function submit(kind: "generate" | "confirm") {
    if (readOnly || sending.current || unsaved) return;
    sending.current = true; setBusy(true); setMessage(""); seq.current++;
    let request = pending;
    try {
      if (!request) {
        const sameSession = captureOperatorWriteSession(); sameSession();
        const metadata = { contractVersion, requestId: `request-${crypto.randomUUID()}`, idempotencyKey: newIdempotencyKey() };
        if (kind === "generate") {
          const scopeIdentities = directionIdentitiesSchema.parse(identities.map(i => ({ ...i, canonicalRef: i.canonicalRef.trim() })));
          const draft = await readPlanningDraft(projectId);
          sameSession();
          const missing = missingDirectionScopeFields(draft.inputs, scopeIdentities);
          if (missing.length) { setMessage(`请在目标或周期分区补齐并保存：${missing.map(key => fieldLabels[key]).join("、")}。本次没有调用模型。`); return; }
          request = new PreparedDirectionRequest(kind, { metadata, projectId, expectedProjectVersion: draft.projectFactVersion, expectedDraftVersion: draft.draftVersion, identities: scopeIdentities });
        } else {
          if (!view?.proposal || view.approval || view.attempt?.state === "requested") throw new Error("scope");
          request = new PreparedDirectionRequest(kind, { metadata, projectId, expectedProjectVersion: view.projectVersion, proposalId: view.proposal.proposalId, snapshotDigest: view.proposal.snapshotDigest });
        }
        if (!alive.current) return; setPending(request);
      }
      const next = await request.send(); if (!alive.current) return;
      setView(next); setPending(null); onFactsChanged();
      setMessage(next.approval ? "方向已确认并留存批准范围；执行条件尚未就绪。" : next.attempt?.state === "proposed" ? "真实模型方向已生成，请逐项核对范围后确认。" : next.attempt?.state === "requested" ? "原模型请求尚在处理，请读取方向结果；不要重复提交。" : next.attempt?.state === "facts_changed" ? "生成期间事实已变化，结果未采用；请核对当前草案后重新生成。" : "配置模型未返回可用方向；未采用模板，请读取结果后重试。");
    } catch (e) {
      if (!alive.current) return; failed(e);
      if (!request || isDefinitiveProjectRejection(e)) { setPending(null); setMessage("输入或版本不满足要求。请选择每行平台和分成资格阶段，填写仅含字母、数字、下划线或短横线的身份编号（不可重复）；保存完整草案后重试。输入保留。"); }
      else setMessage("提交结果尚未确认，保留原请求；请接续原请求或读取方向结果。");
    } finally { sending.current = false; if (alive.current) setBusy(false); }
  }
  const proposal = view?.approval?.proposal ?? view?.proposal;
  return <section aria-label="初始业务方向" className="panel direction-panel" hidden={!active}>
    <div className="section-heading"><div><h3>初始业务方向</h3><p className="muted">先保存完整目标与周期，再生成方向；确认保存本次明确范围。</p></div><button className="outline-button" disabled={busy} onClick={() => void refresh()}>读取方向结果</button></div>
    {message && <p role="status" className="feedback">{message}</p>}
    {!view ? <p>方向事实待读取。</p> : <>
      <p role="status">{view.approval ? "方向已确认 · 执行条件未就绪" : "尚无已确认方向"}{view.attempt?.state === "requested" && " · 模型请求处理中"}</p>
      {!view.approval && <><fieldset disabled={readOnly || busy || !!pending || view.attempt?.state === "requested"} aria-label="发布身份范围">
        <legend>发布身份范围</legend>
        <p className="form-note">逐项填写 Page／频道编号和正式分成资格阶段。声明不等于身份、资格或管理权限已核验；不填写主页网址。</p>
        {identities.map((identity, index) => <div className="direction-identity-row" key={index}>
          <label>平台<select aria-label={`发布平台 ${index + 1}`} value={identity.platform} onChange={e => setIdentities(rows => rows.map((r, i) => i === index ? { ...r, platform: e.target.value } : r))}><option value="">请选择平台</option><option value="facebook">Facebook Page</option><option value="youtube">YouTube 频道</option></select></label>
          <label>Page／频道编号<input aria-label={`发布身份编号 ${index + 1}`} value={identity.canonicalRef} maxLength={150} pattern="[A-Za-z0-9_-]+" onChange={e => setIdentities(rows => rows.map((r, i) => i === index ? { ...r, canonicalRef: e.target.value } : r))} /></label>
          <label>分成资格阶段<select aria-label={`分成资格阶段 ${index + 1}`} value={identity.declaredStage} onChange={e => setIdentities(rows => rows.map((r, i) => i === index ? { ...r, declaredStage: e.target.value } : r))}><option value="">请选择阶段</option><option value="before_monetization">正式开通前</option><option value="after_monetization">正式开通后</option></select></label>
          {!readOnly && <button className="outline-button" aria-label={`移除发布身份 ${index + 1}`} disabled={identities.length === 1} onClick={() => setIdentities(rows => rows.filter((_, i) => i !== index))}><Trash size={18} />移除</button>}
        </div>)}
        {!readOnly && <button className="text-button" disabled={identities.length >= 100} onClick={() => setIdentities(rows => [...rows, { platform: "", canonicalRef: "", declaredStage: "" }])}><Plus size={18} />添加发布身份</button>}
      </fieldset>
        {!readOnly && <button disabled={busy || unsaved || view.attempt?.state === "requested" || !!pending} onClick={() => void submit("generate")}>{busy ? "处理中…" : "生成初始方向"}</button>}</>}
      {proposal && <div className="direction-review"><h4>{view.approval ? "已确认的方向与范围" : "待核对方向与范围"}</h4>{view.approval && <p>确认人：{view.approval.confirmedByOperatorName}；确认时间：{view.approval.confirmedAt}。</p>}<p className="direction-copy">{proposal.output.direction}</p><p className="direction-copy">{proposal.output.rationale}</p>
        <p className="muted">模型：{proposal.modelKey}；生成时间：{proposal.generatedAt}；依据草案 v{proposal.draftVersion}。</p>
        <dl className="project-facts">{Object.entries(proposal.scope.inputs).map(([key, value]) => <div key={key}><dt>{fieldLabels[key] ?? key}</dt><dd>{Array.isArray(value) ? value.map(v => values[v] ?? v).join("、") : value && typeof value === "object" ? `${value.startsAt} 至 ${value.endsAt}（结束不含）` : typeof value === "string" ? values[value] ?? value : String(value ?? "未配置；不授予该阶段范围")}</dd></div>)}<div><dt>发布身份与声明阶段</dt><dd>{proposal.scope.identities.map(i => `${i.platform}/${i.canonicalRef}（${i.declaredStage === "before_monetization" ? "开通前" : "开通后"}）`).join("、")}</dd></div></dl>
        <h4>自主推进与确认边界</h4><p>范围内选择成品、匹配身份、安排时段、生成文案，并依据真实可比反馈调整未开始安排。改变主目标或已确认方向、超出范围须重新确认。</p><p>开通前优先推进分成资格并保留引流；开通后遵循本次优先级。同内容同平台名额、连载身份与顺序、实际素材版本、手机现行授权与互斥始终适用。</p>
        {proposal.output.limitations.length > 0 && <><h4>模型说明的限制</h4><ul>{proposal.output.limitations.map((v, i) => <li key={i}>{v}</li>)}</ul></>}
        {!readOnly && !view.approval && <><p>确认后，就绪任务可在此范围内自主推进，无需再点击启动或逐条审批；缺少条件的任务保持阻断。修改草案不会改写本次批准范围。</p><button disabled={busy || !!pending || unsaved || view.attempt?.state === "requested"} onClick={() => void submit("confirm")}>确认方向</button></>}
      </div>}
      <h4>执行前待补齐</h4><ul>{view.blockers.map(b => <li key={b}>{b}</li>)}</ul>
      <p className="form-note">当前未派发手机任务，未开启公开发布。</p>
      {!readOnly && pending && <button disabled={busy || unsaved} onClick={() => void submit("generate")}>接续原方向请求</button>}
    </>}
  </section>;
}
