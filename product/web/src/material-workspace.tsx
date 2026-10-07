import { useEffect, useRef, useState } from "react";
import { contractVersion, saveMaterialDeclarationRequestSchema, materialAnalysisResponseSchema, type MaterialAnalysisResponse } from "@socialgrowth/product-contracts";
import type { ProjectDirectionView, ProjectPlanningDraftView } from "@socialgrowth/product-contracts";
import { ArrowClockwise, FileVideo, UploadSimple } from "@phosphor-icons/react";
import { listProjectMaterials, readProjectMaterial, type MaterialCurrentView, type MaterialUploadPage } from "./material-api.js";
import { readProjectDirection } from "./project-direction-api.js";
import { readPlanningDraft, samePlanningInputs } from "./project-planning-api.js";
import { MaterialUploadInventoryPanel } from "./material-upload-inventory-panel.js";
import { MaterialCandidateStatus, materialEligibilityLabel } from "./material-candidate-status.js";
import { MaterialScopeConfirmation } from "./material-scope-confirmation.js";
import { PreparedMaterialDeclaration } from "./material-save-api.js";
import { MaterialFileTransfer } from "./material-file-transfer.js";
import { isDefinitiveProjectRejection, newIdempotencyKey, ProductApiError, prepareOperatorPost } from "./operator-api.js";
type Input = ReturnType<typeof saveMaterialDeclarationRequestSchema.parse>;
interface Row { id: string; filename: string; input: Input; saved?: MaterialCurrentView; transfer?: MaterialFileTransfer;
  preview?: File; uploaded: boolean; dirty: boolean; error: string; pending?: PreparedMaterialDeclaration; uploading?: boolean; observed?: MaterialCurrentView;
  firstUseConfirmed: boolean; evidenceText: string; analysis?: MaterialAnalysisResponse; analyzing?: boolean; }
function newInput(projectId: string): Input {
  return { metadata: { contractVersion, requestId: `request-${crypto.randomUUID()}`, idempotencyKey: newIdempotencyKey() }, projectId,
    contentUnitId: crypto.randomUUID(), variantId: crypto.randomUUID(), sourceId: null, sourceRecordId: null, languageTag: "",
    expectedCurrentRevision: 0, identity: { mediaKind: "video", businessKind: "product", businessEntityId: "", seriesId: null, episodeNumber: null },
    declaration: { name: "", description: "", businessFacts: "", sourceStatement: "", sourceEvidenceIds: [], firstUseDeclaration: "unknown",
      expectedApprovedDirectionId: null, expectedApprovedProjectVersion: null, contentRulesReviewed: false }, objectIds: [] };
}
const fromSaved = (v: MaterialCurrentView): Row => ({ id: v.variantId, filename: v.declaration.name, saved: v, uploaded: true, dirty: false, error: "", firstUseConfirmed: v.declaration.firstUseDeclaration === "declared_not_previously_published", evidenceText: v.declaration.sourceEvidenceIds.join(","),
  input: { ...newInput(v.projectId), contentUnitId: v.contentUnitId, variantId: v.variantId, sourceId: v.sourceId, sourceRecordId: v.sourceRecordId,
    languageTag: v.languageTag, expectedCurrentRevision: v.currentRevision, identity: v.identity, declaration: v.declaration, objectIds: v.objects.map(o => o.objectId) } });
const message = (e: unknown) => e instanceof ProductApiError && e.response.error.code === "FACT_VERSION_STALE"
  ? "保存版本或关系已经变化。输入保留；请读取当前记录核对后再保存。"
  : "请求未完成或结果待确认；保留原文件及输入，请重试原请求。";
function approvedScope(view: ProjectDirectionView | null, draft: ProjectPlanningDraftView | null) {
  const approval = view?.approval;
  if (!view || !approval || !draft || draft.projectFactVersion !== view.projectVersion
    || view.projectVersion !== approval.proposal.projectVersion + 1 || draft.draftVersion !== approval.proposal.draftVersion
    || !samePlanningInputs(draft.inputs, approval.proposal.scope.inputs)) return null;
  return { directionId: approval.approvalId, projectVersion: view.projectVersion, direction: approval.proposal.output.direction,
    languages: approval.proposal.scope.inputs.targetLanguages, contentForms: approval.proposal.scope.inputs.contentForms };
}

