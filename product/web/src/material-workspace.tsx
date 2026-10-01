import { useEffect, useRef, useState } from "react";
import { contractVersion, saveMaterialDeclarationRequestSchema } from "@socialgrowth/product-contracts";
import { ArrowClockwise, FileVideo, UploadSimple } from "@phosphor-icons/react";
import { listProjectMaterials, readProjectMaterial, type MaterialCurrentView } from "./material-api.js";
import { PreparedMaterialDeclaration } from "./material-save-api.js";
import { MaterialFileTransfer } from "./material-file-transfer.js";
import { isDefinitiveProjectRejection, newIdempotencyKey, ProductApiError } from "./operator-api.js";
type Input = ReturnType<typeof saveMaterialDeclarationRequestSchema.parse>;
interface Row { id: string; filename: string; input: Input; saved?: MaterialCurrentView; transfer?: MaterialFileTransfer;
  preview?: File; uploaded: boolean; dirty: boolean; error: string; pending?: PreparedMaterialDeclaration; uploading?: boolean; observed?: MaterialCurrentView;
  firstUseConfirmed: boolean; evidenceText: string; }
function newInput(projectId: string): Input {
  return { metadata: { contractVersion, requestId: `request-${crypto.randomUUID()}`, idempotencyKey: newIdempotencyKey() }, projectId,
    contentUnitId: crypto.randomUUID(), variantId: crypto.randomUUID(), sourceId: "", sourceRecordId: "", languageTag: "",
    expectedCurrentRevision: 0, identity: { mediaKind: "video", businessKind: "product", businessEntityId: "", seriesId: null, episodeNumber: null },
    declaration: { name: "", description: "", businessFacts: "", sourceStatement: "", sourceEvidenceIds: [], firstUseDeclaration: "declared_not_previously_published" }, objectIds: [] };
}
const fromSaved = (v: MaterialCurrentView): Row => ({ id: v.variantId, filename: v.declaration.name, saved: v, uploaded: true, dirty: false, error: "", firstUseConfirmed: true, evidenceText: v.declaration.sourceEvidenceIds.join(","),
  input: { ...newInput(v.projectId), contentUnitId: v.contentUnitId, variantId: v.variantId, sourceId: v.sourceId, sourceRecordId: v.sourceRecordId,
    languageTag: v.languageTag, expectedCurrentRevision: v.currentRevision, identity: v.identity, declaration: v.declaration, objectIds: v.objects.map(o => o.objectId) } });
const message = (e: unknown) => e instanceof ProductApiError && e.response.error.code === "FACT_VERSION_STALE"
  ? "保存版本或关系已经变化。输入保留；请读取当前记录核对后再保存。"
  : "请求未完成或结果待确认；保留原文件及输入，请重试原请求。";

