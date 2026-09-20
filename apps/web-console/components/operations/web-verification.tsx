'use client';
import React, { useRef, useState } from 'react';
import { runtimeRequest } from '@/lib/operations-context';
export type VerificationJob = {
  id: string;
  deviceId: string;
  status: string;
  traceId?: string;
  expectedName: string;
  expectedProfileId: string;
  resultCode?: string;
  loginSubmitCount?: number;
  finalSubmitClicked?: boolean;
  errorCode?: string;
  startedAt: string;
  finishedAt?: string;
  mode?: string;
  platform?: string;
  diagnostics?: {
    taskStatus: string;
    passed: number;
    failed: number;
    inconclusive: number;
  };
};
export function WebVerification({
  options,
  jobs,
  reload,
}: {
  options?: { available: boolean; deviceId?: string; mediaSha256?: string };
  jobs: VerificationJob[];
  reload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const requestId = useRef<string | null>(null);
  return (
    <section aria-label="真机发布前验收">
      <h3>从 Web 发起真机发布前验收</h3>
      <p>
        本入口真实启动一个 Artemis
        任务。只读协作模式不操作设备，用于观察与人工协助验收；Facebook
        发布前模式验证登录、身份和 Reel
        准备，禁止公开发布。均不创建业务发布授权或消费原排期，设备需先接管。
      </p>
      {error && <p role="alert">{error}</p>}
      {options?.available ? (
        <>
          <p>
            设备：{options.deviceId}；固定测试素材 SHA-256：
            {options.mediaSha256}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              const form = new FormData(e.currentTarget);
              requestId.current ??= crypto.randomUUID();
              setBusy(true);
              setError('');
              try {
                await runtimeRequest('/verifications', {
                  requestId: requestId.current,
                  expectedName: form.get('expectedName'),
                  expectedProfileId: form.get('expectedProfileId'),
                  caption: form.get('caption'),
                  platform: form.get('platform'),
                  mode: form.get('mode'),
                  goal: form.get('goal'),
                  acknowledgeNoPublication: true,
                });
                requestId.current = null;
              } catch {
                setError(
                  '启动未确认，请先核对任务列表。重复点击沿用同一请求，不会另起任务。',
                );
              } finally {
                setBusy(false);
                await reload();
              }
            }}
          >
            <label>
              平台
              <select name="platform" aria-label="平台">
                <option value="facebook">Facebook</option>
                <option value="youtube">YouTube（本批只读）</option>
              </select>
            </label>
            <label>
              执行模式
              <select name="mode" aria-label="执行模式" defaultValue="observe">
                <option value="observe">只读观察与人工协助</option>
                <option value="preflight">Facebook 登录至发布前验收</option>
              </select>
            </label>
            <label>
              任务目标（禁止凭证）
              <textarea
                name="goal"
                aria-label="任务目标（禁止凭证）"
                maxLength={2000}
                defaultValue="观察当前页面，向人工说明阻断并请求确认，然后重新观察；不登录、不请求验证码、不发布。"
              />
            </label>
            <label>
              预期账号显示名
              <input
                name="expectedName"
                aria-label="预期账号显示名"
                required
                maxLength={100}
              />
            </label>
            <label>
              预期平台身份 ID
              <input
                name="expectedProfileId"
                aria-label="预期平台身份 ID"
                required
                pattern="([0-9]{5,30}|UC[A-Za-z0-9_\-]{22})"
              />
            </label>
            <label>
              验收文案
              <input
                name="caption"
                aria-label="验收文案"
                required
                maxLength={1000}
                defaultValue="SG WEB PREFLIGHT - DO NOT PUBLISH"
              />
            </label>
            <label>
              <input type="checkbox" required />
              我确认目标账号及单次登录授权；禁止公开发布，只验收到最终按钮前
            </label>
            <button
              type="submit"
              disabled={busy || jobs.some((j) => j.status === 'running')}
            >
              从 Web 启动完整验收
            </button>
          </form>
        </>
      ) : (
        <p>服务端尚未配置真机验收执行器和固定测试素材。</p>
      )}
      {jobs.map((j) => (
        <article key={j.id} data-verification-id={j.id}>
          <p>
            Web 验收任务：{j.id}；{j.expectedName} / {j.expectedProfileId}
          </p>
          <p>
            状态：{j.status}；结果：{j.resultCode ?? '尚未收尾'}；{j.errorCode}
          </p>
          <p>
            模式：{j.mode ?? '历史发布前验收'}；平台：{j.platform ?? 'facebook'}
          </p>
          {j.status === 'running' && (
            <button
              type="button"
              onClick={async () => {
                try {
                  await runtimeRequest('/verifications/stop', { id: j.id });
                  await reload();
                } catch {
                  setError('停止尚未确认，请核对任务状态；不要重新发起。');
                }
              }}
            >
              停止该验收任务
            </button>
          )}
          {j.resultCode === 'OBSERVATION_COMPLETED' && (
            <p>仅观察与人工协作完成，不代表登录或发布成功。</p>
          )}
          {j.diagnostics && (
            <p>
              Artemis 检查：{j.diagnostics.taskStatus}；通过{' '}
              {j.diagnostics.passed}，失败 {j.diagnostics.failed}，待确认{' '}
              {j.diagnostics.inconclusive}。执行结束不代表业务完成。
            </p>
          )}
          <p>
            Artemis：{j.traceId ?? '启动中'}；登录提交次数：
            {j.loginSubmitCount ?? '尚未核实'}；内容提交：
            {j.finalSubmitClicked === false ? '未点击' : '尚未核实'}
          </p>
          {j.finishedAt && (
            <a
              href={`/api/runtime/verifications/screenshot?id=${encodeURIComponent(j.id)}`}
              target="_blank"
              rel="noreferrer"
            >
              查看最终真机截图
            </a>
          )}
        </article>
      ))}
    </section>
  );
}