export function MaterialWorkspace({ projectId, active, readOnly, onExpired }: {
  projectId: string; active: boolean; readOnly: boolean; onExpired: (e: unknown) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]), [loaded, setLoaded] = useState(false), [loading, setLoading] = useState(false);
  const [direction, setDirection] = useState<ProjectDirectionView | null>(null), [directionLoaded, setDirectionLoaded] = useState(false), [directionError, setDirectionError] = useState("");
  const [planning, setPlanning] = useState<ProjectPlanningDraftView | null>(null);
  const [uploadInventoryRefresh, setUploadInventoryRefresh] = useState(0);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all"), [selected, setSelected] = useState<string[]>([]), [editing, setEditing] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null), [bulkLanguage, setBulkLanguage] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false), [overwrite, setOverwrite] = useState(false), [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const alive = useRef(true), revision = useRef(0), check = useRef<HTMLInputElement>(null);
  const currentReads = useRef(new Map<string, number>());
  const row = rows.find(r => r.id === editing);
  useEffect(() => { alive.current = true; return () => { alive.current = false; revision.current++; }; }, []);
  useEffect(() => {
    if (active) void refresh(false);
  }, [active, projectId]);
  useEffect(() => {
    if (!row?.preview) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(row.preview); setPreviewUrl(url); return () => URL.revokeObjectURL(url);
  }, [row?.preview]);
  const visible = rows.filter(r => (filter !== "pending" || !r.uploaded || r.dirty || r.saved?.status === "pending_validation")
    && (filter !== "upload" || !r.uploaded) && `${r.filename} ${r.input.declaration.name}`.toLowerCase().includes(query.toLowerCase()));
  const selectable = visible.filter(r => r.uploaded && !r.pending && !r.uploading).map(r => r.id);
  useEffect(() => { if (check.current) check.current.indeterminate = selected.length > 0 && selected.length < selectable.length; }, [selected.length, selectable.length]);
  function update(id: string, fn: (r: Row) => Row) { setRows(previous => previous.map(r => r.id === id ? fn(r) : r)); }
  function expired(e: unknown) { if (e instanceof ProductApiError && e.status === 401) { onExpired(e); return true; } return false; }
  async function refresh(more: boolean) {
    const read = ++revision.current; setLoading(true); setError(""); setSelected([]);
    if (!more) { setDirectionLoaded(false); setDirectionError(""); }
    try {
      const page = await listProjectMaterials(projectId, more ? cursor : null, 50);
      if (!alive.current || read !== revision.current) return;
      setRows(previous => {
        // Reads never erase unsaved/uncertain intents. Append pagination pages;
        // a refresh restarts the UUID inventory (not a frozen snapshot).
        const currentByVariant = new Map(page.materials.map(material => [material.variantId, material]));
        const retained = previous.filter(r => more || r.dirty || r.pending || r.transfer).map(r => {
          const latest = currentByVariant.get(r.id);
          // Preserve local edits and frozen requests while refreshing only the
          // independently observed current status/reason for this variant.
          return latest ? { ...r, saved: latest } : r;
        });
        const ids = new Set(retained.map(r => r.id));
        return [...retained, ...page.materials.filter(v => !ids.has(v.variantId)).map(fromSaved)];
      }); setLoaded(true); setCursor(page.nextAfterVariantId);
      try {
        const [currentDirection, currentPlanning] = await Promise.all([readProjectDirection(projectId), readPlanningDraft(projectId)]);
        if (alive.current && read === revision.current) { setDirection(currentDirection); setPlanning(currentPlanning); setDirectionLoaded(true); setDirectionError(""); }
      } catch (e) {
        if (!alive.current || read !== revision.current) return;
        if (!expired(e)) setDirectionError("当前已确认方向尚未读取；素材可继续保存为待检查，但不能确认候选范围。");
      }
    } catch (e) { if (alive.current && read === revision.current && !expired(e)) setError("素材事实读取失败；不是空素材库，请重试。"); }
    finally { if (alive.current && read === revision.current) setLoading(false); }
  }
  function add(files: FileList | null) {
    if (readOnly || busy || !files) return;
    const added: Row[] = [];
    for (const file of Array.from(files)) {
      try {
        const transfer = new MaterialFileTransfer(projectId, file), input = newInput(projectId);
        input.objectIds = [transfer.objectId];
        // Filename is a label, not inferred business name/language/episode.
        added.push({ id: input.variantId, filename: file.name, preview: file, input, transfer, uploaded: false, dirty: true, error: "", firstUseConfirmed: false, evidenceText: "" });
      } catch { setError("部分文件未加入：支持 MP4/JPEG/PNG/WebP，非空且单文件不超过 64 MiB。"); }
    }
    setRows(prev => [...prev, ...added]);
  }
  function continueUploaded(ticket: MaterialUploadPage["tickets"][number]) {
    if (readOnly || busy || ticket.status !== "verified_bytes") return;
    const existing = rows.find(value => value.input.objectIds.includes(ticket.objectId));
    if (existing) { setEditing(existing.id); return; }
    // Reuse the persisted bytes, never infer source, language, first use or
    // publication rights from an object ID or its content type.
    const input = newInput(projectId);
    if (ticket.contentType === "video/mp4") input.identity.mediaKind = "video";
    else if (["image/jpeg", "image/png", "image/webp"].includes(ticket.contentType)) input.identity.mediaKind = "image_text";
    else return;
    input.objectIds = [ticket.objectId];
    setRows(previous => [...previous, { id: input.variantId, filename: ticket.contentType === "video/mp4" ? "已上传切片" : "已上传图片", input,
      uploaded: true, dirty: true, error: "", firstUseConfirmed: false, evidenceText: "" }]);
    setQuery(""); setFilter("all"); setEditing(input.variantId);
  }
  async function upload(r: Row) {
    if (readOnly || busy || !r.transfer || r.uploading) return;
    update(r.id, v => ({ ...v, uploading: true, error: "" }));
    try { await r.transfer.send(); if (alive.current) { update(r.id, v => ({ ...v, uploaded: true })); setUploadInventoryRefresh(v => v + 1); } }
    catch (e) { if (alive.current && !expired(e)) update(r.id, v => ({ ...v, error: message(e) })); }
    finally { if (alive.current) update(r.id, v => ({ ...v, uploading: false })); }
  }
  function edit(input: Input) {
    if (!row || readOnly || busy || row.pending) return;
    update(row.id, r => ({ ...r, input, dirty: true, error: "" }));
  }
  async function analyze(r: Row) {
    if (readOnly || busy || r.pending || r.analyzing || !r.uploaded) return;
    const current = revision.current;
    update(r.id, value => ({ ...value, analyzing: true, error: "", analysis: undefined }));
    try {
      const objectId = r.input.objectIds[0];
      const result = await prepareOperatorPost(`/api/operator/projects/${projectId}/material-uploads/${objectId}/analyze`, "{}", materialAnalysisResponseSchema)();
      if (!alive.current || revision.current !== current) return;
      if (result.projectId !== projectId.toLowerCase() || result.objectId !== objectId) throw new Error("MATERIAL_SCOPE_CHANGED");
      update(r.id, value => ({ ...value, analysis: result }));
    } catch (cause) {
      if (!alive.current || revision.current !== current || expired(cause)) return;
      update(r.id, value => ({ ...value, error: cause instanceof ProductApiError ? cause.response.error.message : "切片分析未完成，原资料已保留；请重试。" }));
    } finally { if (alive.current) update(r.id, value => ({ ...value, analyzing: false })); }
  }
  async function save(targets: Row[]) {
    if (readOnly || busy) return;
    setBusy(true); setError(""); let saved = 0, failed = 0;
    revision.current++; setLoading(false);
    try {
      for (const r of targets) {
        if (!alive.current) return;
        if (!r.uploaded || r.uploading) { failed++; update(r.id, v => ({ ...v, error: "文件尚未校验，先上传；其他项可独立保存。" })); continue; }
        try {
          let requestInput = r.input;
          if (!r.pending) {
            let currentDirection: ProjectDirectionView, currentPlanning: ProjectPlanningDraftView;
            try { [currentDirection, currentPlanning] = await Promise.all([readProjectDirection(projectId), readPlanningDraft(projectId)]); }
            catch (e) {
              if (!alive.current || expired(e)) return;
              update(r.id, v => ({ ...v, error: "当前已确认方向未能读取；未保存本条，请重试，不能按旧范围判断候选。" })); failed++; continue;
            }
            if (alive.current) { setDirection(currentDirection); setPlanning(currentPlanning); setDirectionLoaded(true); setDirectionError(""); }
            const currentScope = approvedScope(currentDirection, currentPlanning);
            const currentId = currentScope?.directionId ?? null, currentVersion = currentScope?.projectVersion ?? null;
            const scopeChanged = r.input.declaration.expectedApprovedDirectionId !== currentId || r.input.declaration.expectedApprovedProjectVersion !== currentVersion;
            if (scopeChanged && r.input.declaration.contentRulesReviewed) {
              update(r.id, v => ({ ...v, input: { ...v.input, declaration: { ...v.input.declaration,
                expectedApprovedDirectionId: currentId, expectedApprovedProjectVersion: currentVersion, contentRulesReviewed: false } }, dirty: true,
              error: "已确认方向或周期草案发生变化；当前确认已清除。请核对新范围并重新勾选后保存。" })); failed++; continue;
            }
            requestInput = { ...r.input, identity: { ...r.input.identity, businessEntityId: r.input.identity.businessEntityId || r.input.contentUnitId }, declaration: { ...r.input.declaration, expectedApprovedDirectionId: currentId,
              expectedApprovedProjectVersion: currentVersion, contentRulesReviewed: currentScope ? r.input.declaration.contentRulesReviewed : false } };
          }
          const pending = r.pending ?? new PreparedMaterialDeclaration(saveMaterialDeclarationRequestSchema.parse(requestInput));
          update(r.id, v => ({ ...v, pending }));
          const result = await pending.send(); if (!alive.current) return;
          update(r.id, v => ({ ...fromSaved(result), preview: v.preview, filename: v.filename })); saved++;
        } catch (e) {
          if (!alive.current || expired(e)) return;
          // Invalid local forms never create a prepared request. All sent
          // failures retain their frozen original intent for explicit retry.
          update(r.id, v => ({ ...v, pending: isDefinitiveProjectRejection(e) ? undefined : v.pending,
            error: v.pending ? message(e) : "请填写名称、语言、内容说明与业务信息；来源资料可以留空。" })); failed++;
        }
      }
      if (alive.current) { setSelected([]); setError(`已保存 ${saved} 项，${failed} 项仍需处理。候选状态按当前素材与批准范围读取；发布许可仍关闭。`); }
    } finally { if (alive.current) setBusy(false); }
  }
  function changeFilter(next: string) { setFilter(next); setSelected([]); }
  const dirty = rows.filter(r => r.dirty || r.pending);
  const currentScope = approvedScope(direction, planning);
  const scopeState = !directionLoaded || !!directionError ? "unavailable" as const : !direction?.approval ? "none" as const
    : currentScope ? "current" as const : "stale" as const;
  return <section className="material-workspace" hidden={!active} aria-label="项目素材">
    <div className="section-heading"><div><h2>素材</h2><p className="muted">上传切片后，可由 AI 提取内容信息，再保存到当前项目。</p></div><div className="material-actions">
      <button className="outline-button" disabled={loading || busy} onClick={() => void refresh(false)}><ArrowClockwise size={18} />刷新素材</button>
      {!readOnly && <label className="file-picker"><UploadSimple size={18} />选择成品<input type="file" multiple accept="video/mp4,image/jpeg,image/png,image/webp" onChange={e => { add(e.target.files); e.target.value = ""; }} disabled={busy} /></label>}</div></div>
    {error && <p role="status" className="feedback">{error}</p>}{loading && <p role="status">正在读取素材事实…</p>}
    <div className="material-filters"><label>状态<select value={filter} onChange={e => changeFilter(e.target.value)}><option value="all">当前已加载全部 {rows.length} 项</option><option value="pending">待补充／待检查</option><option value="upload">待上传／结果待确认</option></select></label>
      <label>搜索素材<input value={query} onChange={e => { setQuery(e.target.value); setSelected([]); }} /></label></div>
    <div className="panel material-table"><div className="material-selection">已选 {selected.length} 项<button className="outline-button" disabled={readOnly || busy || !selected.length} onClick={() => setBulkOpen(true)}>批量填写语言</button><button className="text-button" onClick={() => setSelected([])}>取消选择</button></div>
      {!loaded && !rows.length ? <p>素材事实尚未读取；加载失败不能判断为空。</p> : !rows.length ? <div className="empty-state"><FileVideo size={32} /><h3>尚无已登记素材</h3><p>选择成品后逐项上传并补齐人工资料。</p></div> : <div className="table-wrap"><table><thead><tr><th><input ref={check} type="checkbox" aria-label="选择当前可操作行" disabled={readOnly || busy || !selectable.length} checked={!!selectable.length && selected.length === selectable.length} onChange={e => setSelected(e.target.checked ? selectable : [])} /></th><th>文件／名称</th><th>业务关系</th><th>语言</th><th>文件与资料状态</th><th>操作</th></tr></thead><tbody>
        {visible.map(r => <tr key={r.id} className={selected.includes(r.id) ? "material-selected" : ""}><td><input type="checkbox" aria-label={`选择 ${r.filename}`} checked={selected.includes(r.id)} disabled={readOnly || busy || !selectable.includes(r.id)} onChange={e => setSelected(v => e.target.checked ? [...v, r.id] : v.filter(id => id !== r.id))} /></td>
          <td><FileVideo size={18} aria-hidden /> {r.filename}<small>{r.input.declaration.name || "内容名称未填写"}</small></td><td>{r.input.identity.businessKind === "drama" ? "短剧" : "商品"}<small>{r.input.identity.businessEntityId || "关系待确认"}{r.input.identity.episodeNumber && ` · 第${r.input.identity.episodeNumber}集`}</small></td><td>{r.input.languageTag || "未填写"}</td>
          <td><span className="status">{r.uploaded ? "文件字节已校验" : r.uploading ? "上传中" : "待上传／待确认"}</span><small>{r.pending ? "保存结果待确认" : r.dirty ? "有未保存资料" : r.saved ? `资料已保存 v${r.saved.currentRevision} · ${r.saved.candidateAllowed ? "素材候选" : `待检查：${materialEligibilityLabel(r.saved.eligibilityReason)}`}` : "未保存资料"}</small>{r.error && <p role="status" className="material-row-error">{r.error}</p>}</td>
          <td><button className="text-button" disabled={busy} onClick={() => setEditing(r.id)}>预览／资料</button>{!r.uploaded && r.transfer && <button className="text-button" disabled={readOnly || busy || r.uploading} onClick={() => void upload(r)}>上传／重试原文件</button>}</td></tr>)}
      </tbody></table></div>}
      {cursor && <button className="outline-button" disabled={loading || busy} onClick={() => void refresh(true)}>加载下一页</button>}
    </div>
    <div className="material-save-scope"><p>保存范围：当前项目全部 {dirty.length} 项未保存／待确认资料（包括筛选隐藏项）；不是勾选范围。刷新或翻页清除勾选，保留草稿。</p><details><summary>查看保存对象</summary>{dirty.map(r => <p key={r.id}>{r.filename} · {r.id}</p>)}</details>
      {!readOnly && <button disabled={busy || !dirty.length || rows.some(r => r.uploading)} onClick={() => void save(dirty)}>{busy ? "保存中…" : "保存资料"}</button>}<p className="form-note">不生成示例素材、权利证明或发布资格；关闭页面会丢失未保存文件与草稿，原请求未知时请先接续。</p></div>
    <MaterialUploadInventoryPanel projectId={projectId} active={active} refreshVersion={uploadInventoryRefresh} onExpired={onExpired} readOnly={readOnly || busy} onContinue={continueUploaded} />
    {bulkOpen && <section className="panel" aria-label="批量填写语言"><h3>当前选择 {selected.length} 项</h3><label>语言标签<input value={bulkLanguage} onChange={e => setBulkLanguage(e.target.value)} placeholder="例如 es；请按真实语言填写" /></label><label className="material-inline-check"><input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} />明确覆盖已有语言（默认仅填空值）</label>
      <ul>{rows.filter(r => selected.includes(r.id)).map(r => <li key={r.id}>{r.filename}：{r.input.languageTag || "空"} → {r.saved || (r.input.languageTag && !overwrite) ? "保留（已有身份不可改语言）" : bulkLanguage || "待填写"}</li>)}</ul>
      <button disabled={readOnly || busy || !bulkLanguage} onClick={() => { setRows(prev => prev.map(r => selected.includes(r.id) && !r.saved && !r.pending && (!r.input.languageTag || overwrite) ? { ...r, input: { ...r.input, languageTag: bulkLanguage }, dirty: true } : r)); setBulkOpen(false); }}>应用到待保存资料</button><button className="text-button" onClick={() => setBulkOpen(false)}>取消</button></section>}
    {row && <section className="panel material-editor" aria-label="素材资料详情"><div className="section-heading"><h3>{row.filename} · 素材资料</h3><button className="text-button" onClick={() => setEditing(null)}>保留草稿返回</button></div>
      {!directionLoaded && <p role="status">正在读取当前已确认方向范围…</p>}{directionError && <p role="status" className="feedback">{directionError}</p>}
      {previewUrl ? row.preview?.type.startsWith("image/") ? <img className="material-preview" src={previewUrl} alt="所选本地文件预览" /> : <video className="material-preview" src={previewUrl} controls /> : <p className="form-note">已保存原文件；当前页面暂不支持在线播放，可直接提取切片内容。</p>}
      <details><summary>{row.uploaded ? "原文件已校验 · 查看文件标识" : "文件尚未上传完成"}</summary><p>文件版本只读：{row.input.objectIds.join("、")}</p></details>
      {row.input.identity.mediaKind === "video" && row.uploaded && <div className="material-analysis">
        {!readOnly && <button className="outline-button" disabled={busy || !!row.pending || row.analyzing} onClick={() => void analyze(row)}>{row.analyzing ? "正在分析切片…" : "AI 提取切片信息"}</button>}
        <p className="form-note" role="status">{row.analyzing ? "正在读取视频画面和字幕，通常需要几十秒；现有资料会保留。" : "提取语言、剧情摘要和标题草稿。当前分析画面与字幕，尚不包含音频对白。"}</p>
        {row.analysis && <div aria-label="切片分析结果">
          <h4>{row.analysis.output.title}</h4><p>{row.analysis.output.summary}</p>
          <p>语言：{row.analysis.output.languageTag ?? "暂未识别"} · 时长：{Math.round(row.analysis.durationSeconds)} 秒 · {row.analysis.width} × {row.analysis.height}</p>
          <p>配文草稿：{row.analysis.output.caption}</p>
          {row.analysis.output.limitations.length > 0 && <ul>{row.analysis.output.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul>}
          {!readOnly && <button disabled={busy || !!row.pending || row.analyzing} onClick={() => edit({ ...row.input,
            languageTag: row.saved ? row.input.languageTag : row.analysis!.output.languageTag ?? row.input.languageTag,
            declaration: { ...row.input.declaration, name: row.analysis!.output.title.replace(/\s+/g, " ").trim(), description: row.analysis!.output.summary.replace(/\s+/g, " ").trim(),
              businessFacts: `AI 根据抽样画面生成的内容草稿：${row.analysis!.output.summary.replace(/\s+/g, " ").trim()}` } })}>应用到素材资料</button>}
          <p className="form-note">应用会替换名称、内容说明和业务信息；点击保存后才会登记到项目。来源和集序仍保留原值。</p>
        </div>}
      </div>}
      <fieldset disabled={readOnly || busy || !!row.pending}><div className="material-form-grid">
        <label>内容名称<input value={row.input.declaration.name} onChange={e => edit({ ...row.input, declaration: { ...row.input.declaration, name: e.target.value } })} /></label>
        <label>语言标签<input disabled={!!row.saved} value={row.input.languageTag} onChange={e => edit({ ...row.input, languageTag: e.target.value })} /></label>
        <label>成品类型<select disabled={!!row.saved} value={row.input.identity.mediaKind} onChange={e => edit({ ...row.input, identity: { ...row.input.identity, mediaKind: e.target.value as Input["identity"]["mediaKind"], seriesId: null, episodeNumber: null } })}><option value="video">视频</option><option value="image_text">图文</option></select></label>
        <label>业务类型<select aria-label="业务类型" disabled={!!row.saved} value={row.input.identity.businessKind} onChange={e => edit({ ...row.input, identity: { ...row.input.identity, businessKind: e.target.value as Input["identity"]["businessKind"], seriesId: null, episodeNumber: null } })}><option value="product">商品</option><option value="drama">短剧</option></select></label>
        {(["description", "businessFacts"] as const).map((key, i) => <label key={key}>{["内容说明", "业务信息"][i]}<textarea aria-label={["内容说明", "业务信息"][i]} value={row.input.declaration[key]} onChange={e => edit({ ...row.input, declaration: { ...row.input.declaration, [key]: e.target.value } })} /></label>)}
      </div><details><summary>补充来源与关联资料（选填）</summary><div className="material-form-grid">
        <label>来源声明<textarea value={row.input.declaration.sourceStatement} onChange={e => edit({ ...row.input, declaration: { ...row.input.declaration, sourceStatement: e.target.value } })} /></label>
        <label>已有来源证明记录标识（逗号分隔 UUID）<textarea aria-label="已有来源证明记录标识（逗号分隔 UUID）" value={row.evidenceText} onChange={e => { const text = e.target.value; update(row.id, r => ({ ...r, evidenceText: text, dirty: true, error: "", input: { ...r.input, declaration: { ...r.input.declaration, sourceEvidenceIds: text.split(",").map(v => v.trim()).filter(Boolean) } } })); }} /></label>
        <label>商品／短剧业务标识 UUID（留空自动生成）<input disabled={!!row.saved} value={row.input.identity.businessEntityId} onChange={e => edit({ ...row.input, identity: { ...row.input.identity, businessEntityId: e.target.value } })} /></label>
        <label>来源主体标识 UUID（选填）<input disabled={!!row.saved} value={row.input.sourceId ?? ""} onChange={e => edit({ ...row.input, sourceId: e.target.value || null })} /></label>
        <label>原成品来源记录 UUID（选填）<input disabled={!!row.saved} value={row.input.sourceRecordId ?? ""} onChange={e => edit({ ...row.input, sourceRecordId: e.target.value || null })} /></label>
        {row.input.identity.businessKind === "drama" && row.input.identity.mediaKind === "video" && <><label>连载标识 UUID（独立宣传片留空）<input disabled={!!row.saved} value={row.input.identity.seriesId ?? ""} onChange={e => edit({ ...row.input, identity: { ...row.input.identity, seriesId: e.target.value || null } })} /></label><label>明确集序（不从文件名推断）<input disabled={!!row.saved} type="number" min="1" value={row.input.identity.episodeNumber ?? ""} onChange={e => edit({ ...row.input, identity: { ...row.input.identity, episodeNumber: e.target.value ? Number(e.target.value) : null } })} /></label></>}
      </div><label className="material-inline-check"><input type="checkbox" checked={row.firstUseConfirmed} onChange={e => update(row.id, r => ({ ...r, firstUseConfirmed: e.target.checked, dirty: true, error: "", input: { ...r.input, declaration: { ...r.input.declaration, firstUseDeclaration: e.target.checked ? "declared_not_previously_published" : "unknown" } } }))} />已确认此成品此前未发布（选填；未确认时保留未知）</label></details></fieldset>
      <MaterialScopeConfirmation state={scopeState} directionId={currentScope?.directionId ?? null} projectVersion={currentScope?.projectVersion ?? null}
        direction={currentScope?.direction ?? null} languages={currentScope?.languages ?? []} contentForms={currentScope?.contentForms ?? []}
        reviewed={!!row.input.declaration.contentRulesReviewed && row.input.declaration.expectedApprovedDirectionId === (currentScope?.directionId ?? null)
          && row.input.declaration.expectedApprovedProjectVersion === (currentScope?.projectVersion ?? null)}
        disabled={readOnly || busy || !!row.pending || !currentScope || !!directionError}
        onReviewedChange={checked => { update(row.id, r => ({ ...r, input: { ...r.input, declaration: { ...r.input.declaration,
          expectedApprovedDirectionId: currentScope?.directionId ?? null, expectedApprovedProjectVersion: currentScope?.projectVersion ?? null, contentRulesReviewed: checked } }, dirty: true, error: "" })); }} />
      {row.saved && <MaterialCandidateStatus status={row.saved.status} candidateAllowed={row.saved.candidateAllowed} eligibilityReason={row.saved.eligibilityReason} publicationAllowed={row.saved.publicationAllowed} />}
      <p className="form-note">当前切片测试可先保存内容资料，来源资料留空表示尚未提供；业务标识留空时系统生成登记标识。</p>
      {!readOnly && <button disabled={busy || !row.dirty || row.uploading || row.analyzing} onClick={() => void save([row])}>{row.pending ? "核对并接续保存" : "保存素材资料"}</button>}{row.pending && <p role="status">保存结果待确认，输入已保留；再次操作会核对同一请求。</p>}
      {row.saved && row.dirty && <button className="outline-button" disabled={busy} onClick={() => void readCurrent(row)}>读取当前版本核对</button>}
      {row.observed && <div className="project-conflict"><h4>当前保存 v{row.observed.currentRevision}</h4><pre>{JSON.stringify({ language: row.observed.languageTag, identity: row.observed.identity, declaration: row.observed.declaration, objects: row.observed.objects.map(o => o.objectId) }, null, 2)}</pre>
        <p>本人表单输入仍保留。采用最新版本只更新保存基线，下一次保存会提交表单中的全部资料；请逐项核对。</p><button className="outline-button" disabled={busy || !!row.pending || readOnly} onClick={() => adoptCurrent(row)}>已核对，采用最新版本</button></div>}
      {row.error && <p role="status">{row.error}</p>}
    </section>}
  </section>;
  function adoptCurrent(r: Row) {
    const observed = r.observed;
    if (!observed || readOnly || busy || r.pending) return;
    // Adopting an observation also retires every read already in flight for
    // this material; those responses must not reopen the resolved conflict.
    currentReads.current.set(r.id, (currentReads.current.get(r.id) ?? 0) + 1);
    const metadata = { contractVersion, requestId: `request-${crypto.randomUUID()}`, idempotencyKey: newIdempotencyKey() };
    update(r.id, value => value.observed !== observed ? value : ({ ...value, observed: undefined, saved: observed,
      input: { ...value.input, expectedCurrentRevision: observed.currentRevision, metadata } }));
  }
  async function readCurrent(r: Row) {
    // Only read; do not silently replace the unresolved original command.
    const read = revision.current;
    const sequence = (currentReads.current.get(r.id) ?? 0) + 1;
    currentReads.current.set(r.id, sequence);
    const accepts = () => alive.current && read === revision.current && currentReads.current.get(r.id) === sequence;
    try {
      const current = await readProjectMaterial(projectId, r.id);
      if (accepts()) update(r.id, value => accepts() ? ({ ...value, observed: current }) : value);
    } catch (e) { if (accepts() && !expired(e)) setError("当前版本未读到，原输入保留。"); }
  }
}
