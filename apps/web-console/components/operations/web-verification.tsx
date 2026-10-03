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
  allowLocalParticipationStart?: boolean;
  allowEndpointReportingStart?: boolean;
  allowParticipationWithdrawal?: boolean;
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
  const [mode, setMode] = useState('observe');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef<string | null>(null);

  return (
    <Panel title="真机发布前验收">
      <Notice>
        本入口真实启动一个 Artemis
        任务。只读协作模式不操作设备，用于观察与人工协助验收；Facebook
        发布前模式验证登录、身份和 Reel
        准备，禁止公开发布。自有客户端测试检查已关联手机的后台参与，默认保持参与；撤回需单独授权。不注册、不登录；勾选单次授权后可首次确认参与，过期或失败后不自动恢复。均不创建业务发布授权或消费原排期，设备需先接管。
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
                  allowLocalParticipationStart: mode === 'client_test' && form.get('allowLocalParticipationStart') === 'on',
                  allowEndpointReportingStart: ['client_test', 'connectivity_test'].includes(mode) && form.get('allowEndpointReportingStart') === 'on',
                  allowParticipationWithdrawal: mode === 'client_test' && form.get('allowParticipationWithdrawal') === 'on',
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
                <label htmlFor="verification-platform" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  平台
                </label>
                <select
                  id="verification-platform"
                  name="platform"
                  aria-label="平台"
                  className="w-full h-8 px-2.5 rounded-lg border border-slate-300 bg-transparent text-xs"
                >
                  <option value="facebook">Facebook</option>
                  <option value="youtube">YouTube（本批只读）</option>
                  <option value="socialgrowth">SocialGrowth 自有客户端</option>
                </select>
              </div>
              <div>
                <label htmlFor="verification-mode" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  执行模式
                </label>
                <select
                  id="verification-mode"
                  name="mode"
                  aria-label="执行模式"
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                  className="w-full h-8 px-2.5 rounded-lg border border-slate-300 bg-transparent text-xs"
                >
                  <option value="observe">只读观察与人工协助</option>
                  <option value="preflight">Facebook 登录至发布前验收</option>
                  <option value="connectivity_test">自有手机远程连接准备</option>
                  <option value="client_test">自有客户端后台参与验证</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="verification-goal" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                任务目标（禁止凭证）
              </label>
              <Textarea
                id="verification-goal"
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
                <label htmlFor="verification-expectedName" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  预期账号显示名
                </label>
                <Input
                  id="verification-expectedName"
                  name="expectedName"
                  aria-label="预期账号显示名"
                  required
                  maxLength={100}
                  className="w-full text-xs"
                />
              </div>
              <div>
                <label htmlFor="verification-expectedProfileId" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  预期平台身份 ID
                </label>
                <Input
                  id="verification-expectedProfileId"
                  name="expectedProfileId"
                  aria-label="预期平台身份 ID"
                  required
                  pattern="([0-9]{5,30}|UC[A-Za-z0-9_\-]{22}|com[.]socialgrowth[.]product)"
                  className="w-full text-xs font-mono"
                />
              </div>
            </div>

            <div>
              <label htmlFor="verification-caption" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                验收文案
              </label>
              <Input
                id="verification-caption"
                  name="caption"
                aria-label="验收文案"
                required
                maxLength={1000}
                defaultValue="SG WEB PREFLIGHT - DO NOT PUBLISH"
                className="w-full text-xs"
              />
            </div>

            {['client_test', 'connectivity_test'].includes(mode) && <div className="flex items-center gap-2">
              <input type="checkbox" id="client-endpoint-start" name="allowEndpointReportingStart" />
              <label htmlFor="client-endpoint-start" className="text-xs text-slate-600 dark:text-slate-400">授权本次开启自有客户端的端口自动上报</label>
            </div>}
            {mode === 'client_test' && <div className="flex items-center gap-2">
              <input type="checkbox" id="client-initial-start" name="allowLocalParticipationStart" />
              <label htmlFor="client-initial-start" className="text-xs text-slate-600 dark:text-slate-400">
                授权本次测试首次确认参与一次；失败或过期后不恢复
              </label>
            </div>}

            {mode === 'client_test' && <div className="flex items-center gap-2">
              <input type="checkbox" id="client-withdrawal-test" name="allowParticipationWithdrawal" />
              <label htmlFor="client-withdrawal-test" className="text-xs text-slate-600 dark:text-slate-400">授权本次测试撤回参与；默认保持参与</label>
            </div>}
            <div className="flex items-center gap-2">
              <input type="checkbox" id="no-pub-ack" required className="rounded border-slate-300" />
              <label htmlFor="no-pub-ack" className="text-xs text-slate-600 dark:text-slate-400">
                我确认本次验收范围；客户端默认保留参与，撤回需单独授权，禁止公开发布
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
          {['client_test', 'connectivity_test'].includes(j.mode ?? '') && <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">
            本次首次参与：{j.allowLocalParticipationStart ? '已授权一次' : '未授权'}；端口上报：{j.allowEndpointReportingStart ? '已授权开启' : '未授权开启'}
            ；参与撤回：{j.allowParticipationWithdrawal === undefined ? '历史流程，查看原回执' : j.allowParticipationWithdrawal ? '已授权测试' : '未授权，保持参与'}
          </p>}
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
          {j.mode === 'client_test' && j.resultCode === 'CLIENT_TEST_COMPLETED' &&
            (!j.diagnostics || j.diagnostics.taskStatus !== 'completed' || j.diagnostics.passed <= 0 ||
              j.diagnostics.failed !== 0 || j.diagnostics.inconclusive !== 0) && (
            <p data-client-acceptance="failed" className="text-xs text-rose-600 dark:text-rose-400 mb-1">
              客户端验收未通过：检查存在失败、待确认或缺少证据。原模型完成回执保留供核对。
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
