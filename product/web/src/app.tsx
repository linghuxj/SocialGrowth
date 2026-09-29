import { type FormEvent, useEffect, useState } from "react";
import type { OperatorView } from "@socialgrowth/product-contracts";
import { ProductApiError, createOperator, disableOperator, listOperators, login, logout } from "./operator-api.js";

export const productEnvironment = "product" as const;

function errorMessage(error: unknown): string {
  if (error instanceof ProductApiError) {
    const messages: Record<string, string> = {
      INVALID_CREDENTIALS: "登录名或密码不正确",
      LOGIN_RATE_LIMITED: "尝试次数过多，请稍后再试",
      OPERATOR_ALREADY_EXISTS: "该登录名已存在",
      LAST_ACTIVE_OPERATOR: "必须至少保留一个有效运营账号",
      FACT_VERSION_STALE: "账号状态已变化，请刷新后重试",
      AUTHENTICATION_REQUIRED: "登录已失效，请重新登录",
      INPUT_INVALID: "提交内容不符合要求",
    };
    return messages[error.response.error.code] ?? error.response.error.message;
  }
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}

export function App() {
  const [operators, setOperators] = useState<OperatorView[] | null>(null);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh(): Promise<void> {
    try {
      setOperators(await listOperators());
      setAuthenticated(true);
    } catch (error) {
      setOperators(null);
      setAuthenticated(false);
      if (!(error instanceof ProductApiError && error.status === 401)) setMessage(errorMessage(error));
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function onLogin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true); setMessage("");
    try {
      await login(String(form.get("loginName") ?? ""), String(form.get("password") ?? ""));
      formElement.reset();
      await refresh();
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function onCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true); setMessage("");
    try {
      await createOperator({
        loginName: String(form.get("loginName") ?? ""),
        displayName: String(form.get("displayName") ?? ""),
        initialPassword: String(form.get("initialPassword") ?? ""),
      });
      formElement.reset();
      await refresh();
      setMessage("运营账号已开通");
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function onDisable(operator: OperatorView): Promise<void> {
    if (!window.confirm(`确认停用 ${operator.displayName}？该账号的会话将立即失效。`)) return;
    setBusy(true); setMessage("");
    try {
      await disableOperator(operator);
      await refresh();
      setMessage("账号已停用，会话已撤销");
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function onLogout(): Promise<void> {
    setBusy(true);
    try {
      await logout();
      setAuthenticated(false);
      setOperators(null);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (authenticated === null) return <main className="auth-shell"><p role="status">正在验证运营身份…</p></main>;

  if (!authenticated) return (
    <main className="auth-shell">
      <section className="login-card" aria-labelledby="login-title">
        <p className="eyebrow">SocialGrowth · 运营工作台</p>
        <h1 id="login-title">登录正式产品</h1>
        <p className="muted">使用部署方开通的独立运营账号。系统不提供公众注册。</p>
        <form onSubmit={(event) => void onLogin(event)}>
          <label>登录名<input name="loginName" autoComplete="username" required /></label>
          <label>密码<input name="password" type="password" autoComplete="current-password" minLength={12} required /></label>
          <button disabled={busy} type="submit">{busy ? "登录中…" : "登录"}</button>
        </form>
        {message && <p className="feedback" role="alert">{message}</p>}
        <p className="environment">环境：{productEnvironment}</p>
      </section>
    </main>
  );

  return (
    <main className="workspace">
      <header className="topbar">
        <div><p className="eyebrow">SocialGrowth</p><h1>运营账号管理</h1></div>
        <button className="secondary" disabled={busy} onClick={() => void onLogout()}>退出登录</button>
      </header>
      {message && <p className="feedback" role="status">{message}</p>}
      <section className="panel" aria-labelledby="create-title">
        <div><h2 id="create-title">开通运营账号</h2><p className="muted">所有运营账号同权。初始密码不少于 12 个字符。</p></div>
        <form className="create-grid" onSubmit={(event) => void onCreate(event)}>
          <label>登录名<input name="loginName" placeholder="operator.name" pattern="[a-z][a-z0-9._-]{2,63}" required /></label>
          <label>显示名<input name="displayName" maxLength={100} required /></label>
          <label>初始密码<input name="initialPassword" type="password" minLength={12} autoComplete="new-password" required /></label>
          <button disabled={busy} type="submit">开通账号</button>
        </form>
      </section>
      <section className="panel" aria-labelledby="list-title">
        <div className="section-heading"><div><h2 id="list-title">现有运营账号</h2><p className="muted">停用不会删除历史、项目或设备事实。</p></div><span>{operators?.length ?? 0} 个账号</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>运营人员</th><th>登录名</th><th>状态</th><th>更新时间</th><th><span className="sr-only">操作</span></th></tr></thead>
          <tbody>{operators?.map((operator) => <tr key={operator.operatorId}>
            <td>{operator.displayName}</td><td><code>{operator.loginName}</code></td>
            <td><span className={`status ${operator.status}`}>{operator.status === "active" ? "有效" : "已停用"}</span></td>
            <td>{new Date(operator.updatedAt).toLocaleString("zh-CN")}</td>
            <td><button className="danger" disabled={busy || operator.status === "disabled"} onClick={() => void onDisable(operator)}>{operator.status === "disabled" ? "已停用" : "停用"}</button></td>
          </tr>)}</tbody>
        </table></div>
      </section>
    </main>
  );
}
