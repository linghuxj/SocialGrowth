import { type FormEvent, useEffect, useRef, useState } from "react";
import type { CreateInvitationResponse, InvitationView, OperatorView } from "@socialgrowth/product-contracts";
import {
  ArrowClockwise, Check, Copy, DeviceMobile, Folder, House, Link, Plus,
  ShieldCheck, SignOut, UserCircle, UsersThree, X,
} from "@phosphor-icons/react";
import {
  ProductApiError, createInvitation, createOperator, disableOperator, hasCsrfToken,
  listInvitations, listOperators, login, logout, newIdempotencyKey, revokeInvitation,
} from "./operator-api.js";

export const productEnvironment = "product" as const;
type WorkspaceView = "accounts" | "invitations";

function errorMessage(error: unknown): string {
  if (error instanceof ProductApiError) {
    const messages: Record<string, string> = {
      INVALID_CREDENTIALS: "登录名或密码不正确", LOGIN_RATE_LIMITED: "尝试次数过多，请稍后再试",
      OPERATOR_ALREADY_EXISTS: "该登录名已存在", OPERATOR_DISABLED: "该运营账号已停用",
      LAST_ACTIVE_OPERATOR: "必须至少保留一个有效运营账号", FACT_VERSION_STALE: "邀请或账号状态已变化，请刷新后重试",
      AUTHENTICATION_REQUIRED: "登录已失效，请重新登录", INVITATION_REVOKED: "邀请已经撤销",
      IDEMPOTENCY_RESULT_EXPIRED: "原操作结果已不可恢复，请刷新后重新操作",
      IDEMPOTENCY_KEY_REUSED: "操作仍在处理中或请求内容已变化，请稍后重试",
      INPUT_INVALID: "提交内容不符合要求", INTERNAL_ERROR: "服务暂时不可用，请稍后重试",
    };
    return messages[error.response.error.code] ?? error.response.error.message;
  }
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}