export function MaterialWorkspace({ projectId, active, readOnly, onExpired }: {
  projectId: string; active: boolean; readOnly: boolean; onExpired: (e: unknown) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]), [loaded, setLoaded] = useState(false), [loading, setLoading] = useState(false);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all"), [selected, setSelected] = useState<string[]>([]), [editing, setEditing] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null), [bulkLanguage, setBulkLanguage] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false), [overwrite, setOverwrite] = useState(false), [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const alive = useRef(true), revision = useRef(0), check = useRef<HTMLInputElement>(null);
  const row = rows.find(r => r.id === editing);
  useEffect(() => { alive.current = true; return () => { alive.current = false; revision.current++; }; }, []);
  useEffect(() => { if (active && !loaded) void refresh(false); }, [active]);
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
    try {
      const page = await listProjectMaterials(projectId, more ? cursor : null, 50);
      if (!alive.current || read !== revision.current) return;
      setRows(previous => {
        // Reads never erase unsaved/uncertain intents. Append pagination pages;
        // a refresh restarts the UUID inventory (not a frozen snapshot).
        const retained = previous.filter(r => more || r.dirty || r.pending || r.transfer);
        const ids = new Set(retained.map(r => r.id));
        return [...retained, ...page.materials.filter(v => !ids.has(v.variantId)).map(fromSaved)];
      }); setLoaded(true); setCursor(page.nextAfterVariantId);
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
      } catch { setError("部分文件未加入：支持 MP4/JPEG/PNG/WebP，非空且单文件不超过 16 MiB。"); }
    }
    setRows(prev => [...prev, ...added]);
  }
  async function upload(r: Row) {
    if (readOnly || busy || !r.transfer || r.uploading) return;
    update(r.id, v => ({ ...v, uploading: true, error: "" }));
    try { await r.transfer.send(); if (alive.current) update(r.id, v => ({ ...v, uploaded: true })); }
    catch (e) { if (alive.current && !expired(e)) update(r.id, v => ({ ...v, error: message(e) })); }
    finally { if (alive.current) update(r.id, v => ({ ...v, uploading: false })); }
  }
  function edit(input: Input) {
    if (!row || readOnly || busy || row.pending) return;
    update(row.id, r => ({ ...r, input, dirty: true, error: "" }));
  }
  async function save(targets: Row[]) {
    if (readOnly || busy) return;
    setBusy(true); setError(""); let saved = 0, failed = 0;
    revision.current++; setLoading(false);
    try {
      for (const r of targets) {
        if (!alive.current) return;
        if (!r.uploaded || r.uploading) { failed++; update(r.id, v => ({ ...v, error: "文件尚未校验，先上传；其他项可独立保存。" })); continue; }
        if (!r.firstUseConfirmed) { failed++; update(r.id, v => ({ ...v, error: "请人工确认首次使用声明；文件上传不能代替来源确认。" })); continue; }
        try {
          const pending = r.pending ?? new PreparedMaterialDeclaration(saveMaterialDeclarationRequestSchema.parse(r.input));
          update(r.id, v => ({ ...v, pending }));
          const result = await pending.send(); if (!alive.current) return;
          update(r.id, v => ({ ...fromSaved(result), preview: v.preview, filename: v.filename })); saved++;
        } catch (e) {
          if (!alive.current || expired(e)) return;
          // Invalid local forms never create a prepared request. All sent
          // failures retain their frozen original intent for explicit retry.
          update(r.id, v => ({ ...v, pending: isDefinitiveProjectRejection(e) ? undefined : v.pending,
            error: v.pending ? message(e) : "请补齐资料和真实引用：名称、语言、业务/来源关系、说明、事实及证明。" })); failed++;
        }
      }
      if (alive.current) { setSelected([]); setError(`已保存 ${saved} 项，${failed} 项仍需处理。保存结果仅为待检查，不代表候选或发布。`); }
    } finally { if (alive.current) setBusy(false); }
  }
  function changeFilter(next: string) { setFilter(next); setSelected([]); }
  const dirty = rows.filter(r => r.dirty || r.pending);
  return <section className="material-workspace" hidden={!active} aria-label="项目素材">
    <div className="section-heading"><div><h2>素材</h2><p className="muted">人工整理成品；上传、资料保存、候选准入与发布分别判断。</p></div><div className="material-actions">
      <button className="outline-button" disabled={loading || busy} onClick={() => void refresh(false)}><ArrowClockwise size={18} />刷新素材</button>
      {!readOnly && <label className="file-picker"><UploadSimple size={18} />选择成品<input type="file" multiple accept="video/mp4,image/jpeg,image/png,image/webp" onChange={e => { add(e.target.files); e.target.value = ""; }} disabled={busy} /></label>}</div></div>
    {error && <p role="status" className="feedback">{error}</p>}{loading && <p role="status">正在读取素材事实…</p>}
    <div className="material-filters"><label>状态<select value={filter} onChange={e => changeFilter(e.target.value)}><option value="all">当前已加载全部 {rows.length} 项</option><option value="pending">待补充／待检查</option><option value="upload">待上传／结果待确认</option></select></label>
      <label>搜索素材<input value={query} onChange={e => { setQuery(e.target.value); setSelected([]); }} /></label></div>
    <div className="panel material-table"><div className="material-selection">已选 {selected.length} 项<button className="outline-button" disabled={readOnly || busy || !selected.length} onClick={() => setBulkOpen(true)}>批量填写语言</button><button className="text-button" onClick={() => setSelected([])}>取消选择</button></div>
      {!loaded && !rows.length ? <p>素材事实尚未读取；加载失败不能判断为空。</p> : !rows.length ? <div className="empty-state"><FileVideo size={32} /><h3>尚无已登记素材</h3><p>选择成品后逐项上传并补齐人工资料。</p></div> : <div className="table-wrap"><table><thead><tr><th><input ref={check} type="checkbox" aria-label="选择当前可操作行" disabled={readOnly || busy || !selectable.length} checked={!!selectable.length && selected.length === selectable.length} onChange={e => setSelected(e.target.checked ? selectable : [])} /></th><th>文件／名称</th><th>业务关系</th><th>语言</th><th>文件与资料状态</th><th>操作</th></tr></thead><tbody>
        {visible.map(r => <tr key={r.id} className={selected.includes(r.id) ? "material-selected" : ""}><td><input type="checkbox" aria-label={`选择 ${r.filename}`} checked={selected.includes(r.id)} disabled={readOnly || busy || !selectable.includes(r.id)} onChange={e => setSelected(v => e.target.checked ? [...v, r.id] : v.filter(id => id !== r.id))} /></td>
          <td><FileVideo size={18} aria-hidden /> {r.filename}<small>{r.input.declaration.name || "内容名称未填写"}</small></td><td>{r.input.identity.businessKind === "drama" ? "短剧" : "商品"}<small>{r.input.identity.businessEntityId || "关系待确认"}{r.input.identity.episodeNumber && ` · 第${r.input.identity.episodeNumber}集`}</small></td><td>{r.input.languageTag || "未填写"}</td>
          <td><span className="status">{r.uploaded ? "文件字节已校验" : r.uploading ? "上传中" : "待上传／待确认"}</span><small>{r.pending ? "保存结果待确认" : r.dirty ? "有未保存资料" : `资料已保存 v${r.saved?.currentRevision} · 待检查`}</small>{r.error && <p role="status" className="material-row-error">{r.error}</p>}</td>
          <td><button className="text-button" disabled={busy} onClick={() => setEditing(r.id)}>预览／资料</button>{!r.uploaded && r.transfer && <button className="text-button" disabled={readOnly || busy || r.uploading} onClick={() => void upload(r)}>上传／重试原文件</button>}</td></tr>)}
      </tbody></table></div>}
      {cursor && <button className="outline-button" disabled={loading || busy} onClick={() => void refresh(true)}>加载下一页</button>}
    </div>
    <div className="material-save-scope"><p>保存范围：当前项目全部 {dirty.length} 项未保存／待确认资料（包括筛选隐藏项）；不是勾选范围。刷新或翻页清除勾选，保留草稿。</p><details><summary>查看保存对象</summary>{dirty.map(r => <p key={r.id}>{r.filename} · {r.id}</p>)}</details>
      {!readOnly && <button disabled={busy || !dirty.length || rows.some(r => r.uploading)} onClick={() => void save(dirty)}>{busy ? "保存中…" : "保存资料"}</button>}<p className="form-note">不生成示例素材、权利证明或发布资格；关闭页面会丢失未保存文件与草稿，原请求未知时请先接续。</p></div>
    {bulkOpen && <section className="panel" aria-label="批量填写语言"><h3>当前选择 {selected.length} 项</h3><label>语言标签<input value={bulkLanguage} onChange={e => setBulkLanguage(e.target.value)} placeholder="例如 es；请按真实语言填写" /></label><label className="material-inline-check"><input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} />明确覆盖已有语言（默认仅填空值）</label>
      <ul>{rows.filter(r => selected.includes(r.id)).map(r => <li key={r.id}>{r.filename}：{r.input.languageTag || "空"} → {r.saved || (r.input.languageTag && !overwrite) ? "保留（已有身份不可改语言）" : bulkLanguage || "待填写"}</li>)}</ul>
      <button disabled={readOnly || busy || !bulkLanguage} onClick={() => { setRows(prev => prev.map(r => selected.includes(r.id) && !r.saved && !r.pending && (!r.input.languageTag || overwrite) ? { ...r, input: { ...r.input, languageTag: bulkLanguage }, dirty: true } : r)); setBulkOpen(false); }}>应用到待保存资料</button><button className="text-button" onClick={() => setBulkOpen(false)}>取消</button></section>}
    {row && <section className="panel material-editor" aria-label="素材资料详情"><div className="section-heading"><h3>{row.filename} · 预览与人工资料</h3><button className="text-button" onClick={() => setEditing(null)}>保留草稿返回</button></div>
      {previewUrl ? row.preview?.type.startsWith("image/") ? <img className="material-preview" src={previewUrl} alt="所选本地文件预览，尚非来源核验" /> : <video className="material-preview" src={previewUrl} controls /> : <p>当前仅有服务器元数据，没有获准文件下载通道；不使用示例画面代替预览。</p>}
      <p>文件版本只读：{row.input.objectIds.join("、")}；{row.uploaded ? "字节已校验" : "尚未确认上传"}。更换文件不是普通资料编辑。</p>
      <fieldset disabled={readOnly || busy || !!row.pending}><div className="material-form-grid">
        <label>内容名称<input value={row.input.declaration.name} onChange={e => edit({ ...row.input, declaration: { ...row.input.declaration, name: e.target.value } })} /></label>
        <label>语言标签<input disabled={!!row.saved} value={row.input.languageTag} onChange={e => edit({ ...row.input, languageTag: e.target.value })} /></label>
        <label>成品类型<select disabled={!!row.saved} value={row.input.identity.mediaKind} onChange={e => edit({ ...row.input, identity: { ...row.input.identity, mediaKind: e.target.value as Input["identity"]["mediaKind"], seriesId: null, episodeNumber: null } })}><option value="video">视频</option><option value="image_text">图文</option></select></label>
        <label>业务类型<select disabled={!!row.saved} value={row.input.identity.businessKind} onChange={e => edit({ ...row.input, identity: { ...row.input.identity, businessKind: e.target.value as Input["identity"]["businessKind"], seriesId: null, episodeNumber: null } })}><option value="product">商品</option><option value="drama">短剧</option></select></label>
        {(["description", "businessFacts", "sourceStatement"] as const).map((key, i) => <label key={key}>{["内容说明", "业务事实", "来源声明"][i]}<textarea value={row.input.declaration[key]} onChange={e => edit({ ...row.input, declaration: { ...row.input.declaration, [key]: e.target.value } })} /></label>)}
        <label>已有来源证明记录标识（逗号分隔 UUID）<textarea value={row.evidenceText} onChange={e => { const text = e.target.value; update(row.id, r => ({ ...r, evidenceText: text, dirty: true, error: "", input: { ...r.input, declaration: { ...r.input.declaration, sourceEvidenceIds: text.split(",").map(v => v.trim()).filter(Boolean) } } })); }} /></label>
        <label>商品／短剧业务标识 UUID<input disabled={!!row.saved} value={row.input.identity.businessEntityId} onChange={e => edit({ ...row.input, identity: { ...row.input.identity, businessEntityId: e.target.value } })} /></label>
        <label>来源主体标识 UUID<input disabled={!!row.saved} value={row.input.sourceId} onChange={e => edit({ ...row.input, sourceId: e.target.value })} /></label>
        <label>原成品来源记录 UUID<input disabled={!!row.saved} value={row.input.sourceRecordId} onChange={e => edit({ ...row.input, sourceRecordId: e.target.value })} /></label>
        {row.input.identity.businessKind === "drama" && row.input.identity.mediaKind === "video" && <><label>连载标识 UUID（独立宣传片留空）<input disabled={!!row.saved} value={row.input.identity.seriesId ?? ""} onChange={e => edit({ ...row.input, identity: { ...row.input.identity, seriesId: e.target.value || null } })} /></label><label>明确集序（不从文件名推断）<input disabled={!!row.saved} type="number" min="1" value={row.input.identity.episodeNumber ?? ""} onChange={e => edit({ ...row.input, identity: { ...row.input.identity, episodeNumber: e.target.value ? Number(e.target.value) : null } })} /></label></>}
      </div><label className="material-inline-check"><input type="checkbox" checked={row.firstUseConfirmed} onChange={e => update(row.id, r => ({ ...r, firstUseConfirmed: e.target.checked, dirty: true, error: "" }))} />我已人工确认：此成品此前未发布；声明不等于系统核验通过</label></fieldset>
      <p className="form-note">关系和证明引用由运营人工确认，标识不证明权利或首次未发布。当前接缝需已有业务/来源记录标识，目录选择和成品组复用待后续接入。</p>
      {!readOnly && <button disabled={busy || !row.dirty || row.uploading} onClick={() => void save([row])}>保存本条／接续原请求</button>}{row.pending && <p role="status">原提交结果待确认，暂锁定输入；重试使用同一文件、记录和请求。</p>}
      {row.saved && row.dirty && <button className="outline-button" disabled={busy} onClick={() => void readCurrent(row)}>读取当前版本核对</button>}
      {row.observed && <div className="project-conflict"><h4>当前保存 v{row.observed.currentRevision}</h4><pre>{JSON.stringify({ language: row.observed.languageTag, identity: row.observed.identity, declaration: row.observed.declaration, objects: row.observed.objects.map(o => o.objectId) }, null, 2)}</pre>
        <p>本人表单输入仍保留。采用最新版本只更新保存基线，下一次保存会提交表单中的全部资料；请逐项核对。</p><button className="outline-button" disabled={busy || !!row.pending || readOnly} onClick={() => update(row.id, r => ({ ...r, observed: undefined, saved: row.observed,
          input: { ...r.input, expectedCurrentRevision: row.observed!.currentRevision, metadata: { contractVersion, requestId: `request-${crypto.randomUUID()}`, idempotencyKey: newIdempotencyKey() } } }))}>已核对，采用最新版本</button></div>}
      {row.error && <p role="status">{row.error}</p>}
    </section>}
  </section>;
  async function readCurrent(r: Row) {
    // Only read; do not silently replace the unresolved original command.
    const read = revision.current;
    try {
      const current = await readProjectMaterial(projectId, r.id);
      if (alive.current && read === revision.current) update(r.id, value => ({ ...value, observed: current }));
    } catch (e) { if (alive.current && read === revision.current && !expired(e)) setError("当前版本未读到，原输入保留。"); }
  }
}
