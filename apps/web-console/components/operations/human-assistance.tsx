'use client';
/* oxlint-disable next/no-img-element -- Private no-store screenshots must not pass through an image optimizer/cache. */
import React, { useEffect, useState } from 'react';
import { runtimeRequest } from '@/lib/operations-context';

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
    <section aria-label="人工登录协助">
      <h3>人工登录协助</h3>
      <p>
        Artemis
        在原任务内等待。请核对截图与预期账号；账号不符请取消并联系账号负责人重新分发，禁止试用其他账号。密码仅临时传递、不保存，仅支持可打印
        ASCII 字符。填入不代表登录成功。
      </p>
      {error && <p role="alert">{error}</p>}
      {!challenges.length && <p>暂无登录输入待办。</p>}
      {challenges.map((c) => (
        <article key={c.id} data-challenge-id={c.id}>
          <p>
            设备：{c.deviceId}；预期账号：{c.expectedIdentity}
          </p>
          <p>
            任务：{c.taskId}；Artemis：{c.traceId}；
            {c.mode === 'diagnostic' ? '诊断验收（无发布授权）' : '运营执行'}
          </p>
          <p>
            状态：{c.status} {c.resultCode}；有效期：{c.expiresAt}
          </p>
          {c.workflowResult && (
            <p>
              实际流程结果：{c.workflowResult}{' '}
              <a
                href={`/api/runtime/assistance/screenshot?id=${encodeURIComponent(c.id)}&result=1`}
                target="_blank"
                rel="noreferrer"
              >
                查看结果截图
              </a>
            </p>
          )}
          <a
            href={`/api/runtime/assistance/screenshot?id=${encodeURIComponent(c.id)}`}
            target="_blank"
            rel="noreferrer"
          >
            查看登录截图
          </a>
          {c.status === 'waiting' &&
            now > 0 &&
            Date.parse(c.expiresAt) > now && (
              <>
                <img
                  src={`/api/runtime/assistance/screenshot?id=${encodeURIComponent(c.id)}`}
                  alt={`设备 ${c.deviceId} 的登录待办截图`}
                  style={{ maxHeight: 420, maxWidth: '100%' }}
                />
                <form
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
                  <label>
                    {c.kind === 'otp' ? '一次性验证码' : '登录密码'}
                    <input
                      aria-label={
                        c.kind === 'otp' ? '一次性验证码' : '登录密码'
                      }
                      name="password"
                      type="password"
                      autoComplete="off"
                      required
                      maxLength={128}
                      pattern="[\x20-\x7E]+"
                    />
                  </label>
                  <label>
                    <input type="checkbox" required />
                    我已核对截图、设备和账号，仅授权本次登录输入
                  </label>
                  <button type="submit" disabled={busy === c.id}>
                    一次性安全填入
                  </button>
                  <button
                    type="button"
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
                  >
                    账号不符／取消
                  </button>
                </form>
              </>
            )}
          {c.status === 'input_completed' && !c.workflowResult && (
            <p>已填入密码，等待 Artemis 判断登录结果；这不是登录成功回执。</p>
          )}
        </article>
      ))}
    </section>
  );
}
