import { useEffect, useRef, useState, type FormEvent } from "react";
import { contractVersion, executionLibraryVersion, preparationExecutionLibrary, type AccountPreparationWorkspace, type AccountPreparationTaskView } from "@socialgrowth/product-contracts";
import { PreparedAccountPreparation, readAccountPreparation } from "./account-preparation-api.js";
import { readAccountAssignments, readMediaAccounts } from "./media-accounts-api.js";
import { captureOperatorWriteSession, hasCsrfToken, isDefinitiveProjectRejection, newIdempotencyKey, ProductApiError, listOperatorDeviceFacts } from "./operator-api.js";
import { readFact, factValue } from "./operations-facts.js";
const reasons: Record<string, string> = {
  RESOURCE_ASSIGNMENT_REQUIRED: "等待项目账号与手机分配",
  PARENT_ACCOUNT_SCOPE_MISMATCH: "所选账号与登录身份记录或平台不一致",
  DEVICE_PARTICIPATION_RECHECK_REQUIRED: "手机暂停、恢复或退出状态需要复核",
  VERIFY_ORIGINAL_DEVICE_CALL: "先核实手机上的原未决操作",
  BOUND_IDENTITY_MUST_BE_PRESERVED: "已有绑定身份必须保留，请核对准确 ID",
  CURRENT_DEVICE_ACTION_FENCE_REQUIRED: "等待手机当前授权与独占控制接通",
  PREPARATION_EXECUTOR_NOT_CONNECTED: "Artemis 初始化执行端当前未就绪；该请求会保留为阻断，不会操作手机",
  NETWORK_ADMISSION_REQUIRED: "等待手机网络准入核验",
  CURRENT_NETWORK_PATH_RECHECK_REQUIRED: "已有入网记录，仍需核验当前实际连接",
  PHONE_CONTROL_HOLDER_REQUIRED: "等待取得手机独占控制权",
  PHONE_STOP_CONFIRMATION_REQUIRED: "先确认手机原控制已停止并交还",
  CURRENT_ADB_TARGET_AUTHORIZATION_REQUIRED: "等待核验当前调试授权与准确手机",
  CURRENT_LOCAL_PARTICIPATION_CONFIRMATION_REQUIRED: "等待手机本机当前参与确认",
  CURRENT_HOLDER_TASK_SCOPE_REQUIRED: "等待核对控制权与本任务的对应关系",
  TRUSTED_PLATFORM_EVIDENCE_CONSUMER_REQUIRED: "等待可信证据核验链路接通",
};
const statuses = { waiting_resources: "等待资源条件", waiting_executor: "等待执行条件", needs_reconciliation: "原操作待核实" };
const observations = { running: "执行观察待核实", launch_unknown: "启动结果待核实", reported: "执行端报告完成，证据待核验",
  needs_human: "执行端报告需人工协助，待核验", result_unknown: "原结果待核实", stop_unconfirmed: "停止尚未确认" };
