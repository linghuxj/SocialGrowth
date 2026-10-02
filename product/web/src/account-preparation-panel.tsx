import { useEffect, useRef, useState, type FormEvent } from "react";
import { contractVersion, executionLibraryVersion, preparationExecutionLibrary, type AccountPreparationWorkspace, type AccountPreparationTaskView } from "@socialgrowth/product-contracts";
import { PreparedAccountPreparation, readAccountPreparation } from "./account-preparation-api.js";
import { isDefinitiveProjectRejection, newIdempotencyKey, ProductApiError } from "./operator-api.js";
const reasons: Record<string, string> = {
  RESOURCE_ASSIGNMENT_REQUIRED: "等待项目账号与手机分配",
  PARENT_ACCOUNT_SCOPE_MISMATCH: "所选账号与登录身份记录或平台不一致",
  DEVICE_PARTICIPATION_RECHECK_REQUIRED: "手机暂停、恢复或退出状态需要复核",
  VERIFY_ORIGINAL_DEVICE_CALL: "先核实手机上的原未决操作",
  BOUND_IDENTITY_MUST_BE_PRESERVED: "已有绑定身份必须保留，请核对准确 ID",
  CURRENT_DEVICE_ACTION_FENCE_REQUIRED: "等待手机当前授权与独占控制接通",
  PREPARATION_EXECUTOR_NOT_CONNECTED: "等待 Artemis 初始化执行端接通",
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
export function AccountPreparationPanel({ projectId, active, readOnly, onExpired }: {
  projectId: string; active: boolean; readOnly: boolean; onExpired: (error: unknown) => void;
}) {
  const [view, setView] = useState<AccountPreparationWorkspace | null>(null), [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false), [unresolved, setUnresolved] = useState(false);
  const [platform, setPlatform] = useState<"facebook" | "youtube">("facebook");
  const [mode, setMode] = useState<"check_only" | "prepare_if_missing">("check_only");
  const [account, setAccount] = useState(""), [device, setDevice] = useState("");
  const [parent, setParent] = useState(""), [name, setName] = useState(""), [expectedId, setExpectedId] = useState("");
  const [category, setCategory] = useState(""), [description, setDescription] = useState(""), [handle, setHandle] = useState("");
  const [scope, setScope] = useState(""), [install, setInstall] = useState(false), [create, setCreate] = useState(false);
  const pending = useRef<PreparedAccountPreparation | null>(null), readEpoch = useRef(0);
  const pendingKind = useRef<"request" | "recheck" | "execution-review">("request");
  async function refresh() {
    const epoch = ++readEpoch.current;
    try { const next = await readAccountPreparation(projectId); if (epoch === readEpoch.current) setView(next); }
    catch (e) { if (epoch !== readEpoch.current) return; if (e instanceof ProductApiError && e.status === 401) onExpired(e); else setMessage("检查记录暂时无法读取，请重试；没有更改原任务。"); }
  }
  useEffect(() => { if (active) void refresh(); return () => { readEpoch.current++; }; }, [active, projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function send(kind: "request" | "recheck" | "execution-review", task?: AccountPreparationTaskView) {
    if (!view || readOnly || busy) return;
    setBusy(true); setMessage("");
    try {
      if (!pending.current) {
        pendingKind.current = kind;
        const metadata = { contractVersion, requestId: `request-${crypto.randomUUID()}`, idempotencyKey: newIdempotencyKey() };
        const base = { metadata, protocolVersion: executionLibraryVersion, projectId };
        pending.current = new PreparedAccountPreparation(kind, kind === "execution-review" && task
          ? { ...base, taskId: task.taskId, expectedTaskVersion: task.taskVersion, expectedResourceVersion: view.resourceVersion }
          : kind === "recheck" && task
          ? { ...base, taskId: task.taskId, expectedTaskVersion: task.taskVersion, expectedResourceVersion: view.resourceVersion,
            selectedAccountId: task.selectedAccountId ?? (account || null), selectedDeviceId: task.selectedDeviceId ?? (device || null) }
          : { ...base, expectedProjectVersion: view.projectVersion, expectedResourceVersion: view.resourceVersion,
            intent: { accountId: account || null, deviceId: device || null, parentLoginRef: parent, mode,
              target: platform === "facebook" ? { platform, name, expectedId: expectedId || null, category: category || null, description }
                : { platform, name, expectedId: expectedId || null, handle: handle || null },
              scopeRef: scope, allowTrustedInstall: mode === "prepare_if_missing" && install, allowIdentityCreation: mode === "prepare_if_missing" && create } });
      }
      readEpoch.current++; const next = await pending.current.send(); setView(next); pending.current = null; setUnresolved(false);
      setMessage(pendingKind.current === "execution-review" ? "执行条件核验已记录；条件未满足，本次未派发手机动作。"
        : "检查请求已记录，当前阻断已保存；尚未操作手机或创建 Page／频道。");
    } catch (e) {
      if (e instanceof ProductApiError && e.status === 401) { onExpired(e); return; }
      if (isDefinitiveProjectRejection(e) || (!pending.current && !(e instanceof ProductApiError))) {
        pending.current = null; setUnresolved(false); setMessage("输入或事实版本需要核对，请读取当前记录后再提交；原任务没有被替换。");
      } else { setUnresolved(true); setMessage("本次请求结果尚未确认。输入已锁定，请接续原请求，不要重新创建任务。"); }
    } finally { setBusy(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void send("request"); }
  return <section className="panel account-preparation-panel" aria-label="发布身份初始化" hidden={!active}>
    <div className="section-heading"><div><h3>发布身份初始化</h3><p className="muted">系统检查已申请账号的 App、登录与 Page／频道条件；已有身份复用，缺少时按所选范围准备。</p></div><button className="outline-button" disabled={busy} onClick={() => void refresh()}>读取初始化记录</button></div>
    {message && <p className="feedback" role="status">{message}</p>}
    {!view ? <p>初始化记录待读取。</p> : <>
      {!readOnly && <form className="project-form" onSubmit={submit}>
        <fieldset disabled={busy || unresolved}>
          <label>平台<select aria-label="平台" value={platform} onChange={e => { setPlatform(e.target.value as "facebook" | "youtube"); setAccount(""); setExpectedId(""); }}><option value="facebook">Facebook Page</option><option value="youtube">YouTube 频道</option></select></label>
          <label>项目账号<select aria-label="项目账号" value={account} onChange={e => setAccount(e.target.value)}><option value="">待分配，先记录检查需求</option>{view.accounts.filter(a => a.platform === platform).map(a => <option key={a.accountId} value={a.accountId}>{a.accountId}</option>)}</select></label>
          <label>项目手机<select aria-label="项目手机" value={device} onChange={e => setDevice(e.target.value)}><option value="">待分配，先记录检查需求</option>{view.devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.deviceId}</option>)}</select></label>
          <label>父登录账号记录标识<input value={parent} onChange={e => setParent(e.target.value)} required maxLength={150} pattern="[A-Za-z0-9_-]+" /></label>
          <label>Page／频道准确名称<input value={name} onChange={e => setName(e.target.value)} required maxLength={100} /></label>
          <label>已有完整 Page／频道 ID（可留空）<input value={expectedId} onChange={e => setExpectedId(e.target.value)} maxLength={100} /></label>
          <label>初始化范围<select aria-label="初始化范围" value={mode} onChange={e => { setMode(e.target.value as "check_only" | "prepare_if_missing"); setCreate(false); setInstall(false); }}><option value="check_only">仅检查已有条件</option><option value="prepare_if_missing">检查并准备缺少的条件</option></select></label>
          <label>操作范围依据记录<input value={scope} onChange={e => setScope(e.target.value)} required maxLength={150} pattern="[A-Za-z0-9_-]+" /></label>
          {mode === "prepare_if_missing" && <><label className="preparation-choice"><input type="checkbox" checked={install} onChange={e => setInstall(e.target.checked)} />允许缺少时安装可信 App</label><label className="preparation-choice"><input type="checkbox" checked={create} onChange={e => setCreate(e.target.checked)} />允许确认缺少时创建一个 Page／频道</label></>}
          {mode === "prepare_if_missing" && create && (platform === "facebook" ? <><label>Page 类别<input value={category} onChange={e => setCategory(e.target.value)} required maxLength={100} /></label><label>Page 简介<textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} /></label></> : <label>频道标识名<input value={handle} onChange={e => setHandle(e.target.value)} required maxLength={100} /></label>)}
        </fieldset>
        <p className="form-note">填写账号与操作依据的记录标识，不填密码或验证码。资源未分配时先保留需求，分配与物理许可核验通过后才能触发手机执行。</p>
        <div className="project-save-actions"><button disabled={busy || unresolved} type="submit">{busy ? "检查中…" : "发起初始化检查"}</button>{unresolved && <button className="outline-button" type="button" disabled={busy} onClick={() => void send("request")}>接续原初始化请求</button>}</div>
      </form>}
      <h4>检查记录与下一步</h4>
      {view.tasks.length === 0 ? <p>尚无初始化检查记录。</p> : <div className="table-wrap"><table><thead><tr><th>发布身份</th><th>当前状态</th><th>下一步／缺少条件</th><th>处理</th></tr></thead><tbody>{view.tasks.map(t => {
        const review = view.executionReviews.find(r => r.taskId === t.taskId);
        return <tr key={t.taskId}><td>{t.intent.target.name}<small>{t.intent.target.platform === "facebook" ? "Facebook Page" : "YouTube 频道"} · 任务 {t.taskId.slice(0, 8)} · v{t.taskVersion}</small></td><td>{statuses[t.state]}</td><td>{t.nextOperationId && <p>下一步：{preparationExecutionLibrary.find(o => o.id === t.nextOperationId)?.name}</p>}{t.blockers.map(b => <p key={b}>{reasons[b] ?? "条件需要核对"}</p>)}
          {review && <details><summary>执行条件核验记录 · v{review.taskVersion}</summary>
            {(review.taskVersion !== t.taskVersion || review.resourceVersion !== view.resourceVersion) && <p>该记录对应较早事实，请重新核验当前条件。</p>}
            {review.blockers.map(b => <p key={b}>{reasons[b] ?? "条件需要核对"}</p>)}<p>本次核验未派发手机动作。</p></details>}
        </td><td>{readOnly ? "转电脑处理" : <><button className="text-button" disabled={busy || unresolved} onClick={() => void send("recheck", t)}>重新检查原任务</button>
          <button className="text-button" disabled={busy || unresolved} onClick={() => void send("execution-review", t)}>核验执行条件</button></>}</td></tr>;
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
