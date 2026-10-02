'use client';
import React, { useState } from 'react';
import { runtimeRequest } from '@/lib/operations-context';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from './status-badge';
import { Panel, Notice } from './shared';

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
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

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
    <Panel title="Agent 任务协作与执行边界">
      <Notice>
        人工回复不等于完成。Agent
        领取回复后只能重新观察，核验后才继续；审批回复不会自动扩展发布、切号或创建账号权限。普通回复禁止填写密码、验证码或密钥，请使用专用安全输入待办。
      </Notice>
      {error && <p role="alert" className="op-error">{error}</p>}
      
      {(value?.controls ?? []).slice(0, 10).map((c) => (
        <div key={c.sessionId} className="op-record">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h4 className="font-semibold text-sm">任务 {c.taskId}</h4>
            <StatusBadge status={c.state === 'running' ? 'online' : 'warning'}>
              {c.state} {c.reason ?? ''}
            </StatusBadge>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            策略 {c.policy.version} ·{' '}
            {c.policy.mode === 'observe'
              ? '只读观察，禁止操作设备'
              : c.policy.mode === 'client_test'
                ? '自有客户端参与与撤回测试，禁止登录、安装和发布'
              : c.policy.mode === 'onboarding'
                ? '账号接入，仅允许本次已确认的核验或创建，不发布内容'
                : '发布前诊断，禁止公开发布'}{' '}
            · 恢复上限 {c.policy.maxRecovery} · 密码请求 {c.passwordAttempts} ·
            验证码请求 {c.otpAttempts} · 受控登录提交 {c.loginSubmits}
          </p>
        </div>
      ))}

      {(value?.requests ?? []).map((r) => (
        <div key={r.id} data-agent-request-id={r.id} className="op-record">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h4 className="font-semibold text-sm">
              {r.kind} · {r.reason}
            </h4>
            <StatusBadge
              status={
                r.status === 'waiting'
                  ? 'warning'
                  : r.status === 'completed'
                    ? 'online'
                    : 'neutral'
              }
            >
              {r.status}
            </StatusBadge>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">
            任务：{r.taskId}；Artemis：{r.traceId}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">
            设备：{r.deviceId}；预期账号：{r.expectedIdentity}；截止：
            {r.expiresAt}
          </p>
          <p className="text-sm bg-slate-50 dark:bg-slate-900/50 p-2 rounded border border-slate-200 dark:border-slate-800 mb-2">
            {r.message}
          </p>
          <div className="mb-2">
            <a
              href={`/api/runtime/supervision/screenshot?id=${encodeURIComponent(r.id)}`}
              target="_blank"
              rel="noreferrer"
              className="op-link text-xs"
            >
              查看协助截图
            </a>
          </div>
          {r.response && (
            <p className="text-xs text-slate-500 italic mb-2">
              人工回复：{r.response.text}（尚不能据此证明任务成功）
            </p>
          )}
          {r.status === 'waiting' && (
            <form
              className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800"
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
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  处理说明／资料（禁止凭证）
                </label>
                <Textarea
                  name="response"
                  aria-label="处理说明／资料（禁止凭证）"
                  required
                  maxLength={4000}
                  className="w-full text-xs"
                />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id={`confirm-${r.id}`} required className="rounded border-slate-300" />
                <label htmlFor={`confirm-${r.id}`} className="text-xs text-slate-600 dark:text-slate-400">
                  我已核对设备、账号及截图，仅回复本次协助
                </label>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button
                  disabled={busy !== null}
                  type="submit"
                  className="op-button text-xs"
                >
                  {busy === r.id ? '提交中…' : '提交回复并等待 Agent 核验'}
                </Button>
                <Button
                  disabled={busy !== null}
                  type="button"
                  variant="outline"
                  onClick={() =>
                    void respond(r.id, r.expectedIdentity, 'cancel', '')
                  }
                  className="text-xs"
                >
                  取消并停止任务动作
                </Button>
              </div>
            </form>
          )}
        </div>
      ))}
    </Panel>
  );
}
