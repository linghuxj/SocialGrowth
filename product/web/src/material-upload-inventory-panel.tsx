import { useEffect, useRef, useState } from "react";
import { listProjectMaterialUploads, type MaterialUploadPage } from "./material-api.js";
import { ProductApiError } from "./operator-api.js";

const time = (value: string) => new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value));

/** Persisted upload receipts are independent of unsaved human declarations. */
export function MaterialUploadInventoryPanel({ projectId, active, refreshVersion, onExpired, readOnly, onContinue }: {
  projectId: string; active: boolean; refreshVersion: number; onExpired: (error: unknown) => void;
  readOnly: boolean; onContinue: (ticket: MaterialUploadPage["tickets"][number]) => void;
}) {
  const [page, setPage] = useState<MaterialUploadPage | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const sequence = useRef(0);
  useEffect(() => { if (active) void read(false); return () => { sequence.current++; }; }, [active, projectId, refreshVersion]);
  async function read(more: boolean) {
    const revision = ++sequence.current; setLoading(true); setError("");
    try {
      const next = await listProjectMaterialUploads(projectId, more ? page?.nextAfterObjectId ?? null : null);
      if (revision !== sequence.current) return;
      setPage(previous => more && previous ? { ...next, tickets: [...previous.tickets, ...next.tickets.filter(ticket => !previous.tickets.some(old => old.objectId === ticket.objectId))] } : next);
    } catch (cause) {
      if (revision !== sequence.current) return;
      if (cause instanceof ProductApiError && cause.status === 401) onExpired(cause);
      else setError("上传记录读取失败，当前文件状态未知；请重试读取，不重新上传来代替核对。");
    } finally { if (revision === sequence.current) setLoading(false); }
  }
  return <section className="panel material-upload-inventory" aria-label="已保存的文件上传记录">
    <div className="section-heading"><div><h3>文件上传记录</h3><p className="muted">页面关闭后仍可核对原文件；素材资料和发布资格另行判断。</p></div><button className="outline-button" disabled={loading} onClick={() => void read(false)}>读取上传记录</button></div>
    {loading && <p role="status">正在读取已保存的上传记录…</p>}
    {error && <p role="alert">{error}</p>}
    {error && page && <p>以下为历史上传记录，不能据此判断当前状态。</p>}
    {!page ? <p>尚未读到上传记录。</p> : !page.tickets.length ? <p>尚无已保存的上传票据；不代表本窗口没有待上传文件。</p> : <ul className="material-upload-inventory__list">{page.tickets.map(ticket => <li key={ticket.objectId}>
      <strong>{ticket.status === "verified_bytes" ? "原文件字节已校验" : "原文件等待字节校验"}</strong>
      <span>{ticket.bytes.toLocaleString("zh-CN")} 字节 · {ticket.contentType}</span>
      <details><summary>文件标识与摘要</summary><dl><dt>文件标识</dt><dd>{ticket.objectId}</dd><dt>SHA-256</dt><dd>{ticket.sha256}</dd><dt>校验时间（本地）</dt><dd>{ticket.verifiedAt ? time(ticket.verifiedAt) : "尚未校验"}</dd></dl></details>
      <small>上传仅证明文件字节；候选资格和发布许可请在素材资料与任务条件中核对。</small>
      {!readOnly && ticket.status === "verified_bytes" && /^(video\/mp4|image\/(jpeg|png|webp))$/.test(ticket.contentType) && <button className="outline-button" disabled={loading || !!error} onClick={() => onContinue(ticket)}>继续填写此文件资料</button>}
    </li>)}</ul>}
    {page?.nextAfterObjectId && <button className="outline-button" disabled={loading} onClick={() => void read(true)}>读取更多上传记录</button>}
  </section>;
}