export function AccountPreparationPanel({ projectId, active, readOnly, onExpired, onFactsChanged, onOpenMediaAccounts, onOpenDevices }: {
  projectId: string; active: boolean; readOnly: boolean; onExpired: (error: unknown) => void;
  onFactsChanged?: () => void; onOpenMediaAccounts?: () => void; onOpenDevices?: () => void;
}) {
  const [view, setView] = useState<AccountPreparationWorkspace | null>(null), [message, setMessage] = useState("");
  const [projectAssignments, setProjectAssignments] = useState<Awaited<ReturnType<typeof readAccountAssignments>> | null>(null);
  const [accountNames, setAccountNames] = useState<Record<string, string>>({}), [deviceNames, setDeviceNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [unresolved, setUnresolved] = useState(false);
  const [loading, setLoading] = useState(false), [readError, setReadError] = useState("");
  const [platform, setPlatform] = useState<"facebook" | "youtube">("facebook");
  const [mode, setMode] = useState<"check_only" | "prepare_if_missing">("check_only");
  const [account, setAccount] = useState(""), [device, setDevice] = useState("");
  const [name, setName] = useState(""), [expectedId, setExpectedId] = useState("");
  const [category, setCategory] = useState(""), [description, setDescription] = useState(""), [handle, setHandle] = useState("");
  const [scope, setScope] = useState(""), [install, setInstall] = useState(false), [create, setCreate] = useState(false);
  const pending = useRef<PreparedAccountPreparation | null>(null), readEpoch = useRef(0);
  const alive = useRef(true), expired = useRef(onExpired); expired.current = onExpired;
  useEffect(() => { alive.current = true; return () => { alive.current = false; readEpoch.current++; }; }, []);
  const pendingKind = useRef<"request" | "recheck" | "execution-review">("request");
  async function refresh() {
    const epoch = ++readEpoch.current;
    setLoading(true); setReadError("");
    const expireCurrent = (e: unknown) => { if (alive.current && epoch === readEpoch.current) expired.current(e); };
    const [next, assignments, names, phones] = await Promise.all([readFact(() => readAccountPreparation(projectId), expireCurrent),
      readFact(() => readAccountAssignments(projectId), expireCurrent), readFact(readMediaAccounts, expireCurrent), readFact(listOperatorDeviceFacts, expireCurrent)]);
    if (!alive.current || epoch !== readEpoch.current) return;
    setLoading(false);
    if (next.status === "loaded") setView(next.value);
    setProjectAssignments(factValue(assignments) ?? null);
    setAccountNames(Object.fromEntries(factValue(names)?.accounts.map(a => [a.accountId, a.displayName]) ?? []));
    setDeviceNames(Object.fromEntries(factValue(phones)?.devices.map(d => [d.deviceId, d.displayName]) ?? []));
    if (next.status !== "loaded") setReadError("初始化记录读取失败。下方如有旧记录，仅供核对；读取成功前不能提交新核验。");
    else if ([assignments, names, phones].some(f => f.status !== "loaded")) setReadError("部分资源资料读取失败，未知名称不代表资源丢失；请重试读取。");
  }
  useEffect(() => { if (active) void refresh(); return () => { readEpoch.current++; }; }, [active, projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function send(kind: "request" | "recheck" | "execution-review", task?: AccountPreparationTaskView) {
    if (!view || readOnly || busy || loading || readError) return;
    const sameSession = captureOperatorWriteSession();
    setBusy(true); setMessage("");
    try {
      if (!pending.current) {
        pendingKind.current = kind;
        const metadata = { contractVersion, requestId: `request-${crypto.randomUUID()}`, idempotencyKey: newIdempotencyKey() };
        const base = { metadata, protocolVersion: executionLibraryVersion, projectId };
        let request: unknown;
        if (kind === "execution-review" && task) request = { ...base, taskId: task.taskId, expectedTaskVersion: task.taskVersion, expectedResourceVersion: view.resourceVersion };
        else if (kind === "recheck" && task) request = { ...base, taskId: task.taskId, expectedTaskVersion: task.taskVersion, expectedResourceVersion: view.resourceVersion,
          selectedAccountId: task.selectedAccountId ?? null, selectedDeviceId: task.selectedDeviceId ?? null };
        else {
          const bound = projectAssignments?.assignments.find(a => a.platform === platform && (!account || account === a.accountId));
          if (!bound) throw new Error("需要先完成本项目账号与手机分配");
          request = { ...base, expectedProjectVersion: view.projectVersion, expectedResourceVersion: view.resourceVersion,
            intent: { accountId: bound.accountId, deviceId: bound.deviceId, mode,
              target: platform === "facebook" ? { platform, name, expectedId: expectedId || null, category: category || null, description }
                : { platform, name, expectedId: expectedId || null, handle: handle || null },
              scopeRef: scope, allowTrustedInstall: mode === "prepare_if_missing" && install, allowIdentityCreation: mode === "prepare_if_missing" && create } };
        }
        pending.current = new PreparedAccountPreparation(kind, request);
      }
      readEpoch.current++; const next = await pending.current.send();
      if (!alive.current) return; sameSession();
      setView(next); pending.current = null; setUnresolved(false); onFactsChanged?.();
      setMessage(pendingKind.current === "execution-review" ? "执行条件核验已记录；条件未满足，本次未派发手机动作。"
        : "检查请求已记录，当前阻断已保存；尚未操作手机或创建 Page／频道。");
    } catch (e) {
      if (!alive.current) return;
      try { sameSession(); } catch { if (hasCsrfToken()) return; }
      if (e instanceof ProductApiError && e.status === 401) { expired.current(e); return; }
      if (isDefinitiveProjectRejection(e) || (!pending.current && !(e instanceof ProductApiError))) {
        pending.current = null; setUnresolved(false); setMessage("输入或事实版本需要核对，请读取当前记录后再提交；原任务没有被替换。");
      } else { setUnresolved(true); setMessage("本次请求结果尚未确认。输入已锁定，请接续原请求，不要重新创建任务。"); }
    } finally { if (alive.current) setBusy(false); }
  }
  const selectedAssignment = projectAssignments?.assignments.find(a => a.platform === platform && (!account || a.accountId === account));
  function submit(event: FormEvent) { event.preventDefault(); void send("request"); }
  return <section className="panel account-preparation-panel" aria-label="发布身份初始化" hidden={!active}>
    <div className="section-heading"><div><h3>发布身份初始化</h3><p className="muted">登记所需身份与准备范围，再核对当前条件。接通受控执行和可信证据前，检查记录不会启动手机。</p></div><button className="outline-button" disabled={busy || loading} onClick={() => void refresh()}>读取初始化记录</button></div>
    {loading && <p role="status">正在读取初始化与资源记录…</p>}
    {readError && <p className="feedback" role="alert">{readError}</p>}
    {message && <p className="feedback" role="status">{message}</p>}
    {!view ? <p>初始化记录待读取。</p> : <>
      {!readOnly && <form className="project-form" onSubmit={submit}>
        <fieldset disabled={busy || unresolved || loading || !!readError}>
          <label>平台<select aria-label="平台" value={platform} onChange={e => { setPlatform(e.target.value as "facebook" | "youtube"); setAccount(""); setDevice(""); setExpectedId(""); }}><option value="facebook">Facebook Page</option><option value="youtube">YouTube 频道</option></select></label>
          <label>已分配项目账号<select aria-label="项目账号" value={account || projectAssignments?.assignments.find(a => a.platform === platform)?.accountId || ""} onChange={e => { setAccount(e.target.value); setDevice(""); }} required><option value="" disabled>先在“媒体平台账号”完成项目账号与手机分配</option>{projectAssignments?.assignments.filter(a => a.platform === platform).map(a => <option key={a.accountId} value={a.accountId}>{accountNames[a.accountId] ?? "账号名称未知"} · {a.accountId.slice(0, 8)}</option>)}</select></label>
          <label>已分配项目手机<select aria-label="项目手机" value={device || projectAssignments?.assignments.find(a => a.accountId === (account || projectAssignments?.assignments.find(item => item.platform === platform)?.accountId))?.deviceId || ""} onChange={e => setDevice(e.target.value)} required><option value="" disabled>使用账号持久分配的手机</option>{projectAssignments?.assignments.filter(a => a.accountId === (account || projectAssignments?.assignments.find(item => item.platform === platform)?.accountId)).map(a => <option key={a.deviceId} value={a.deviceId}>{deviceNames[a.deviceId] ?? "手机名称未知"} · {a.deviceId.slice(0, 8)}</option>)}</select></label>
          {selectedAssignment && <details><summary>查看所选资源编号</summary>账号 {selectedAssignment.accountId} · 手机 {selectedAssignment.deviceId}</details>}
          <label>Page／频道准确名称<input value={name} onChange={e => setName(e.target.value)} required maxLength={100} /></label>
          <label>已有完整 Page／频道 ID（可留空）<input value={expectedId} onChange={e => setExpectedId(e.target.value)} maxLength={100} /></label>
          <label>初始化范围<select aria-label="初始化范围" value={mode} onChange={e => { setMode(e.target.value as "check_only" | "prepare_if_missing"); setCreate(false); setInstall(false); }}><option value="check_only">仅检查已有条件</option><option value="prepare_if_missing">检查并准备缺少的条件</option></select></label>
          <label>操作范围依据记录<input value={scope} onChange={e => setScope(e.target.value)} required maxLength={150} pattern="[A-Za-z0-9_-]+" /></label>
          {mode === "prepare_if_missing" && <><label className="preparation-choice"><input type="checkbox" checked={install} onChange={e => setInstall(e.target.checked)} />允许缺少时安装可信 App</label><label className="preparation-choice"><input type="checkbox" checked={create} onChange={e => setCreate(e.target.checked)} />允许确认缺少时创建一个 Page／频道</label></>}
          {mode === "prepare_if_missing" && create && (platform === "facebook" ? <><label>Page 类别<input value={category} onChange={e => setCategory(e.target.value)} required maxLength={100} /></label><label>Page 简介<textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} /></label></> : <label>频道标识名<input value={handle} onChange={e => setHandle(e.target.value)} required maxLength={100} /></label>)}
        </fieldset>
        <p className="form-note">登录标识与当前凭据由服务端从所选账号的持久分配读取；页面不收集平台账号 ID、密码或验证码。</p>
        <div className="project-save-actions"><button disabled={busy || unresolved || loading || !!readError || !projectAssignments?.assignments.some(a => a.platform === platform)} type="submit">{busy ? "检查中…" : "发起初始化检查"}</button>{unresolved && <button className="outline-button" type="button" disabled={busy || loading || !!readError} onClick={() => void send("request")}>接续原初始化请求</button>}</div>
      </form>}
      <h4>检查记录与下一步</h4>
      <p>资源分配由运营核对；手机参与、网络和原操作需核实当前记录；执行端或证据链路未接通需工程接入，重复提交不会补齐这些条件。</p>
      <div className="project-save-actions">{onOpenMediaAccounts && <button className="outline-button" onClick={onOpenMediaAccounts}>核对项目账号与手机分配</button>}{onOpenDevices && <button className="outline-button" onClick={onOpenDevices}>核对手机当前状态</button>}</div>
      {view.tasks.length === 0 ? <p>尚无初始化检查记录。</p> : <div className="table-wrap"><table><thead><tr><th>发布身份</th><th>当前状态</th><th>下一步／缺少条件</th><th>处理</th></tr></thead><tbody>{view.tasks.map(t => {
        const review = view.executionReviews.find(r => r.taskId === t.taskId);
        return <tr key={t.taskId}><td>{t.intent.target.name}<small>{t.intent.target.platform === "facebook" ? "Facebook Page" : "YouTube 频道"} · 任务 {t.taskId.slice(0, 8)} · v{t.taskVersion}{(!t.selectedAccountId || !t.selectedDeviceId) && " · 历史未绑定账号/手机，仅供查阅"}</small></td><td>{statuses[t.state]}</td><td>{t.nextOperationId && <p>下一步：{preparationExecutionLibrary.find(o => o.id === t.nextOperationId)?.name}</p>}{t.blockers.map(b => <p key={b}>{reasons[b] ?? "条件需要核对"}</p>)}
          {review && <details><summary>执行条件核验记录 · v{review.taskVersion}</summary>
            <p>核验时间：{new Date(review.reviewedAt).toLocaleString("zh-CN")} · 资源版本 {review.resourceVersion}</p>
            {(review.taskVersion !== t.taskVersion || review.resourceVersion !== view.resourceVersion) && <p>该记录对应较早事实，请重新核验当前条件。</p>}
            {review.blockers.map(b => <p key={b}>{reasons[b] ?? "条件需要核对"}</p>)}<p>本次核验未派发手机动作。</p></details>}
        </td><td>{readOnly ? "转电脑处理" : <><button className="text-button" disabled={busy || unresolved || loading || !!readError || !t.selectedAccountId || !t.selectedDeviceId} onClick={() => void send("recheck", t)}>重新检查原任务</button>
          <button className="text-button" disabled={busy || unresolved || loading || !!readError || !t.selectedAccountId || !t.selectedDeviceId} onClick={() => void send("execution-review", t)}>核验执行条件</button></>}</td></tr>;
      })}</tbody></table></div>}
      <h4>原操作与回执</h4>
      {view.originalOperations.length === 0 ? <p>尚无原手机操作记录；没有派发手机动作。</p> : <ul>{view.originalOperations.map(o => <li key={o.taskAttemptId}>
        原任务 {o.taskId.slice(0, 8)} · v{o.taskVersion} · {preparationExecutionLibrary.find(v => v.id === o.operationId)?.name}：
        {o.latestObservation ? observations[o.latestObservation.state] : "启动意图已保存，原结果待核实"}。
        {o.traceId ? ` 原 trace ${o.traceId.slice(0, 8)}。` : " 原 trace 尚未确认。"}
        {o.latestObservation && ` 已登记 ${o.latestObservation.evidenceIds.length} 项证据引用，尚未可信核验。`}
      </li>)}</ul>}
      <p className="form-note">读取记录只查看已保存事实，不产生手机截图；执行端回执不等于平台身份或管理权限已核验。</p>
      <p className="form-note">请求受理和检查记录不代表手机已执行、身份已核验或可以发布；未知结果继续核实原操作。</p>
    </>}
  </section>;
}
