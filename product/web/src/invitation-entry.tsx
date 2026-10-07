import { useState, type FormEvent } from "react";
import { Copy, DownloadSimple, DeviceMobile } from "@phosphor-icons/react";
import "./invitation-entry.css";

function invitationCode(value: string): string | null {
  const text = value.trim();
  if (/^[A-Za-z0-9_-]{43}$/.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.origin !== window.location.origin || url.pathname !== "/register" || url.hash || url.username || url.password || [...url.searchParams].length !== 1) return null;
    const codes = url.searchParams.getAll("invitation");
    return codes.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(codes[0] ?? "") ? codes[0]! : null;
  } catch { return null; }
}

export function InvitationEntry() {
  const initial = invitationCode(window.location.href);
  const [code, setCode] = useState(initial);
  const [input, setInput] = useState("");
  const [message, setMessage] = useState("");
  const [copying, setCopying] = useState(false);
  const deepLink = code ? `socialgrowth://provider/register?invitation=${encodeURIComponent(code)}` : null;
  function useInvitation(event: FormEvent) {
    event.preventDefault();
    const next = invitationCode(input);
    if (!next) { setMessage("邀请码或链接格式不正确，请复制运营发给你的完整内容。"); return; }
    setCode(next); setInput(""); setMessage("");
  }
  async function copy() {
    if (!code || copying) return;
    setCopying(true);
    try { await navigator.clipboard.writeText(code); setMessage("邀请码已复制，安装后在 App 中选择“受邀加入”并粘贴。"); }
    catch { setMessage("未能复制，请长按下方邀请码手动复制。"); }
    finally { setCopying(false); }
  }
  return <main className="invitation-entry">
    <div className="invitation-brand">SocialGrowth</div>
    <section className="invitation-content" aria-labelledby="invitation-title">
      <h1 id="invitation-title">受邀加入</h1>
      <p className="invitation-description">在 Android App 中完成手机号验证，管理你的设备。</p>
      {code ? <>
        <a className="invitation-primary" href={deepLink!}><DeviceMobile size={22} aria-hidden />打开 Android App</a>
        <p className="invitation-help">已安装 App：点击打开，邀请信息会一同带入。未能打开时，可在 App 中选择“受邀加入”并粘贴邀请码。</p>
        <div className="invitation-code-section">
          <label htmlFor="invitation-code">邀请码</label>
          <input id="invitation-code" value={code} readOnly spellCheck={false} />
          <button type="button" className="invitation-copy" onClick={() => void copy()} disabled={copying}><Copy size={18} aria-hidden />{copying ? "正在复制…" : "复制邀请码"}</button>
        </div>
      </> : <form onSubmit={useInvitation} className="invitation-input-form">
        <label htmlFor="invitation-input">邀请码或邀请链接</label>
        <textarea id="invitation-input" value={input} onChange={event => { setInput(event.target.value); setMessage(""); }} autoComplete="off" spellCheck={false} placeholder="粘贴运营发给你的完整内容" required />
        <button type="submit" className="invitation-primary">使用邀请</button>
      </form>}
      <p className="invitation-feedback" role="status" aria-live="polite">{message}</p>
      <div className="invitation-download">
        <h2>还没安装 App？</h2>
        <p>先复制邀请码，再下载并安装。安装后选择“受邀加入”，粘贴邀请码即可继续。</p>
        <a href="/downloads/socialgrowth.apk" className="invitation-secondary" download><DownloadSimple size={20} aria-hidden />下载 Android APK</a>
      </div>
      <p className="invitation-boundary">邀请的有效期和名额将在注册时核验。注册不会自动关联本机或开始执行任务。</p>
    </section>
  </main>;
}
