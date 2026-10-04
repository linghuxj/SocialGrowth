import { useEffect, useRef, useState, type FormEvent } from "react";
import type { MediaAccount, ProjectView } from "@socialgrowth/product-contracts";
import { isDefinitiveProjectRejection, listProjects, ProductApiError, currentOperatorSessionContext } from "./operator-api.js";
import {
  prepareAccountAssignment, prepareCredentialInvalidate, prepareCredentialPut,
  prepareMediaAccountCreate, prepareMediaAccountProfile, readAccountAssignments, readMediaAccountCommand,
  readMediaAccounts, readResourceCommand,
} from "./media-accounts-api.js";

type Props = { active: boolean; refreshVersion: number; readOnly: boolean; onExpired(error: unknown): void };
type Pending = { key: string; kind: "account" | "assignment"; operatorId: string; send?: () => Promise<unknown>; lookup: () => Promise<{ state: string }> };
const pendingStorageKey = "sg.media-accounts.pending.v1";

function message(error: unknown): string {
  const candidate = error as { response?: { error?: { code?: string } }; message?: string };
  const code = candidate?.response?.error?.code;
  if (code === "AUTHENTICATION_REQUIRED") return "登录已失效，请重新登录";
  if (code === "FACT_VERSION_STALE") return "资源状态已变化，请刷新后重试；未自动改派";
  if (code === "IDEMPOTENCY_KEY_REUSED") return "原请求仍在处理中或结果待核对，请查询原操作";
  if (code === "INPUT_INVALID") return "输入不符合要求，请检查账号资料";
  return "请求失败；请先查询原操作状态";
}
function isDefinitiveNoWrite(error: unknown): boolean {
  return isDefinitiveProjectRejection(error);
}