function localInputValue(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function defaultExpiry(): string { return localInputValue(new Date(Date.now() + 7 * 86_400_000)); }
function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
function statusLabel(status: InvitationView["status"]): string {
  return { active: "有效", expired: "已过期", exhausted: "名额已用完", revoked: "已撤销" }[status];
}
function invitationLink(code: string): string {
  const url = new URL("/register", window.location.origin);
  url.searchParams.set("invitation", code);
  return url.toString();
}

export function App() {
  const [operators, setOperators] = useState<OperatorView[] | null>(null);
  const [invitations, setInvitations] = useState<InvitationView[] | null>(null);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [view, setView] = useState<WorkspaceView>("invitations");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [maxUses, setMaxUses] = useState("5");
  const [expiresAt, setExpiresAt] = useState(defaultExpiry);
  const [createdAccess, setCreatedAccess] = useState<CreateInvitationResponse | null>(null);
  const createOperatorKey = useRef<string | null>(null);
  const disableKey = useRef<{ operation: string; key: string } | null>(null);
  const createInvitationKey = useRef<string | null>(null);
  const revokeKey = useRef<{ operation: string; key: string } | null>(null);

  function clearPendingOperations(): void {
    createOperatorKey.current = null; disableKey.current = null;
    createInvitationKey.current = null; revokeKey.current = null;
  }
  function handleFailure(error: unknown): void {
    if (error instanceof ProductApiError && error.status === 401) {
      clearPendingOperations(); setOperators(null); setInvitations(null);
      setCreatedAccess(null); setAuthenticated(false);
    }
    setMessage(errorMessage(error));
  }
  async function refresh(): Promise<void> {
    try {
      const [nextOperators, nextInvitations] = await Promise.all([listOperators(), listInvitations()]);
      if (!hasCsrfToken()) {
        setOperators(null); setInvitations(null); setAuthenticated(false);
        setMessage("请重新登录以恢复安全操作凭据"); return;
      }
      setOperators(nextOperators); setInvitations(nextInvitations); setAuthenticated(true);
    } catch (error) {
      setOperators(null); setInvitations(null); setAuthenticated(false);
      if (!(error instanceof ProductApiError && error.status === 401)) setMessage(errorMessage(error));
    }
  }
  useEffect(() => { void refresh(); }, []);

  async function onLogin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    setBusy(true); setMessage("");
    try {
      await login(String(form.get("loginName") ?? ""), String(form.get("password") ?? ""));
      clearPendingOperations(); formElement.reset(); await refresh();
    } catch (error) { handleFailure(error); } finally { setBusy(false); }
  }
  async function onCreateOperator(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    setBusy(true); setMessage("");
    try {
      createOperatorKey.current ??= newIdempotencyKey();
      await createOperator({ loginName: String(form.get("loginName") ?? ""), displayName: String(form.get("displayName") ?? ""), initialPassword: String(form.get("initialPassword") ?? "") }, createOperatorKey.current);
      createOperatorKey.current = null; formElement.reset(); await refresh(); setMessage("运营账号已开通");
    } catch (error) { handleFailure(error); } finally { setBusy(false); }
  }
  async function onDisable(operator: OperatorView): Promise<void> {
    if (!window.confirm(`确认停用 ${operator.displayName}？该账号的会话将立即失效。`)) return;
    setBusy(true); setMessage("");
    try {
      const operation = `${operator.operatorId}:${operator.factVersion}`;
      if (disableKey.current?.operation !== operation) disableKey.current = { operation, key: newIdempotencyKey() };
      await disableOperator(operator, disableKey.current.key); disableKey.current = null;
      await refresh(); setMessage("账号已停用，会话已撤销");
    } catch (error) { handleFailure(error); } finally { setBusy(false); }
  }
  async function onCreateInvitation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      createInvitationKey.current ??= newIdempotencyKey();
      const response = await createInvitation({ maxUses: Number(maxUses), expiresAt: new Date(expiresAt).toISOString() }, createInvitationKey.current);
      createInvitationKey.current = null; setCreatedAccess(response); setMaxUses("5"); setExpiresAt(defaultExpiry());
      await refresh(); setMessage("邀请已创建。请现在复制共享码或链接；关闭后将不再显示。");
    } catch (error) { handleFailure(error); } finally { setBusy(false); }
  }
  async function onRevoke(invitation: InvitationView): Promise<void> {
    if (!window.confirm("撤销后将阻止新的注册，但不会取消已有提供者或设备。确认撤销？")) return;
    setBusy(true); setMessage("");
    try {
      const operation = `${invitation.invitationId}:${invitation.factVersion}`;
      if (revokeKey.current?.operation !== operation) revokeKey.current = { operation, key: newIdempotencyKey() };
      await revokeInvitation(invitation, revokeKey.current.key); revokeKey.current = null;
      await refresh(); setMessage("邀请已撤销，已有注册与设备不受影响");
    } catch (error) { handleFailure(error); } finally { setBusy(false); }
  }
  async function copyText(value: string, label: string): Promise<void> {
    try { await navigator.clipboard.writeText(value); setMessage(`${label}已复制；复制不代表已发送或已注册。`); }
    catch { setMessage(`无法自动复制${label}，请手动选择文本。`); }
  }
  async function onLogout(): Promise<void> {
    setBusy(true);
    try {
      await logout(); clearPendingOperations(); setAuthenticated(false); setOperators(null);
      setInvitations(null); setCreatedAccess(null);
    } catch (error) { handleFailure(error); } finally { setBusy(false); }
  }

  if (authenticated === null) return <main className="auth-shell"><p role="status">正在验证运营身份…</p></main>;
  if (!authenticated) return <main className="auth-shell"><section className="login-card" aria-labelledby="login-title">
    <p className="brand">SocialGrowth</p><p className="eyebrow">运营工作台</p><h1 id="login-title">登录正式产品</h1>
    <p className="muted">使用部署方开通的独立运营账号。系统不提供公众注册。</p>
    <form onSubmit={(event) => void onLogin(event)}><label>登录名<input name="loginName" autoComplete="username" required /></label><label>密码<input name="password" type="password" autoComplete="current-password" minLength={12} required /></label><button disabled={busy} type="submit">{busy ? "登录中…" : "登录"}</button></form>
    {message && <p className="feedback" role="alert">{message}</p>}<p className="environment">环境：{productEnvironment}</p>
  </section></main>;

  const activeInvitations = invitations?.filter(({ status }) => status === "active") ?? [];
  const remainingUses = activeInvitations.reduce((total, invitation) => total + invitation.maxUses - invitation.consumedUses, 0);

  return <div className="app-shell">
    <aside className="sidebar" aria-label="主导航"><p className="brand">SocialGrowth</p><nav>
      <button className="nav-item unavailable" disabled><House size={21} />工作台<span>后续</span></button>
      <button className="nav-item unavailable" disabled><Folder size={21} />项目<span>后续</span></button>
      <button className={`nav-item ${view === "accounts" ? "selected" : ""}`} onClick={() => setView("accounts")}><DeviceMobile size={21} />账号与设备</button>
      <button className={`nav-item ${view === "invitations" ? "selected" : ""}`} onClick={() => setView("invitations")}><UsersThree size={21} />提供者与分佣</button>
    </nav><div className="sidebar-footer"><div className="operator-chip"><UserCircle size={28} /><div><strong>运营账号</strong><span>正式产品</span></div></div><button className="logout-button" disabled={busy} onClick={() => void onLogout()}><SignOut size={19} />退出登录</button></div></aside>

    <main className="content-canvas"><header className="page-header"><div><p className="breadcrumb">提供者与分佣 / {view === "invitations" ? "邀请与接入" : "运营账号"}</p><h1>{view === "invitations" ? "邀请与接入" : "运营账号管理"}</h1><p className="page-description">{view === "invitations" ? "创建可供多人使用的邀请，并查看成功注册与设备接入进展。" : "开通或停用同权运营账号，停用不会删除业务历史。"}</p></div><button className="outline-button" disabled={busy} onClick={() => void refresh()}><ArrowClockwise size={18} />刷新</button></header>
      {message && <p className="feedback workspace-feedback" role="status">{message}</p>}
      {view === "invitations" ? <>
        <section className="summary-strip" aria-label="邀请摘要"><div><ShieldCheck size={24} /><span>有效邀请</span><strong>{activeInvitations.length}</strong></div><div><UsersThree size={24} /><span>可用注册名额</span><strong>{remainingUses}</strong></div><p>打开或复制邀请不会消耗名额；只有新提供者成功注册才扣减。</p></section>
        {createdAccess && <section className="access-panel" aria-labelledby="access-title"><div className="access-heading"><div><span className="success-icon"><Check size={18} weight="bold" /></span><div><h2 id="access-title">邀请已创建</h2><p>这是共享码唯一展示窗口。复制不代表已发送。</p></div></div><button className="icon-button" aria-label="关闭邀请凭证" onClick={() => setCreatedAccess(null)}><X size={19} /></button></div><div className="access-grid"><label>共享码<div className="copy-field"><input readOnly value={createdAccess.access.code} /><button type="button" onClick={() => void copyText(createdAccess.access.code, "共享码")}><Copy size={17} />复制</button></div></label><label>注册链接<div className="copy-field"><input readOnly value={invitationLink(createdAccess.access.code)} /><button type="button" onClick={() => void copyText(invitationLink(createdAccess.access.code), "注册链接")}><Link size={17} />复制</button></div></label></div></section>}
        <section className="panel create-invitation" aria-labelledby="create-invitation-title"><div className="section-heading"><div><h2 id="create-invitation-title">创建多人邀请</h2><p className="muted">共享码与链接共用次数上限和有效期，不预绑定手机号。</p></div><Plus size={24} /></div><form className="invitation-form" onSubmit={(event) => void onCreateInvitation(event)}><label>成功注册次数上限<input type="number" min="1" max="10000" value={maxUses} onChange={(event) => { setMaxUses(event.target.value); createInvitationKey.current = null; }} required /></label><label>有效至<input type="datetime-local" min={localInputValue(new Date())} value={expiresAt} onChange={(event) => { setExpiresAt(event.target.value); createInvitationKey.current = null; }} required /></label><button disabled={busy} type="submit"><Plus size={18} />{busy ? "处理中…" : "创建邀请"}</button></form><p className="form-note">撤销、过期或名额用完只阻止后续注册，不取消已有身份或设备。</p></section>
        <section className="panel invitation-list" aria-labelledby="invitation-list-title"><div className="section-heading"><div><h2 id="invitation-list-title">邀请及注册进展</h2><p className="muted">按创建时间显示，展开可查看全部成功注册提供者。</p></div><span className="count-label">{invitations?.length ?? 0} 份邀请</span></div>
          {invitations?.length ? <div className="table-wrap"><table><thead><tr><th>状态</th><th>注册名额</th><th>有效期</th><th>成功注册</th><th>设备进展</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>{invitations.map((invitation) => { const remaining = invitation.maxUses - invitation.consumedUses; const devices = invitation.registrations.reduce((total, item) => total + item.associatedDeviceCount, 0); return <tr key={invitation.invitationId}><td><span className={`status ${invitation.status}`}>{statusLabel(invitation.status)}</span><small className="record-id">{invitation.invitationId.slice(0, 8)}</small></td><td><strong>{invitation.consumedUses} / {invitation.maxUses}</strong><small>剩余 {remaining}</small></td><td>{formatTime(invitation.expiresAt)}<small>创建于 {formatTime(invitation.createdAt)}</small></td><td><details><summary>{invitation.registrations.length} 位提供者</summary><div className="registration-popover">{invitation.registrations.length ? invitation.registrations.map((registration) => <div key={registration.providerId}><strong>{registration.displayName}</strong><span>{formatTime(registration.registeredAt)} · {registration.associatedDeviceCount} 台设备</span></div>) : <p>尚无成功注册</p>}</div></details></td><td>{devices} 台<small>{invitation.registrations.length ? "已关联设备合计" : "等待成功注册"}</small></td><td><button className="text-button danger-text" disabled={busy || invitation.status === "revoked"} onClick={() => void onRevoke(invitation)}>{invitation.status === "revoked" ? "已撤销" : "撤销"}</button></td></tr>; })}</tbody></table></div> : <div className="empty-state"><UsersThree size={34} /><h3>尚无邀请</h3><p>创建第一份多人邀请后，注册与设备进展会显示在这里。</p></div>}
          <div className="info-note"><ShieldCheck size={18} /><span>列表不再显示共享码。需要重新发放时请创建新邀请，不要从数据库或审计记录恢复秘密。</span></div>
        </section>
      </> : <>
        <section className="panel" aria-labelledby="create-operator-title"><div><h2 id="create-operator-title">开通运营账号</h2><p className="muted">所有运营账号同权。初始密码不少于 12 个字符。</p></div><form className="create-grid" onChange={() => { createOperatorKey.current = null; }} onSubmit={(event) => void onCreateOperator(event)}><label>登录名<input name="loginName" placeholder="operator.name" pattern={"[a-z][a-z0-9._\\-]{2,63}"} required /></label><label>显示名<input name="displayName" maxLength={100} required /></label><label>初始密码<input name="initialPassword" type="password" minLength={12} autoComplete="new-password" required /></label><button disabled={busy} type="submit">开通账号</button></form></section>
        <section className="panel" aria-labelledby="operator-list-title"><div className="section-heading"><div><h2 id="operator-list-title">现有运营账号</h2><p className="muted">停用不会删除历史、项目或设备事实。</p></div><span className="count-label">{operators?.length ?? 0} 个账号</span></div><div className="table-wrap"><table><thead><tr><th>运营人员</th><th>登录名</th><th>状态</th><th>更新时间</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>{operators?.map((operator) => <tr key={operator.operatorId}><td>{operator.displayName}</td><td><code>{operator.loginName}</code></td><td><span className={`status ${operator.status}`}>{operator.status === "active" ? "有效" : "已停用"}</span></td><td>{formatTime(operator.updatedAt)}</td><td><button className="text-button danger-text" disabled={busy || operator.status === "disabled"} onClick={() => void onDisable(operator)}>{operator.status === "disabled" ? "已停用" : "停用"}</button></td></tr>)}</tbody></table></div></section>
      </>}
    </main>
  </div>;
}
