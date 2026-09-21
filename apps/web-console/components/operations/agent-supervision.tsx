'use client';
import React, { useState } from 'react';
import { runtimeRequest } from '@/lib/operations-context';

export type SupervisionStatus = {
  controls: {
    sessionId: string;
    taskId: string;
    state: string;
    reason?: string;
    policy: { version: string; mode: string; maxRecovery: number };
    passwordAttempts: number;
    otpAttempts: number;
    loginSubmits: number;
  }[];
  requests: {
    id: string;
    taskId: string;
    traceId: string;
    deviceId: string;
    expectedIdentity: string;
    kind: string;
    reason: string;
    message: string;
    status: string;
    expiresAt: string;
    response?: { decision: string; text: string };
  }[];
  events: {
    id: string;
    taskId: string;
    at: string;
    type: string;
    code: string;
  }[];
};
export function AgentSupervision({
  value,
  reload,
}: {
  value?: SupervisionStatus;
  reload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState('');
  const respond = async (
    id: string,
    expectedIdentity: string,
    decision: string,
    text: string,
  ) => {
    if (busy) return;
    setBusy(id);
    setError('');
    try {
      await runtimeRequest('/supervision/respond', {
        id,
        expectedIdentity,
        confirmed: true,
        decision,
        text,
      });
    } catch {
      setError(
        '回复未确认，可能已过期或已被处理。请核对状态，不要重复操作设备。',
      );
    } finally {
      setBusy(null);
      await reload();
    }
  };
  return (
    <section aria-label="Agent 任务协作">
      <h3>Agent 任务协作与执行边界</h3>
      <p>
        人工回复不等于完成。Agent
        领取回复后只能重新观察，核验后才继续；审批回复不会自动扩展发布、切号或创建账号权限。普通回复禁止填写密码、验证码或密钥，请使用专用安全输入待办。
      </p>
      {error && <p role="alert">{error}</p>}
      {(value?.controls ?? []).slice(0, 10).map((c) => (
        <article key={c.sessionId}>
          <p>
            任务 {c.taskId}：{c.state} {c.reason ?? ''}
          </p>
          <p>
            策略 {c.policy.version} ·{' '}
            {c.policy.mode === 'observe'
              ? '只读观察，禁止操作设备'
              : c.policy.mode === 'onboarding'
                ? '账号接入，仅允许本次已确认的核验或创建，不发布内容'
                : '发布前诊断，禁止公开发布'}{' '}
            · 恢复上限 {c.policy.maxRecovery} · 密码请求 {c.passwordAttempts} ·
            验证码请求 {c.otpAttempts} · 受控登录提交 {c.loginSubmits}
          </p>
        </article>
      ))}
      {(value?.requests ?? []).map((r) => (
        <article key={r.id} data-agent-request-id={r.id}>
          <h4>
            {r.kind} · {r.reason} · {r.status}
          </h4>
          <p>
            任务：{r.taskId}；Artemis：{r.traceId}
          </p>
          <p>
            设备：{r.deviceId}；预期账号：{r.expectedIdentity}；截止：
            {r.expiresAt}
          </p>
          <p>{r.message}</p>
          <a
            href={`/api/runtime/supervision/screenshot?id=${encodeURIComponent(r.id)}`}
            target="_blank"
            rel="noreferrer"
          >
            查看协助截图
          </a>
          {r.response && (
            <p>人工回复：{r.response.text}（尚不能据此证明任务成功）</p>
          )}
          {r.status === 'waiting' && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                const response = form.get('response');
                await respond(
                  r.id,
                  r.expectedIdentity,
                  r.kind === 'approval'
                    ? 'approved'
                    : r.kind === 'manual'
                      ? 'completed'
                      : 'provided',
                  typeof response === 'string' ? response : '',
                );
              }}
            >
              <label>
                处理说明／资料（禁止凭证）
                <textarea
                  name="response"
                  aria-label="处理说明／资料（禁止凭证）"
                  required
                  maxLength={4000}
                />
              </label>
              <label>
                <input type="checkbox" required />
                我已核对设备、账号及截图，仅回复本次协助
              </label>
              <button disabled={busy !== null} type="submit">
                提交回复并等待 Agent 核验
              </button>
              <button
                disabled={busy !== null}
                type="button"
                onClick={() =>
                  void respond(r.id, r.expectedIdentity, 'cancel', '')
                }
              >
                取消并停止任务动作
              </button>
            </form>
          )}
        </article>
      ))}
    </section>
  );
}
