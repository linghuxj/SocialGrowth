import { useEffect, useRef, useState } from "react";
import { captureOperatorWriteSession, hasCsrfToken, listInvitations, listOperators, OperatorWriteSessionChangedError, ProductApiError } from "./operator-api.js";
import { isDefinitiveAssistanceRejection, listAssistanceImpacts, listAssistanceNotes, listAssistanceTodos, prepareAssistanceNote, type AssistanceImpactsPage, type AssistanceNote, type AssistanceTodo, type PreparedAssistanceNote } from "./device-assistance-api.js";
import { readAssistanceTodoDetail } from "./workflow-api.js";
import type { InvitationView, OperatorAssistanceTodoDetailResponse, OperatorView } from "@socialgrowth/product-contracts";
import { readFact } from "./operations-facts.js";

interface Props { active: boolean; readOnly: boolean; onExpired(error: unknown): void; entry?: { todoId: string; revision: number } | null }
type NoteState = { todo: AssistanceTodo; recheck: OperatorAssistanceTodoDetailResponse["recheck"]; notes: AssistanceNote[]; nextAfterNoteId: string | null; impacts: AssistanceImpactsPage["impacts"]; nextAfterDeviceId: string | null };

function contactName(id: string, operators: OperatorView[], invitations: InvitationView[]): string {
  const operator = operators.find(item => item.operatorId.toLowerCase() === id.toLowerCase());
  if (operator) return operator.displayName;
  for (const invitation of invitations) {
    const registration = invitation.registrations.find(item => item.providerId.toLowerCase() === id.toLowerCase());
    if (registration) return registration.displayName;
  }
  return `联系人资料不可用（${id.slice(0, 8)}）`;
}
function time(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", hour12: false }).format(new Date(value));
}
function kindLabel(kind: AssistanceNote["kind"]): string { return kind === "reported_processed" ? "本人报告已处理，待复核" : "协助说明"; }
function statusLabel(status: AssistanceTodo["status"]): string { return status === "awaiting_recheck" ? "等待复核" : "待处理"; }
function recheckLabel(status: OperatorAssistanceTodoDetailResponse["recheck"]["status"]): string {
  return status === "not_requested" ? "尚未请求复核" : status === "pending" ? "复核请求已排队或认领；尚未证明系统开始执行" : status === "verified_recovered"
    ? "可信端已核验并接续原任务" : status === "still_blocked" ? "系统复核后仍有阻断" : "复核结果未知";
}