export function MediaAccountsPanel({ active, refreshVersion, readOnly, onExpired }: Props) {
  const [accounts, setAccounts] = useState<MediaAccount[]>([]);
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [projectId, setProjectId] = useState("");
  const [assignment, setAssignment] = useState<Awaited<ReturnType<typeof readAccountAssignments>> | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [secretAccount, setSecretAccount] = useState("");
  const [profileAccount, setProfileAccount] = useState("");
  const [pendingKey, setPendingKey] = useState("");
  const [resourceVersion, setResourceVersion] = useState(0);
  const pending = useRef<Pending | null>(null);
  const createForm = useRef<HTMLFormElement | null>(null);
  const assignmentReadEpoch = useRef(0);
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  useEffect(() => {
    const saved = sessionStorage.getItem(pendingStorageKey);
    if (!saved) return;
    try {
      const item = JSON.parse(saved) as { key: string; kind: "account" | "assignment"; operatorId: string };
      const currentOwner = currentOperatorSessionContext()?.operatorId;
      if (!item.key || !["account", "assignment"].includes(item.kind) || !item.operatorId) throw new Error();
      if (!currentOwner || item.operatorId.toLowerCase() !== currentOwner) {
        sessionStorage.removeItem(pendingStorageKey);
        setNotice("上次操作属于另一运营账号，已丢弃其本地恢复键；不会查询或重试该账号的操作。");
        return;
      }
      const lookup = () => item.kind === "account" ? readMediaAccountCommand(item.key) : readResourceCommand(item.key);
      pending.current = { ...item, lookup };
      setPendingKey(item.key);
      setNotice("发现上次结果待确认记录。仅保存了操作键，没有保存密码或请求内容；可查询状态，若未查到不能安全重试。");
    } catch { sessionStorage.removeItem(pendingStorageKey); }
  }, []);
  useEffect(() => () => { pending.current = null; }, []);

  function rememberPending(op: Pending) {
    pending.current = op; setPendingKey(op.key);
    sessionStorage.setItem(pendingStorageKey, JSON.stringify({ key: op.key, kind: op.kind, operatorId: op.operatorId }));
  }
  function clearPending() { pending.current = null; setPendingKey(""); sessionStorage.removeItem(pendingStorageKey); }
  function discardSensitivePendingBody() {
    const op = pending.current;
    if (!op) return;
    const { key, kind, operatorId, lookup } = op;
    const safePending: Pending = { key, kind, operatorId, lookup };
    pending.current = safePending;
    sessionStorage.setItem(pendingStorageKey, JSON.stringify({ key, kind, operatorId }));
    createForm.current?.reset();
    setSecretAccount("");
    setProfileAccount("");
  }
  function handleWriteFailure(error: unknown) {
    if (isDefinitiveNoWrite(error)) clearPending();
    if (error instanceof ProductApiError && error.status === 401) {
      // Keep only the original key for later status lookup; never keep the
      // secret-bearing request closure after the authenticated session fails.
      discardSensitivePendingBody();
      onExpired(error);
      return;
    }
    setError(message(error));
  }

  async function loadAssignment(targetProjectId: string) {
    const epoch = ++assignmentReadEpoch.current;
    setAssignment(null);
    try {
      const next = await readAccountAssignments(targetProjectId);
      if (epoch !== assignmentReadEpoch.current || targetProjectId !== projectIdRef.current
        || next.projectId?.toLowerCase() !== targetProjectId.toLowerCase()) return;
      setAssignment(next);
    } catch (error) {
      if (epoch !== assignmentReadEpoch.current || targetProjectId !== projectIdRef.current) return;
      setError(message(error));
      if (error instanceof ProductApiError && error.status === 401) onExpired(error);
    }
  }

  async function refresh() {
    setError("");
    try {
      const [list, projectList] = await Promise.all([readMediaAccounts(), listProjects()]);
      setAccounts(list.accounts); setProjects(projectList); setResourceVersion(list.resourceVersion);
      if (projectId) await loadAssignment(projectId);
    } catch (e) { if (e instanceof ProductApiError && e.status === 401) onExpired(e); setError(message(e)); }
  }
  useEffect(() => { if (active) void refresh(); }, [active, refreshVersion]);
  useEffect(() => {
    if (!projectId) { assignmentReadEpoch.current++; setAssignment(null); return; }
    void loadAssignment(projectId);
    return () => { assignmentReadEpoch.current++; };
  }, [projectId]);

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
    setBusy(true); setNotice(""); setError("");
    try {
      const password = String(values.get("password") ?? "");
      const persona = (String(values.get("personName") ?? "").trim() || String(values.get("birthday") ?? "") || String(values.get("gender") ?? "")) ? {
          name: String(values.get("personName") ?? "").trim() || null,
          birthday: String(values.get("birthday") ?? "") || null,
          gender: String(values.get("gender") ?? "") || null,
        } : undefined;
      const loginIdentifier = String(values.get("loginIdentifier") ?? "").trim();
      const displayName = String(values.get("displayName") ?? "").trim() || loginIdentifier.slice(0, 200);
      const prepared = prepareMediaAccountCreate({ expectedResourceVersion: Number(values.get("expectedResourceVersion")),
        platform: String(values.get("platform")) as "facebook" | "youtube", displayName, loginIdentifier, password, ...(persona ? { persona } : {}) });
      const owner = currentOperatorSessionContext()?.operatorId;
      if (!owner) throw new Error("需要重新登录后再保存账号");
      rememberPending({ key: prepared.idempotencyKey, kind: "account", operatorId: owner, send: () => prepared.send(), lookup: () => readMediaAccountCommand(prepared.idempotencyKey) });
      await prepared.send(); clearPending(); form.reset(); setNotice("账号资料已保存；登录和平台身份仍未核验。密码已清除。");
      await refresh();
    } catch (e) { handleWriteFailure(e); } finally { setBusy(false); }
  }

  async function queryPending() {
    const op = pending.current; if (!op) return;
    setBusy(true);
    try {
      const result = await op.lookup();
      if (result.state === "applied") { clearPending(); createForm.current?.reset(); setSecretAccount(""); setProfileAccount(""); setNotice("原操作已提交；已按服务器状态刷新。不会重复创建。"); await refresh(); }
      else setNotice(op.send ? "原键当前未查到结果。可以用同一页面保留的原请求内容和原键继续；不会换键。" : "原键当前未查到结果，且原请求内容未保留。为避免重复建号，不能安全重试；请先等待服务端回读或人工核对。 ");
    } catch (e) {
      if (e instanceof ProductApiError && e.status === 401) { discardSensitivePendingBody(); onExpired(e); }
      else setError(message(e));
    } finally { setBusy(false); }
  }
  async function retryPending() {
    const op = pending.current; if (!op?.send) { setNotice("原请求内容未保留，不能安全重试；请先等待服务端回读或人工核对。"); return; }
    setBusy(true);
    try { await op.send(); clearPending(); createForm.current?.reset(); setSecretAccount(""); setProfileAccount(""); setNotice("原请求已完成；列表状态已刷新。"); await refresh(); }
    catch (e) { handleWriteFailure(e); } finally { setBusy(false); }
  }
  async function credentialAction(account: MediaAccount, operation: "put" | "invalidate", loginIdentifier = "", password = "") {
    setBusy(true); setError(""); setNotice("");
    try {
      const prepared = operation === "put" ? prepareCredentialPut(account, loginIdentifier, password) : prepareCredentialInvalidate(account);
      const owner = currentOperatorSessionContext()?.operatorId;
      if (!owner) throw new Error("需要重新登录后再保存凭据");
      rememberPending({ key: prepared.idempotencyKey, kind: "account", operatorId: owner, send: () => prepared.send(), lookup: () => readMediaAccountCommand(prepared.idempotencyKey) });
      await prepared.send(); setSecretAccount(""); setNotice(operation === "put" ? "凭据已替换并保存；平台登录仍未核验。" : "本系统保存的凭据已失效；这不代表平台密码已修改或已退出登录。");
      clearPending();
      await refresh();
    } catch (e) { handleWriteFailure(e); } finally { setBusy(false); }
  }
  async function submitProfile(event: FormEvent<HTMLFormElement>, account: MediaAccount) {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    setBusy(true); setError(""); setNotice("");
    try {
      const name = String(values.get("personName") ?? "").trim();
      const birthday = String(values.get("birthday") ?? "");
      const gender = String(values.get("gender") ?? "");
      const persona = name || birthday || gender ? { name: name || null, birthday: birthday || null, gender: gender || null } : null;
      const prepared = prepareMediaAccountProfile({ accountId: account.accountId,
        expectedResourceVersion: resourceVersion, displayName: String(values.get("displayName") ?? "").trim(), persona });
      const owner = currentOperatorSessionContext()?.operatorId;
      if (!owner) throw new Error("需要重新登录后再保存资料");
      rememberPending({ key: prepared.idempotencyKey, kind: "account", operatorId: owner,
        send: () => prepared.send(), lookup: () => readMediaAccountCommand(prepared.idempotencyKey) });
      await prepared.send(); clearPending(); setProfileAccount(""); setNotice("账号识别资料已更新；平台账号与登录核验状态未改变。");
      await refresh();
    } catch (e) { handleWriteFailure(e); } finally { setBusy(false); }
  }
  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!assignment || !projectId || assignment.projectId?.toLowerCase() !== projectId.toLowerCase()
      || projectIdRef.current.toLowerCase() !== projectId.toLowerCase()) return;
    const form = new FormData(event.currentTarget); const deviceId = String(form.get("deviceId") ?? "");
    const accountIds = form.getAll("accountId").map(String).filter(Boolean);
    if (!deviceId || !accountIds.length) { setError("请选择可用手机和至少一个账号"); return; }
    if (accountIds.length > 2) { setError("每个手机最多分配两个账号"); return; }
    if (assignment.projectVersion === null) { setError("项目版本暂不可读取，请刷新；本次未执行分配"); return; }
    const device = assignment.eligibleDevices.find(d => d.deviceId.toLowerCase() === deviceId.toLowerCase());
    if (!device) { setError("所选手机已不在当前项目的可分配列表中，请刷新后重选"); return; }
    setBusy(true); setError("");
    try {
      const prepared = prepareAccountAssignment({ expectedResourceVersion: assignment.resourceVersion,
        expectedProjectVersion: assignment.projectVersion, expectedDeviceVersion: device.deviceVersion,
        projectId, deviceId, accountIds });
      const owner = currentOperatorSessionContext()?.operatorId;
      if (!owner) throw new Error("需要重新登录后再分配账号");
      rememberPending({ key: prepared.idempotencyKey, kind: "assignment", operatorId: owner, send: () => prepared.send(), lookup: () => readResourceCommand(prepared.idempotencyKey) });
      await prepared.send(); clearPending(); setNotice("账号与手机分配已持久保存；这不代表账号登录成功。");
      await refresh();
    } catch (e) { handleWriteFailure(e); } finally { setBusy(false); }
  }

  if (!active) return null;
  const reserved = assignment?.assignments ?? [];
  return <div className="media-accounts-workspace">
    <section className="panel" aria-labelledby="media-accounts-title">
      <div className="section-heading"><div><h2 id="media-accounts-title">媒体平台账号</h2><p className="muted">公司运营用的平台账号资料，与运营人员账号、提供者手机身份分开管理。</p></div><span className="count-label">{accounts.length} 个账号</span></div>
      {error && <p role="alert" className="feedback">{error}</p>}{notice && <p role="status" className="feedback">{notice}</p>}
      {!readOnly && <form ref={createForm} className="media-account-form" onSubmit={e => void submitForm(e)}>
        <fieldset disabled={busy || Boolean(pendingKey)} className="media-account-create-fields">
        <input type="hidden" name="expectedResourceVersion" value={resourceVersion} />
        <label>平台<select name="platform" required defaultValue=""><option value="" disabled>请选择</option><option value="facebook">Facebook</option><option value="youtube">YouTube</option></select></label>
        <label>识别名称（可选）<input name="displayName" maxLength={100} /></label>
        <label>登录账号<input name="loginIdentifier" autoComplete="username" required /></label>
        <label>密码<input name="password" type="password" autoComplete="new-password" required /></label>
        <details className="optional-persona"><summary>可选：真实个人资料（帮助识别）</summary><div><label>真实姓名<input name="personName" autoComplete="name" /></label><label>生日<input name="birthday" type="date" /></label><label>性别<select name="gender" defaultValue=""><option value="">不填写</option><option value="female">女</option><option value="male">男</option><option value="unspecified">其他／不透露</option></select></label></div></details>
        </fieldset><button type="submit" disabled={busy || Boolean(pendingKey)}>{busy ? "保存中…" : "保存账号"}</button>
      </form>}
      {pendingKey && <div className="info-note" role="group" aria-label="未知操作恢复"><span>原操作结果未知。先查询原请求键，再决定是否用同一请求继续。</span><code>{pendingKey}</code><button type="button" disabled={busy} onClick={() => void queryPending()}>查询原操作</button>{pending.current?.send && <button type="button" disabled={busy} onClick={() => void retryPending()}>继续原请求</button>}</div>}
    </section>
    <section className="panel" aria-labelledby="media-account-list-title"><div className="section-heading"><div><h2 id="media-account-list-title">账号与凭据状态</h2><p className="muted">密码不会再次显示。保存凭据不代表平台验证成功。</p></div><button type="button" className="outline-button" disabled={busy} onClick={() => void refresh()}>刷新</button></div>
      {accounts.length ? <div className="media-account-list">{accounts.map(account => <article className="media-account-card" key={account.accountId}>
        <div><h3>{account.displayName}</h3><p>{account.platform} · <code>{account.loginIdentifier ?? "历史档案待补登录标识"}</code></p><small>平台账号ID：{account.canonicalAccountRef ?? "未核验"}</small>{account.legacyDeclaredCanonicalAccountRef && <small>历史声明ID：{account.legacyDeclaredCanonicalAccountRef}（未核验，不用于身份判断）</small>}</div>
        <div><span>分配：{account.reservation ? `已占用（${account.reservation.projectId.slice(0, 8)}）` : "未分配"}</span><span>凭据：{account.credential?.state === "stored_unverified" ? "已保存，未核验" : account.credential?.state === "invalidated" ? "已失效" : "无凭据"}</span><span>父账号登录核验：{account.parentLoginVerification === "verified" ? "已核验" : account.parentLoginVerification === "blocked" ? "阻断" : "未核验"}</span>{account.publishingIdentities.map(identity => <span key={identity.identityId}>发布身份：{identity.verificationState === "verified" ? "已核验" : identity.verificationState === "blocked" ? "阻断" : "未核验"} · 管理状态 {identity.managementState === "managed" ? "已确认" : identity.managementState === "not_managed" ? "未管理" : "未知"}</span>)}</div>
        {!readOnly && <div className="profile-actions">{profileAccount === account.accountId ? <form onSubmit={e => void submitProfile(e, account)}>
          <label>识别名称<input aria-label={`更正 ${account.loginIdentifier ?? account.accountId} 的识别名称`} name="displayName" maxLength={200} defaultValue={account.displayName} required disabled={busy || Boolean(pendingKey)} /></label>
          <details className="optional-persona" open><summary>可选：真实个人资料（清空即移除）</summary><div>
            <label>真实姓名<input aria-label={`更正 ${account.loginIdentifier ?? account.accountId} 的真实姓名`} name="personName" autoComplete="name" defaultValue={account.persona?.name ?? ""} disabled={busy || Boolean(pendingKey)} /></label>
            <label>生日<input aria-label={`更正 ${account.loginIdentifier ?? account.accountId} 的生日`} name="birthday" type="date" defaultValue={account.persona?.birthday ?? ""} disabled={busy || Boolean(pendingKey)} /></label>
            <label>性别<select aria-label={`更正 ${account.loginIdentifier ?? account.accountId} 的性别`} name="gender" defaultValue={account.persona?.gender ?? ""} disabled={busy || Boolean(pendingKey)}><option value="">不填写</option><option value="female">女</option><option value="male">男</option><option value="unspecified">其他／不透露</option></select></label>
          </div></details>
          <button type="submit" disabled={busy || Boolean(pendingKey)}>保存资料修改</button><button type="button" disabled={busy} onClick={() => setProfileAccount("")}>取消</button>
        </form> : <button type="button" disabled={busy || Boolean(pendingKey)} onClick={() => setProfileAccount(account.accountId)}>编辑识别资料</button>}</div>}
        {!readOnly && <div className="credential-actions">{secretAccount === account.accountId ? <><label>登录标识<input aria-label={`登录标识 ${account.displayName}`} autoComplete="username" defaultValue={account.loginIdentifier ?? ""} required disabled={busy || Boolean(pendingKey)} /></label><label>密码<input aria-label={`替换 ${account.displayName} 的密码`} type="password" autoComplete="new-password" required disabled={busy || Boolean(pendingKey)} /></label><button type="button" disabled={busy || Boolean(pendingKey)} onClick={e => { const inputs=e.currentTarget.parentElement?.querySelectorAll("input") ?? []; const login=inputs[0]?.value.trim() ?? "", password=inputs[1]?.value ?? ""; if (login && password) void credentialAction(account,"put",login,password); }}>保存凭据</button><button type="button" disabled={busy || Boolean(pendingKey)} onClick={() => setSecretAccount("")}>取消</button></> : <button type="button" disabled={busy || Boolean(pendingKey)} onClick={() => setSecretAccount(account.accountId)}>{account.credential ? "替换凭据" : account.loginIdentifier ? "保存凭据" : "补录登录标识与凭据"}</button>}{account.credential && <button type="button" disabled={busy || Boolean(pendingKey)} onClick={() => void credentialAction(account,"invalidate")}>使凭据失效</button>}</div>}
      </article>)}</div> : <div className="empty-state"><h3>尚无媒体平台账号</h3><p>先录入实际已有的平台账号；不要填写虚构的平台账号 ID。</p></div>}
    </section>
    <section className="panel" aria-labelledby="account-assignment-title"><div className="section-heading"><div><h2 id="account-assignment-title">项目账号与手机分配</h2><p className="muted">选择不会自动绑定。提交后服务端持久占用并检查唯一性。</p></div></div>
      <label>项目<select aria-label="筹备项目" value={projectId} onChange={e => setProjectId(e.target.value)}><option value="">选择项目</option>{projects.map(p => <option key={p.projectId} value={p.projectId}>{p.name}（筹备中）</option>)}</select></label>
      {projectId && <>{assignment?.assignments.length ? <p className="info-note">本项目已占用：{assignment.assignments.map(a => `${a.platform} · ${a.accountId.slice(0,8)} → ${a.deviceId.slice(0,8)}`).join("；")}</p> : <p>本项目尚无账号与手机分配。</p>}
        {assignment && assignment.eligibleDevices.length === 0 ? <p className="info-note">当前没有可分配手机。需要先通过产品支持的真实设备接入流程建立资源；此处不会创建或伪造手机记录。</p> : assignment && !readOnly && <form onSubmit={e => void assign(e)}>
          <label>可用手机<select name="deviceId" required><option value="">选择实际可用手机</option>{assignment.eligibleDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.deviceId} · {d.state}</option>)}</select></label>
          <fieldset><legend>选择媒体账号（最多 2 个）</legend>{accounts.filter(a => !a.reservation).map(a => <label key={a.accountId}><input type="checkbox" name="accountId" value={a.accountId} />{a.displayName} · {a.platform}</label>)}</fieldset>
          <button disabled={busy || Boolean(pendingKey)} type="submit">确认分配</button>
        </form>}
      </>}
      <p className="form-note">注册、凭据保存或分配均不代表真实登录、身份核验、运行时就绪或允许发布。</p>
    </section>
  </div>;
}
