'use client';
/* oxlint-disable next/no-img-element -- Private no-store screenshots must not pass through an image optimizer/cache. */
import React, { useEffect, useState } from 'react';
import { runtimeRequest } from '@/lib/operations-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from './status-badge';
import { Panel, Notice } from './shared';

export type HumanChallenge = {
  id: string;
  taskId: string;
  traceId: string;
  deviceId: string;
  expectedIdentity: string;
  expiresAt: string;
  status: string;
  mode: string;
  resultCode?: string;
  workflowResult?: string;
  kind?: 'password' | 'otp';
};

export function HumanAssistance({
  challenges,
  reload,
}: {
  challenges: HumanChallenge[];
  reload: () => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(tick);
    };
  }, []);

  return (
    <Panel title="人工登录协助">
      <Notice>
        Artemis
        在原任务内等待。请核对截图与预期账号；账号不符请取消并联系账号负责人重新分发，禁止试用其他账号。密码仅临时传递、不保存，仅支持可打印
        ASCII 字符。填入不代表登录成功。
      </Notice>
      {error && <p role="alert" className="op-error">{error}</p>}
      {!challenges.length && <p className="op-empty">暂无登录输入待办。</p>}
      
      {challenges.map((c) => (
        <div key={c.id} data-challenge-id={c.id} className="op-record">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h4 className="font-semibold text-sm">
              设备 {c.deviceId} · {c.expectedIdentity}
            </h4>
            <StatusBadge
              status={
                c.status === 'waiting'
                  ? 'warning'
                  : c.status === 'input_completed'
                    ? 'online'
                    : 'neutral'
              }
            >
              {c.status} {c.resultCode ?? ''}
            </StatusBadge>
          </div>
          
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">
            任务：{c.taskId}；Artemis：{c.traceId}；
            {c.mode === 'diagnostic' ? '诊断验收（无发布授权）' : '运营执行'}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">
            有效期至：{c.expiresAt}
          </p>
          
          {c.workflowResult && (
            <p className="text-xs bg-slate-50 dark:bg-slate-900/50 p-2 rounded border border-slate-200 dark:border-slate-800 mb-2">
              实际流程结果：{c.workflowResult}{' '}
              <a
                href={`/api/runtime/assistance/screenshot?id=${encodeURIComponent(c.id)}&result=1`}
                target="_blank"
                rel="noreferrer"
                className="op-link"
              >
                查看结果截图
              </a>
            </p>
          )}
          
          <div className="mb-2">
            <a
              href={`/api/runtime/assistance/screenshot?id=${encodeURIComponent(c.id)}`}
              target="_blank"
              rel="noreferrer"
              className="op-link text-xs"
            >
              查看登录截图
            </a>
          </div>

          {c.status === 'waiting' &&
            now > 0 &&
            Date.parse(c.expiresAt) > now && (
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-3">
                <div className="rounded border border-slate-200 dark:border-slate-800 overflow-hidden inline-block max-w-full">
                  <img
                    src={`/api/runtime/assistance/screenshot?id=${encodeURIComponent(c.id)}`}
                    alt={`设备 ${c.deviceId} 的登录待办截图`}
                    style={{ maxHeight: 420, maxWidth: '100%' }}
                  />
                </div>
                <form
                  className="space-y-3"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (busy) return;
                    const form = e.currentTarget;
                    const field = form.elements.namedItem(
                      'password',
                    ) as HTMLInputElement;
                    const password = field.value;
                    field.value = '';
                    setBusy(c.id);
                    setError('');
                    try {
                      await runtimeRequest('/assistance/submit', {
                        id: c.id,
                        password,
                        expectedIdentity: c.expectedIdentity,
                        confirmed: true,
                      });
                    } catch {
                      setError(
                        '输入未确认送达。请刷新状态；不要重复提交或换用其他密码。',
                      );
                    } finally {
                      setBusy(null);
                      await reload();
                    }
                  }}
                >
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      {c.kind === 'otp' ? '一次性验证码' : '登录密码'}
                    </label>
                    <Input
                      aria-label={
                        c.kind === 'otp' ? '一次性验证码' : '登录密码'
                      }
                      name="password"
                      type="password"
                      autoComplete="off"
                      required
                      maxLength={128}
                      pattern="[\x20-\x7E]+"
                      className="max-w-md text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id={`auth-${c.id}`} required className="rounded border-slate-300" />
                    <label htmlFor={`auth-${c.id}`} className="text-xs text-slate-600 dark:text-slate-400">
                      我已核对截图、设备和账号，仅授权本次登录输入
                    </label>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      type="submit"
                      disabled={busy === c.id}
                      className="op-button text-xs"
                    >
                      {busy === c.id ? '提交中…' : '一次性安全填入'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy === c.id}
                      onClick={async () => {
                        try {
                          await runtimeRequest('/assistance/cancel', {
                            id: c.id,
                          });
                          await reload();
                        } catch {
                          setError(
                            '取消未完成：输入可能已被领取，请核对真机状态。',
                          );
                        }
                      }}
                      className="text-xs"
                    >
                      账号不符／取消
                    </Button>
                  </div>
                </form>
              </div>
            )}
          {c.status === 'input_completed' && !c.workflowResult && (
            <p className="text-xs text-slate-500 italic mt-2">
              已填入密码，等待 Artemis 判断登录结果；这不是登录成功回执。
            </p>
          )}
        </div>
      ))}
    </Panel>
  );
}
