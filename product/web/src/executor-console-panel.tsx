import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ExecutorConsole } from "@socialgrowth/product-contracts";
import { currentOperatorSessionContext, ProductApiError } from "./operator-api.js";
import { readExecutorConsole, prepareExecutorMutation, executorScreenshot } from "./executor-console-api.js";

const pendingKey = () => {
  const context = currentOperatorSessionContext();
  return context ? `socialgrowth.executor.pending:${context.operatorId}:${context.sessionId}` : null;
};
export function ExecutorConsolePanel({ active, refreshVersion, readOnly, onExpired }: { active: boolean; refreshVersion: number; readOnly: boolean; onExpired(error: unknown): void }) {
  const [facts, setFacts] = useState<ExecutorConsole | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<Set<string>>(new Set());
  const [platform, setPlatform] = useState("facebook");
  const [mode, setMode] = useState("observe");
  const revision = useRef(0);
  function fail(error: unknown) {
    if (error instanceof ProductApiError && error.status === 401) onExpired(error);
    setMessage(error instanceof Error ? error.message : "结果未确认，请查询原任务。");
  }
  function clearPending() {
    const key = pendingKey(); if (key) sessionStorage.removeItem(key); setPending(null);
  }
  async function refresh() {
    const current = ++revision.current;
    try {
      const next = await readExecutorConsole();
      if (current !== revision.current) return;
      setFacts(next);
      const key = pendingKey(), original = key ? sessionStorage.getItem(key) : null;
      if (original && next.jobs.some(job => job.requestId === original)) {
        clearPending(); setMessage("原请求已查到。请按任务当前状态及实际证据判断结果。");
      }
    } catch (error) { if (current === revision.current) { setFacts(null); fail(error); } }
  }
  useEffect(() => {
    if (!active) { revision.current += 1; return; }
    const key = pendingKey(); setPending(key ? sessionStorage.getItem(key) : null); void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => { clearInterval(timer); revision.current += 1; };
    // The panel is owned by the current authenticated workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, refreshVersion]);
  async function mutate(path: Parameters<typeof prepareExecutorMutation>[0], input: unknown, key?: string) {
    if (busy || readOnly || (key && uncertain.has(key))) return;
    setBusy(true); setMessage("");
    try { await prepareExecutorMutation(path, input)(); setMessage("操作已接收。手机结果仍须重新核验。"); }
    catch (error) { if (key) setUncertain(previous => new Set(previous).add(key)); fail(error); }
    finally { setBusy(false); await refresh(); }
  }
  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || readOnly || pending || !facts?.available) return;
    const form = event.currentTarget, data = new FormData(form), requestId = crypto.randomUUID();
    const body = { requestId, expectedName: String(data.get("expectedName")), expectedProfileId: String(data.get("expectedProfileId")),
      platform, mode, goal: String(data.get("goal")), caption: String(data.get("caption")), acknowledgeNoPublication: true,
      allowLocalParticipationStart: data.get("startParticipation") === "on", allowEndpointReportingStart: data.get("startEndpoints") === "on", allowParticipationWithdrawal: data.get("withdraw") === "on" };
    const key = pendingKey(); if (!key) return;
    // Store only the original operation ID, before sending. Never save credentials.
    sessionStorage.setItem(key, requestId); setPending(requestId); setBusy(true); setMessage("");
    try { await prepareExecutorMutation("verifications", body)(); clearPending(); form.reset(); setMessage("检查任务已受理。受理不代表执行成功。"); }
    catch (error) { fail(error); }
    finally { setBusy(false); await refresh(); }
  }
  if (!active) return null;
  return <div className="executor-console">
    <section className="panel" aria-labelledby="executor-status-title">
      <div className="section-heading"><div><h2 id="executor-status-title">执行状态</h2><p className="muted">沿用原任务和证据。未知结果保留，不自动重发。</p></div><button type="button" className="outline-button" disabled={busy} onClick={() => void refresh()}>查询原任务</button></div>
      {message && <p role="status" className="feedback">{message}</p>}
      {pending && <p role="alert">原检查请求 {pending} 的结果待确认。请查询原任务，不要新建相同检查。</p>}
      {!facts ? <p>执行状态尚未取得。</p> : <>
        <p>{facts.configured ? "执行服务已配置" : "执行服务未配置"}；{facts.available ? "受控检查可用" : "受控检查未配置"}。</p>
        {facts.deviceId && <p>检查设备：{facts.deviceId}；{facts.holds.some(hold => hold.device === facts.deviceId) ? "人工占用中" : "未取得人工占用"}</p>}
        {facts.deviceId && !readOnly && <div className="header-actions"><button type="button" className="outline-button" disabled={busy} onClick={() => void mutate("hold", { deviceId: facts.deviceId, held: true })}>申请人工接管</button><button type="button" className="outline-button" disabled={busy} onClick={() => void mutate("hold", { deviceId: facts.deviceId, held: false })}>交还自动复查</button></div>}
        <div className="table-wrap"><table><thead><tr><th>原执行任务</th><th>当前状态</th></tr></thead><tbody>{facts.tasks.map(task => <tr key={task.id}><td>{task.id}</td><td>{task.status}</td></tr>)}</tbody></table></div>
      </>}
    </section>
    {facts && <section className="panel" aria-labelledby="bootstrap-title">
      <h2 id="bootstrap-title">手机接入与准备</h2><p>首次配对成功后，申请人工接管，再发起 Artemis 手机准备。此操作不启用业务任务；系统安装和 VPN 授权仍需机主确认。</p>
      {!facts.bootstrapDevices.length && <p>尚无可准备的手机。请在 App 完成本机关联并开启配对通知；平台核验真实连接后会显示在这里。</p>}
      {facts.bootstrapDevices.map(device => <article key={device.deviceId}>
        <p>设备：{device.deviceId} · {device.connected ? device.mode === "managed_verified" ? "管理连接已核验" : "首次连接已核验" : "等待首次配对或重新连接"}</p>
        {!readOnly && <div className="header-actions">
          <button type="button" disabled={busy || !device.connected} onClick={() => void mutate("hold", { deviceId: device.deviceId, held: true })}>接管这台新手机</button>
          <button type="button" disabled={busy || !!pending || !device.connected || !facts.holds.some(h => h.device === device.deviceId)} onClick={() => {
            const requestId = crypto.randomUUID(), key = pendingKey(); if (!key) return;
            sessionStorage.setItem(key, requestId); setPending(requestId);
            void mutate("bootstrap-verifications", { deviceId: device.deviceId, requestId, acknowledgePreparation: true });
          }}>开始手机准备（不执行业务）</button>
        </div>}
        {!readOnly && device.mode === "bootstrap" && <form onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); void mutate("bootstrap-handoff", { deviceId: device.deviceId, address: String(data.get("address")) }); }}>
          <label>准备完成后的手机管理网络 IP<input name="address" required maxLength={128} placeholder="100.x.x.x" /></label>
          <button type="submit" disabled={busy || !device.connected || facts.jobs.some(j => j.deviceId === device.deviceId && j.status === "running")}>核验并切换管理连接</button>
          <p className="muted">平台会独立核对在线节点和实际手机身份。未通过时保留当前通道。</p>
        </form>}
      </article>)}
    </section>}
    <section className="panel" aria-labelledby="executor-check-title"><h2 id="executor-check-title">受控执行检查</h2><p className="muted">Artemis 按已确认范围操作指定手机。此入口不授予公开发布权限。先核对目标并申请人工接管。</p>
      {!readOnly && <form onSubmit={event => void start(event)}>
        <fieldset disabled={busy || !!pending || !facts?.available} className="invitation-form">
          <label>检查平台<select value={platform} onChange={event => { setPlatform(event.target.value); setMode(event.target.value === "socialgrowth" ? "client_test" : "observe"); }}><option value="facebook">Facebook</option><option value="youtube">YouTube</option><option value="socialgrowth">SocialGrowth Android</option></select></label>
          <label>检查模式<select value={mode} onChange={event => setMode(event.target.value)}>{platform === "socialgrowth" ? <><option value="client_test">客户端检查</option><option value="connectivity_test">网络接入检查</option></> : <><option value="observe">只读观察</option>{platform === "facebook" && <option value="preflight">发布前检查</option>}</>}</select></label>
          <label>预期身份名称<input name="expectedName" maxLength={100} required /></label>
          <label>预期身份编号<input name="expectedProfileId" pattern={platform === "socialgrowth" ? "com\\.socialgrowth\\.product" : platform === "youtube" ? "UC[A-Za-z0-9_\\-]{22}" : "[0-9]{5,30}"} required /></label>
          <label>任务目标（禁止凭证）<textarea name="goal" maxLength={2000} /></label><label>检查说明<input name="caption" maxLength={1000} required /></label>
          {platform === "socialgrowth" && <><label><input type="checkbox" name="startEndpoints" />允许启动端口上报</label>{mode === "client_test" && <><label><input type="checkbox" name="startParticipation" />允许首次开启本机参与</label><label><input type="checkbox" name="withdraw" />允许验证撤回本机参与</label></>}</>}
          <label><input type="checkbox" required />确认目标与范围，禁止最终发布</label><button type="submit">启动受控检查</button>
        </fieldset>
      </form>}
    </section>
    <section className="panel" aria-labelledby="executor-jobs-title"><h2 id="executor-jobs-title">检查任务与回执</h2><p className="muted">finished 只说明检查结束。结论按结果码和证据判断；停止请求不等于手机已停止。</p>
      {facts?.jobs.map(job => <article key={job.id} data-executor-job={job.id}><h3>{job.expectedName} · {job.expectedProfileId}</h3><p>任务：{job.id}；{job.status}；{job.resultCode ?? job.errorCode ?? "结果未确认"}</p><a href={executorScreenshot("verifications", job.id)} target="_blank" rel="noreferrer">查看结果截图</a>{!readOnly && job.status === "running" && <button type="button" disabled={busy} onClick={() => void mutate("stop", { id: job.id })}>请求停止</button>}</article>)}
    </section>
    <section className="panel" aria-labelledby="executor-requests-title"><h2 id="executor-requests-title">人工协助与复查</h2><p className="muted">核对原任务、设备和预期身份。回复后由 Artemis 重新观察，不将人工回复作为成功证明。</p>
      {facts?.requests.map(request => <article key={request.id}><h3>{request.deviceId} · {request.expectedIdentity}</h3><p>任务：{request.taskId}；{request.status}；{request.message}</p><a href={executorScreenshot("supervision", request.id)} target="_blank" rel="noreferrer">查看待办截图</a>
        {!readOnly && request.status === "waiting" && Date.parse(request.expiresAt) > Date.now() && <form onSubmit={event => { event.preventDefault(); const form = event.currentTarget; void mutate("respond", { id: request.id, expectedIdentity: request.expectedIdentity, confirmed: true, decision: request.kind === "approval" ? "approved" : request.kind === "manual" ? "completed" : "provided", text: String(new FormData(form).get("text")) }, request.id); }}>
          <label>人工处理说明（禁止凭证）<textarea name="text" required maxLength={4000} disabled={busy || uncertain.has(request.id)} /></label><label><input type="checkbox" required disabled={busy || uncertain.has(request.id)} />已核对预期身份</label><button disabled={busy || uncertain.has(request.id)}>提交人工回复</button><button type="button" disabled={busy} onClick={() => void mutate("respond", { id: request.id, expectedIdentity: request.expectedIdentity, confirmed: true, decision: "cancel", text: "" })}>取消原任务</button>
        </form>}
      </article>)}
    </section>
    <section className="panel" aria-labelledby="executor-credentials-title"><h2 id="executor-credentials-title">安全登录协助</h2><p className="muted">密码和验证码只传递给原任务，输入后立即清空。不保存至浏览器或运行数据库。送达不代表登录成功。</p>
      {facts?.challenges.map(challenge => <article key={challenge.id}><h3>{challenge.deviceId} · {challenge.expectedIdentity}</h3><p>原任务：{challenge.taskId}；{challenge.status}；{challenge.workflowResult ?? challenge.resultCode ?? ""}</p><a href={executorScreenshot("assistance", challenge.id)} target="_blank" rel="noreferrer">查看登录截图</a>
        {!readOnly && challenge.status === "waiting" && Date.parse(challenge.expiresAt) > Date.now() && <form onSubmit={event => {
          event.preventDefault(); const form = event.currentTarget, field = form.elements.namedItem("password") as HTMLInputElement, password = field.value; field.value = "";
          void mutate("credential", { id: challenge.id, expectedIdentity: challenge.expectedIdentity, confirmed: true, password }, challenge.id);
        }}><label>{challenge.kind === "otp" ? "一次性验证码" : "登录密码"}<input name="password" type="password" autoComplete="off" maxLength={128} required disabled={busy || uncertain.has(challenge.id)} /></label><label><input type="checkbox" required disabled={busy || uncertain.has(challenge.id)} />已核对原任务和预期身份</label><button disabled={busy || uncertain.has(challenge.id)}>安全提交</button><button type="button" disabled={busy} onClick={() => void mutate("cancel-credential", { id: challenge.id })}>取消登录协助</button></form>}
      </article>)}
    </section>
  </div>;
}
