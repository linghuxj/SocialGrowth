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
  const [view, setView] = useState<ProjectDirectionView | null>(null), [refs, setRefs] = useState(""), [message, setMessage] = useState("");
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
          const identities = directionIdentitiesSchema.parse(refs.split(/\n/).map(line => { const [platform, canonicalRef, stage, extra] = line.trim().split("/"); if (extra !== undefined) throw new Error("scope"); return { platform, canonicalRef, declaredStage: stage === "开通前" ? "before_monetization" : stage === "开通后" ? "after_monetization" : null }; }));
          const draft = await readPlanningDraft(projectId);
          sameSession();
          const missing = missingDirectionScopeFields(draft.inputs, identities);
          if (missing.length) { setMessage(`请在目标或周期分区补齐并保存：${missing.map(key => fieldLabels[key]).join("、")}。本次没有调用模型。`); return; }
          request = new PreparedDirectionRequest(kind, { metadata, projectId, expectedProjectVersion: draft.projectFactVersion, expectedDraftVersion: draft.draftVersion, identities });
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
      if (!request || isDefinitiveProjectRejection(e)) { setPending(null); setMessage("输入或版本不满足要求，请保存完整草案、核对身份范围并读取当前方向后重试。输入保留。"); }
      else setMessage("提交结果尚未确认，保留原请求；请接续原请求或读取方向结果。");
    } finally { sending.current = false; if (alive.current) setBusy(false); }
  }
  const proposal = view?.approval?.proposal ?? view?.proposal;
  return <section aria-label="初始业务方向" className="panel direction-panel" hidden={!active}>
    <div className="section-heading"><div><h3>初始业务方向</h3><p className="muted">先保存完整目标与周期，再生成方向；确认保存本次明确范围。</p></div><button className="outline-button" disabled={busy} onClick={() => void refresh()}>读取方向结果</button></div>
    {message && <p role="status" className="feedback">{message}</p>}
    {!view ? <p>方向事实待读取。</p> : <>
      <p role="status">{view.approval ? "方向已确认 · 执行条件未就绪" : "尚无已确认方向"}{view.attempt?.state === "requested" && " · 模型请求处理中"}</p>
      {!view.approval && <><label>发布身份范围（每行 facebook/PageID/开通前 或 youtube/ChannelID/开通后）<textarea aria-label="发布身份范围" value={refs} disabled={readOnly || busy || !!pending || view.attempt?.state === "requested"} onChange={e => setRefs(e.target.value)} /></label>
        <p className="form-note">每个身份明确填写“开通前”或“开通后”，指正式分成资格阶段；填写身份编号，不填主页网址。声明不等于实际资格、分配或初始化核验。</p>
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