export function OperatorTodosPanel({ active, readOnly, onExpired, entry = null }: Props) {
  const [todos, setTodos] = useState<AssistanceTodo[]>([]);
  const [nextTodo, setNextTodo] = useState<string | null>(null);
  const [selected, setSelected] = useState<NoteState | null>(null);
  const [operators, setOperators] = useState<OperatorView[]>([]);
  const [invitations, setInvitations] = useState<InvitationView[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [impactLoading, setImpactLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState<"note" | "reported_processed">("note");
  const [pending, setPending] = useState<PreparedAssistanceNote | null>(null);
  const pendingCommand = useRef<PreparedAssistanceNote | null>(null);
  const pendingSession = useRef<(() => void) | null>(null);
  const activeView = useRef(active);
  activeView.current = active;
  const expiredRef = useRef(onExpired);
  expiredRef.current = onExpired;
  const readSequence = useRef(0);
  const detailSequence = useRef(0);
  const impactSequence = useRef(0);
  const selectedTodoId = useRef<string | null>(null);
  const notifyCurrentExpired = (error: unknown) => { if (activeView.current) expiredRef.current(error); };

  async function refresh(append = false): Promise<void> {
    const sequence = ++readSequence.current;
    const detailTarget = selectedTodoId.current;
    setLoading(true); setError("");
    try {
      const [page, operatorsFact, invitationsFact] = await Promise.all([
        readFact(() => listAssistanceTodos(append ? nextTodo ?? undefined : undefined), notifyCurrentExpired),
        readFact(listOperators, notifyCurrentExpired),
        readFact(listInvitations, notifyCurrentExpired),
      ]);
      if (sequence !== readSequence.current) return;
      if (page.status !== "loaded") throw new Error("Assistance list facts are unknown");
      const nextOperators = operatorsFact.status === "loaded" ? operatorsFact.value : [];
      const nextInvitations = invitationsFact.status === "loaded" ? invitationsFact.value : [];
      setTodos(current => {
        const next = append ? [...current, ...page.value.todos.filter(item => !current.some(old => old.todoId === item.todoId))] : [...page.value.todos];
        const selectedId = selectedTodoId.current;
        const selectedCached = selectedId ? current.find(item => item.todoId.toLowerCase() === selectedId) : undefined;
        if (selectedCached && !next.some(item => item.todoId.toLowerCase() === selectedCached.todoId.toLowerCase())) next.push(selectedCached);
        return next;
      });
      setNextTodo(page.value.nextAfterTodoId); setOperators(nextOperators); setInvitations(nextInvitations);
      if (detailTarget && !append && selectedTodoId.current === detailTarget) {
        const detailRequest = ++detailSequence.current;
        ++impactSequence.current; setImpactLoading(false);
        const [details, impacts, assistance] = await Promise.all([
          readFact(() => listAssistanceNotes(detailTarget), notifyCurrentExpired),
          readFact(() => listAssistanceImpacts(detailTarget), notifyCurrentExpired),
          readFact(() => readAssistanceTodoDetail(detailTarget), notifyCurrentExpired),
        ]);
        if (sequence !== readSequence.current || detailRequest !== detailSequence.current || selectedTodoId.current !== detailTarget) return;
        if (details.status !== "loaded" || impacts.status !== "loaded" || assistance.status !== "loaded") throw new Error("Assistance records are unknown");
        if (impacts.value.todoId.toLowerCase() !== detailTarget.toLowerCase() || assistance.value.todo.todoId.toLowerCase() !== detailTarget.toLowerCase() || assistance.value.todo.factVersion !== details.value.todo.factVersion) throw new Error("Assistance detail response is stale or mismatched");
        setTodos(items => items.map(item => item.todoId.toLowerCase() === details.value.todo.todoId.toLowerCase() ? details.value.todo : item));
        setSelected({ todo: details.value.todo, recheck: assistance.value.recheck, notes: details.value.notes, nextAfterNoteId: details.value.nextAfterNoteId, impacts: impacts.value.impacts, nextAfterDeviceId: impacts.value.nextAfterDeviceId });
      }
    } catch (cause) {
      if (sequence !== readSequence.current) return;
      if (cause instanceof ProductApiError && cause.status === 401) onExpired(cause);
      else setError(cause instanceof Error ? cause.message : "暂时无法读取待办，请稍后刷新");
    } finally { if (sequence === readSequence.current) setLoading(false); }
  }

  async function openTodo(todo: AssistanceTodo, knownDetail?: OperatorAssistanceTodoDetailResponse): Promise<void> {
    if (pendingCommand.current) return;
    const switching = selectedTodoId.current !== todo.todoId;
    selectedTodoId.current = todo.todoId;
    const request = ++detailSequence.current;
    ++impactSequence.current;
    setImpactLoading(false);
    if (switching) { setDraft(""); setKind("note"); }
    setSelected(null); setDetailLoading(true); setError(""); setMessage("");
    try {
      const [response, impacts, assistance] = await Promise.all([
        readFact(() => listAssistanceNotes(todo.todoId), notifyCurrentExpired),
        readFact(() => listAssistanceImpacts(todo.todoId), notifyCurrentExpired),
        knownDetail ? Promise.resolve({ status: "loaded", value: knownDetail } as const) : readFact(() => readAssistanceTodoDetail(todo.todoId), notifyCurrentExpired),
      ]);
      if (request !== detailSequence.current || selectedTodoId.current !== todo.todoId) return;
      if (response.status !== "loaded" || impacts.status !== "loaded" || assistance.status !== "loaded") throw new Error("Assistance records are unknown");
      if (impacts.value.todoId.toLowerCase() !== todo.todoId.toLowerCase()) throw new Error("Assistance impact response target mismatch");
      if (assistance.value.todo.todoId.toLowerCase() !== todo.todoId.toLowerCase() || assistance.value.todo.factVersion !== response.value.todo.factVersion) throw new Error("Assistance detail response is stale or mismatched");
      setSelected({ todo: response.value.todo, recheck: assistance.value.recheck, notes: response.value.notes, nextAfterNoteId: response.value.nextAfterNoteId, impacts: impacts.value.impacts, nextAfterDeviceId: impacts.value.nextAfterDeviceId });
    } catch (cause) {
      if (request !== detailSequence.current || selectedTodoId.current !== todo.todoId) return;
      if (cause instanceof ProductApiError && cause.status === 401) onExpired(cause);
      else setError("待办详情暂时不可用；没有改变服务端数据，请稍后重试。");
    } finally { if (request === detailSequence.current && selectedTodoId.current === todo.todoId) setDetailLoading(false); }
  }

  async function loadOlderNotes(): Promise<void> {
    if (!selected?.nextAfterNoteId) return;
    const todoId = selected.todo.todoId, cursor = selected.nextAfterNoteId;
    const request = ++detailSequence.current;
    setDetailLoading(true);
    try {
      const result = await readFact(() => listAssistanceNotes(todoId, cursor), notifyCurrentExpired);
      if (request !== detailSequence.current || selectedTodoId.current !== todoId) return;
      if (result.status !== "loaded") throw new Error("Assistance note page is unknown");
      const response = result.value;
      if (response.todo.factVersion !== selected.todo.factVersion) { setError("待办事实版本已变化；已读取的说明未与新复核状态拼接，请刷新后继续查看。"); return; }
      setSelected(current => current ? { ...current, todo: response.todo,
        notes: [...current.notes, ...response.notes], nextAfterNoteId: response.nextAfterNoteId } : current);
    } catch (cause) {
      if (request !== detailSequence.current || selectedTodoId.current !== todoId) return;
      if (cause instanceof ProductApiError && cause.status === 401) onExpired(cause);
      else setError("历史说明读取失败；已显示部分不会被覆盖。");
    } finally { if (request === detailSequence.current && selectedTodoId.current === todoId) setDetailLoading(false); }
  }

  async function loadMoreImpacts(): Promise<void> {
    if (!selected?.nextAfterDeviceId) return;
    const todoId = selected.todo.todoId, cursor = selected.nextAfterDeviceId;
    const request = ++impactSequence.current;
    setImpactLoading(true);
    try {
      const result = await readFact(() => listAssistanceImpacts(todoId, cursor), notifyCurrentExpired);
      if (request !== impactSequence.current || selectedTodoId.current !== todoId) return;
      if (result.status !== "loaded") throw new Error("Assistance impact page is unknown");
      const response = result.value;
      if (response.todoId.toLowerCase() !== todoId.toLowerCase()) throw new Error("Assistance impact response target mismatch");
      setSelected(current => current?.todo.todoId === todoId ? { ...current,
        impacts: [...current.impacts, ...response.impacts], nextAfterDeviceId: response.nextAfterDeviceId } : current);
    } catch (cause) {
      if (request !== impactSequence.current || selectedTodoId.current !== todoId) return;
      if (cause instanceof ProductApiError && cause.status === 401) onExpired(cause);
      else setError("历史影响记录读取失败；已显示部分不会被覆盖。");
    } finally { if (request === impactSequence.current && selectedTodoId.current === todoId) setImpactLoading(false); }
  }

  async function sendNote(): Promise<void> {
    if (!selected || readOnly || pendingCommand.current) return;
    let sessionGuard: () => void;
    try { sessionGuard = captureOperatorWriteSession(); }
    catch { setError("登录状态已失效，请重新登录后再记录说明。"); return; }
    let command: PreparedAssistanceNote;
    try { command = prepareAssistanceNote(selected.todo, kind, draft); }
    catch { setError("说明内容需为 1–150 字且不能包含首尾空白或换行。"); return; }
    pendingSession.current = sessionGuard;
    pendingCommand.current = command; setPending(command);
    await continueNote(command);
  }

  async function continueNote(command = pending): Promise<void> {
    if (!command) return;
    setError(""); setMessage("");
    try {
      pendingSession.current?.();
      await command.submit(); pendingCommand.current = null; setPending(null); setDraft(""); setKind("note");
      pendingSession.current = null;
      setMessage("说明已记录。待办仍需基于新的设备事实复核，不代表权限恢复或事项已解决。");
      if (!activeView.current) return;
      await refresh();
    } catch (cause) {
      if (cause instanceof ProductApiError && cause.status === 401) {
        if (hasCsrfToken()) {
          try { pendingSession.current?.(); }
          catch { pendingCommand.current = command; setPending(command); setError("登录会话已变化，原请求仍未确认；请勿在新会话重发或切换待办。"); return; }
        }
        expiredRef.current(cause); return;
      }
      if (cause instanceof OperatorWriteSessionChangedError) {
        pendingCommand.current = command; setPending(command); setError("该说明请求绑定原登录会话；会话已变化，结果仍未确认，不能在新会话重发。"); return;
      }
      if (isDefinitiveAssistanceRejection(cause)) {
        pendingCommand.current = null; pendingSession.current = null; setPending(null);
        if (cause instanceof ProductApiError && cause.response.error.code === "FACT_VERSION_STALE") {
          setError("待办事实版本已变化。请刷新并重新核对后，再决定是否提交说明。"); await refresh();
        } else setError("说明不符合要求，没有提交；请检查后重填。");
        return;
      }
      pendingCommand.current = command; setPending(command);
      setError("提交结果尚未确认。原内容和请求键已保留；刷新记录后，只有选择接续原请求才会用相同请求键核对。");
    }
  }

  useEffect(() => {
    const cancelReads = () => { readSequence.current += 1; detailSequence.current += 1; impactSequence.current += 1; };
    if (!active) return cancelReads;
    if (!entry) { void refresh(); return cancelReads; }
    const target = entry.todoId.toLowerCase();
    if (pendingCommand.current && selectedTodoId.current !== target) {
      setError("当前有一条结果未确认的原请求；先在当前待办接续该请求，暂不切换到新待办。");
      return cancelReads;
    }
    if (selectedTodoId.current === target && selected) { void refresh(); return cancelReads; }
    const request = ++detailSequence.current;
    setDetailLoading(true); setError(""); setMessage("");
    const readRequest = readFact(() => readAssistanceTodoDetail(target), notifyCurrentExpired);
    void readRequest.then(async fact => {
      if (request !== detailSequence.current || selectedTodoId.current === target && pendingCommand.current) return;
      if (fact.status !== "loaded") throw new Error("Assistance detail unavailable or stale");
      const assistance = fact.value;
      if (assistance.todo.todoId.toLowerCase() !== target) throw new Error("Assistance entry target mismatch");
      setTodos(items => items.some(item => item.todoId.toLowerCase() === target) ? items : [assistance.todo, ...items]);
      await openTodo(assistance.todo, assistance);
    }).catch(cause => {
      if (request !== detailSequence.current) return;
      if (cause instanceof ProductApiError && cause.status === 401) onExpired(cause);
      else setError("目标待办详情暂时不可用；没有切换到其他待办。请重试或从列表选择。");
    }).finally(() => { if (request === detailSequence.current) setDetailLoading(false); });
    // Entry changes are the only deep-link trigger. Stable refs/sequences inside this panel prevent stale results from changing selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return cancelReads;
  }, [active, entry?.todoId, entry?.revision]);
  if (!active) return null;
  return <section className="operator-todos" aria-labelledby="operator-todos-title">
    <header className="operator-todos__header"><div><p className="operator-todos__eyebrow">设备协助 · 运营待办</p><h2 id="operator-todos-title">设备接入待办</h2><p>只展示已记录的未分配设备协助事项。说明和“报告已处理”都不会批准恢复、验证设备或关闭事项。</p></div><button type="button" className="outline-button" onClick={() => void refresh()} disabled={loading}>{loading ? "读取中…" : "刷新"}</button></header>
    {readOnly && <p className="operator-todos__notice" role="note">手机端只读；请在电脑提交运营说明。</p>}
    {message && <p className="operator-todos__feedback" role="status">{message}</p>}
    {error && <p className="operator-todos__error" role="alert">{error}</p>}
    <div className="operator-todos__layout">
      <section className="operator-todos__list" aria-label="设备接入待办列表">
        <div className="operator-todos__list-head"><h3>待办列表</h3><span>{todos.length} 条已载入</span></div>
        {todos.length === 0 && !loading ? <div className="operator-todos__empty"><h4>当前没有可显示的设备接入待办</h4><p>没有从设备事件或人工记录读取到事项；页面不会创建演示待办。</p></div> : null}
        {todos.map(todo => <button key={todo.todoId} type="button" className={`operator-todos__row ${selected?.todo.todoId === todo.todoId ? "is-selected" : ""}`} disabled={Boolean(pending)} onClick={() => void openTodo(todo)}>
          <span className={`operator-todos__status ${todo.status}`}>{statusLabel(todo.status)}</span><strong>{todo.kind === "network_access_help" ? "设备网络接入协助" : todo.kind}</strong>
          <span>提供者：{contactName(todo.providerId, operators, invitations)}</span><span>负责人：{contactName(todo.initialResponsibleOperatorId, operators, invitations)}</span>
          <small>历史影响设备 {todo.impactCount} 台 · 说明 {todo.noteCount} 条 · 更新 {time(todo.updatedAt)}</small>
        </button>)}
        {nextTodo && <button type="button" className="outline-button" disabled={loading} onClick={() => void refresh(true)}>加载更多</button>}
      </section>
      <section className="operator-todos__detail" aria-label="待办详情与历史说明">
        {detailLoading && !selected ? <p role="status">读取待办历史…</p> : null}
        {!selected && !detailLoading ? <div className="operator-todos__empty"><h3>选择一条待办</h3><p>页面将显示负责人、提供者、当前接口可提供的历史说明和事实版本。</p></div> : null}
        {selected && <>
          <div className="operator-todos__detail-head"><div><span className={`operator-todos__status ${selected.todo.status}`}>{statusLabel(selected.todo.status)}</span><h3>协助事项记录</h3><p>来源：未分配设备 · 网络接入协助</p></div><code>事实版本 {selected.todo.factVersion}</code></div>
          <section className="operator-todos__recheck" aria-label="系统复核进度"><strong>{recheckLabel(selected.recheck.status)}</strong>
            {selected.recheck.blockers.length > 0 && <p>仍需处理：{selected.recheck.blockers.join("、")}</p>}
            <small>复核时间：{selected.recheck.checkedAt ? time(selected.recheck.checkedAt) : "尚无复核记录"}。该状态来自服务端复核，不由人工说明设置。</small>
          </section>
          <dl className="operator-todos__facts"><div><dt>提供者</dt><dd>{contactName(selected.todo.providerId, operators, invitations)}</dd></div><div><dt>初始负责人</dt><dd>{contactName(selected.todo.initialResponsibleOperatorId, operators, invitations)}</dd></div><div><dt>创建时间</dt><dd>{time(selected.todo.createdAt)}</dd></div><div><dt>影响设备</dt><dd>{selected.todo.impactCount} 台历史影响；下方仅显示已记录的事件时事实</dd></div><div><dt>通知</dt><dd>未配置；没有发送记录</dd></div></dl>
          <div className="operator-todos__history"><div className="operator-todos__list-head"><h4>历史影响设备</h4><span>{selected.impacts.length} 条已载入 / {selected.todo.impactCount} 台聚合影响</span></div>
            {selected.impacts.length ? <ul className="operator-todos__impacts">{selected.impacts.map(impact => <li key={impact.deviceId}><code>{impact.deviceId}</code><span>记录版本 {impact.recordedDeviceVersion} · {time(impact.recordedAt)}</span></li>)}</ul> : <p className="operator-todos__empty-inline">当前没有读取到设备级历史记录。</p>}
            <p className="operator-todos__history-note">记录版本和时间来自历史事件，不代表设备当前状态、健康或现场复核结果。</p>
            {selected.nextAfterDeviceId && <button type="button" className="text-button" disabled={impactLoading} onClick={() => void loadMoreImpacts()}>{impactLoading ? "读取中…" : "加载更多影响记录"}</button>}
          </div>
          <div className="operator-todos__history"><div className="operator-todos__list-head"><h4>历史说明</h4><span>{selected.todo.noteCount} 条</span></div>
            {selected.notes.length ? selected.notes.map(note => <article className="operator-todos__note" key={note.noteId}><header><strong>{kindLabel(note.kind)}</strong><time>{time(note.recordedAt)}</time></header><p>{note.text}</p><small>记录人：{contactName(note.actorId, operators, invitations)}</small></article>) : <p className="operator-todos__empty-inline">暂无说明记录</p>}
            {selected.nextAfterNoteId && <button type="button" className="text-button" disabled={detailLoading} onClick={() => void loadOlderNotes()}>加载后续说明</button>}
          </div>
          {!readOnly && <form className="operator-todos__form" onSubmit={event => { event.preventDefault(); void sendNote(); }}>
            <h4>记录运营说明</h4><p>本操作仅追加说明，不会验证设备、重新分配事项、恢复控制授权或发送通知。</p>
            <label>说明类型<select value={kind} onChange={event => setKind(event.target.value as "note" | "reported_processed")} disabled={Boolean(pending)}><option value="note">协助说明</option><option value="reported_processed">本人报告已处理（待复核）</option></select></label>
            <label>说明内容<textarea value={draft} onChange={event => setDraft(event.target.value)} maxLength={150} rows={3} disabled={Boolean(pending)} required /></label>
            {pending ? <div className="operator-todos__pending"><p>原请求键 {pending.key.slice(0, 18)}… · 输入已锁定</p><button type="button" onClick={() => void continueNote()} disabled={loading}>接续原请求</button></div> : <button type="submit">记录说明</button>}
          </form>}
          {readOnly && <p className="operator-todos__notice">当前只读，不提供修改入口。</p>}
          <footer className="operator-todos__disclaimer">此事项只表示存在历史协助请求。未读到当前设备健康、现场执行或授权恢复结果。</footer>
        </>}
      </section>
    </div>
  </section>;
}
