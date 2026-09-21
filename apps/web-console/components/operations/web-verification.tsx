'use client';
import React, { useRef, useState } from 'react';
import { runtimeRequest } from '@/lib/operations-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from './status-badge';
import { Panel, Notice } from './shared';

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef<string | null>(null);

  return (
    <Panel title="真机发布前验收">
      <Notice>
        本入口真实启动一个 Artemis
        任务。只读协作模式不操作设备，用于观察与人工协助验收；Facebook
        发布前模式验证登录、身份和 Reel
        准备，禁止公开发布。均不创建业务发布授权或消费原排期，设备需先接管。
      </Notice>
      {error && <p role="alert" className="op-error">{error}</p>}
      
      {options?.available ? (
        <div className="op-record mb-4">
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
            设备：<span className="font-mono">{options.deviceId}</span>；固定测试素材 SHA-256：
            <span className="font-mono">{options.mediaSha256}</span>
          </p>
          <form
            className="space-y-3"
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  平台
                </label>
                <select
                  name="platform"
                  aria-label="平台"
                  className="w-full h-8 px-2.5 rounded-lg border border-slate-300 bg-transparent text-xs"
                >
                  <option value="facebook">Facebook</option>
                  <option value="youtube">YouTube（本批只读）</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  执行模式
                </label>
                <select
                  name="mode"
                  aria-label="执行模式"
                  defaultValue="observe"
                  className="w-full h-8 px-2.5 rounded-lg border border-slate-300 bg-transparent text-xs"
                >
                  <option value="observe">只读观察与人工协助</option>
                  <option value="preflight">Facebook 登录至发布前验收</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                任务目标（禁止凭证）
              </label>
              <Textarea
                name="goal"
                aria-label="任务目标（禁止凭证）"
                maxLength={2000}
                defaultValue="观察当前页面，向人工说明阻断并请求确认，然后重新观察；不登录、不请求验证码、不发布。"
                className="w-full text-xs"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  预期账号显示名
                </label>
                <Input
                  name="expectedName"
                  aria-label="预期账号显示名"
                  required
                  maxLength={100}
                  className="w-full text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  预期平台身份 ID
                </label>
                <Input
                  name="expectedProfileId"
                  aria-label="预期平台身份 ID"
                  required
                  pattern="([0-9]{5,30}|UC[A-Za-z0-9_\-]{22})"
                  className="w-full text-xs font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                验收文案
              </label>
              <Input
                name="caption"
                aria-label="验收文案"
                required
                maxLength={1000}
                defaultValue="SG WEB PREFLIGHT - DO NOT PUBLISH"
                className="w-full text-xs"
              />
            </div>

            <div className="flex items-center gap-2">
              <input type="checkbox" id="no-pub-ack" required className="rounded border-slate-300" />
              <label htmlFor="no-pub-ack" className="text-xs text-slate-600 dark:text-slate-400">
                我确认目标账号及单次登录授权；禁止公开发布，只验收到最终按钮前
              </label>
            </div>

            <Button
              type="submit"
              disabled={busy || jobs.some((j) => j.status === 'running')}
              className="op-button text-xs"
            >
              {busy ? '正在启动…' : '从 Web 启动完整验收'}
            </Button>
          </form>
        </div>
      ) : (
        <p className="op-empty">服务端尚未配置真机验收执行器和固定测试素材。</p>
      )}

      {jobs.map((j) => (
        <div key={j.id} data-verification-id={j.id} className="op-record">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h4 className="font-semibold text-sm">
              Web 验收任务：{j.id}
            </h4>
            <StatusBadge
              status={
                j.status === 'running'
                  ? 'online'
                  : j.status === 'completed'
                    ? 'online'
                    : j.status === 'failed'
                      ? 'danger'
                      : 'neutral'
              }
            >
              {j.status} · {j.resultCode ?? '尚未收尾'}
            </StatusBadge>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">
            目标：{j.expectedName} / <span className="font-mono">{j.expectedProfileId}</span>；模式：{j.mode ?? '历史发布前验收'}；平台：{j.platform ?? 'facebook'}
          </p>
          {j.errorCode && (
            <p className="text-xs text-rose-600 dark:text-rose-400 font-mono mb-1">
              错误码：{j.errorCode}
            </p>
          )}
          {j.resultCode === 'OBSERVATION_COMPLETED' && (
            <p className="text-xs text-slate-500 italic mb-1">
              仅观察与人工协作完成，不代表登录或发布成功。
            </p>
          )}
          {j.diagnostics && (
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">
              Artemis 检查：{j.diagnostics.taskStatus}；通过{' '}
              {j.diagnostics.passed}，失败 {j.diagnostics.failed}，待确认{' '}
              {j.diagnostics.inconclusive}。执行结束不代表业务完成。
            </p>
          )}
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
            Artemis：{j.traceId ?? '启动中'}；登录提交：
            {j.loginSubmitCount ?? '尚未核实'}；内容提交：
            {j.finalSubmitClicked === false ? '未点击' : '尚未核实'}
          </p>
          <div className="flex items-center gap-3">
            {j.status === 'running' && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={async () => {
                  try {
                    await runtimeRequest('/verifications/stop', { id: j.id });
                    await reload();
                  } catch {
                    setError('停止尚未确认，请核对任务状态；不要重新发起。');
                  }
                }}
                className="text-xs"
              >
                停止该验收任务
              </Button>
            )}
            {j.finishedAt && (
              <a
                href={`/api/runtime/verifications/screenshot?id=${encodeURIComponent(j.id)}`}
                target="_blank"
                rel="noreferrer"
                className="op-link text-xs"
              >
                查看最终真机截图
              </a>
            )}
          </div>
        </div>
      ))}
    </Panel>
  );
}
