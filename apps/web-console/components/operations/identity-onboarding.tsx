'use client';
import React, { useRef, useState } from 'react';
import { runtimeRequest, useOperations } from '@/lib/operations-context';
import { Button } from '@/components/ui/button';
import { Form, Link, Notice, date } from './shared';
import { StatusBadge } from './status-badge';
import { useRuntimeStatus } from './runtime';
import type { IdentityJob } from '../../../../services/execution-runtime/src/identity-onboarding';
import { validRelation } from '@/lib/operations';
import { deviceInitializationTemplate } from '@/lib/first-loop/catalog';

export function OnboardingJobs({
  jobs,
  reload,
}: {
  jobs: IdentityJob[];
  reload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const action = async (path: string, id: string) => {
    setBusy(true);
    setError('');
    try {
      await runtimeRequest(path, { id });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作未确认，请刷新核对');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="账号接入任务" className="space-y-3 mt-4">
      {error && <p role="alert" className="op-error">{error}</p>}
      {jobs.map((j) => (
        <article className="op-record" key={j.id}>
          <div className="flex items-center justify-between gap-2 mb-1">
            <h3 className="text-sm font-semibold">
              {j.action === 'initialize' ? '手机初始化 ·' : j.action === 'create' ? '创建' : '核验'}{' '}
              {j.platform === 'facebook' ? 'Facebook Page' : 'YouTube 频道'}：
              {j.name}
            </h3>
            <StatusBadge
              status={
                j.status === 'verified'
                  ? 'online'
                  : j.status === 'running'
                    ? 'online'
                    : j.reason === 'DEVICE_LOCKED'
                      ? 'warning'
                      : ['unknown', 'interrupted'].includes(j.status)
                        ? 'danger'
                        : 'neutral'
              }
            >
              {j.verificationClosure
                ? '旧核验已结束 · 结果仍未知'
                : `${j.status} · ${j.reason ?? 'Agent 执行中'}`}
            </StatusBadge>
          </div>
          
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
            <code className="font-mono text-[11px] bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">{j.id}</code> · {date(j.startedAt)}
          </p>

          {j.reason === 'DEVICE_LOCKED' && (
            <Notice>
              手机安全锁屏未解锁。请在指定手机上手动解锁，再重新发起核验；系统不会猜测
              PIN、密码或图案。
            </Notice>
          )}

          {j.identityUrl && (
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">
              身份地址（不是导流目的地）：
              <a
                className="op-link ml-1"
                href={j.identityUrl}
                target="_blank"
                rel="noreferrer"
              >
                {j.identityUrl}
              </a>
            </p>
          )}
          {j.action === 'initialize' && j.initializationEvidence && (
            <Notice>
              本平台初始化核验通过：应用可用、指定登录身份和管理权限已核验；
              {j.initializationEvidence.identityCreated ? '已创建授权身份。' : '沿用已有身份。'}
              请确认截图并保存绑定。此结果不代表另一平台已初始化，也不替代后续发布授权及即时检查。
            </Notice>
          )}

          <div className="op-row mt-2">
            <Link page="receipts" id={j.id} project={j.projectId}>
              任务与人工待办
            </Link>
            {j.status === 'running' && (
              <Button
                className="op-button text-xs"
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => void action('/onboarding/stop', j.id)}
              >
                停止本次账号操作
              </Button>
            )}
            {!j.verificationClosure && ['unknown', 'interrupted'].includes(j.status)
              && (j.action === 'verify' || (j.action === 'initialize' && j.initializationMode === 'existing_only')) && (
              <Button
                className="op-button text-xs"
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => void action('/onboarding/end-stopped', j.id)}
              >
                结束这条已停止的核验
              </Button>
            )}
            {j.screenshotAvailable && j.status !== 'verified' && (
              <a
                className="op-link text-xs"
                href={`/api/runtime/onboarding/screenshot?id=${encodeURIComponent(j.id)}`}
                target="_blank"
                rel="noreferrer"
              >
                查看阻断现场截图
              </a>
            )}
            {j.status === 'verified' && (
              <>
                <a
                  className="op-link text-xs"
                  href={`/api/runtime/onboarding/screenshot?id=${encodeURIComponent(j.id)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看身份核验截图
                </a>
                <Button
                  className="op-button text-xs"
                  size="sm"
                  disabled={busy}
                  onClick={() => void action('/onboarding/bind', j.id)}
                >
                  确认核验结果并保存发布绑定
                </Button>
              </>
            )}
          </div>

          {['unknown', 'interrupted'].includes(j.status) && (
            <Notice>
              {j.verificationClosure
                ? '这条旧核验已结束，后续不会再次查询或重发；原结果仍未知，不代表核验成功，且未修改发布绑定。'
                : j.action === 'create' || (j.action === 'initialize' && j.initializationMode === 'create_if_missing')
                ? '创建结果未确认，不允许自动再次创建。请核对原设备与平台记录；已发现的身份请发起“核验已有”任务。'
                : '身份核验未完成，未修改发布绑定。请查看阻断原因或现场截图，处理后重新核验。'}
            </Notice>
          )}
          {j.verificationClosure && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              结束记录：{date(j.verificationClosure.at)} · {j.verificationClosure.evidenceKind === 'supervision_stop_and_session_closed' ? '监督停止记录与会话关闭' : `原引擎终态：${j.verificationClosure.engineTraceStatus}`}
            </p>
          )}
        </article>
      ))}
    </section>
  );
}

export function IdentityOnboardingPanel({ accountId }: { accountId: string }) {
  const { state, projectId } = useOperations();
  const { status, reload } = useRuntimeStatus();
  const request = useRef<{ signature: string; id: string } | null>(null);
  const account = state.accounts.find((a) => a.id === accountId)!;
  const projects = state.projects.filter(
    (p) =>
      p.status === 'active' &&
      state.accountServiceRelations.some(
        (r) =>
          r.projectId === p.id && r.accountId === accountId && validRelation(r),
      ),
  );
  const bound = status.bindings.find((b) => b.accountId === accountId);
  return (
    <>
      <Notice>
        账号档案尚不代表真实 Page／频道。先保存项目授权，再由 Artemis 在原生 App
        核验或创建。任务会等待人工密码／验证码；不公开发布、不切换其他登录账号。
        新手机请选择“手机初始化”：检查并安装可信应用、登录指定账号、核验或按明确授权创建缺少的 Page／频道，在同一任务内完成人工协助。
      </Notice>
      {status.verificationOptions?.available && (
        <Form
          id={`identity-onboard-${accountId}`}
          title="接入 Page / 频道"
          submit="发起一次 Artemis 账号接入任务"
          description="手机初始化在确认后先暂停该设备发布队列，再启动一次 Agent 任务；完成或阻断后仍保持暂停，核对绑定后到任务中心恢复。已有绑定不允许创建另一身份；其他接入方式需先申请设备接管。"
          fields={(v) => [
            {
              key: 'project',
              label: '运营项目',
              initial: projectId,
              options: projects,
            },
            {
              key: 'action',
              label: '接入方式',
              initial: deviceInitializationTemplate.action,
              options: [
                { id: deviceInitializationTemplate.action, name: `${deviceInitializationTemplate.name}（当前平台）` },
                { id: 'verify', name: '核验已有 Page / 频道' },
                ...(!bound
                  ? [{ id: 'create', name: '授权创建一个新 Page / 频道' }]
                  : []),
              ],
            },
            ...(v.action === 'initialize' ? [{
              key: 'initializationMode',
              label: '初始化身份处理',
              initial: 'existing_only',
              options: [
                { id: 'existing_only', name: '只接入已有 Page / 频道，不允许创建' },
                ...(!bound ? [{ id: 'create_if_missing', name: '确认缺少时，授权创建一个 Page / 频道' }] : []),
              ],
            }] : []),
            {
              key: 'name',
              label: '平台 Page / 频道准确名称',
              initial: account.name,
            },
            ...(v.action === 'verify' || (v.action === 'initialize' && v.initializationMode !== 'create_if_missing')
              ? [
                  {
                    key: 'expectedId',
                    label: '完整 Page ID / 频道 ID',
                    optional: v.action === 'initialize' && !bound,
                    hint: '已有绑定必须填写原完整 ID；未绑定的初始化可留空，由 Agent 核验父账号、准确名称和管理权限后读取，身份有歧义时交人工。',
                  },
                ]
              : []),
            ...(v.action === 'create' || v.action === 'initialize' ? [
                  {
                    key: 'loginIdentity',
                    label: '所属登录账号的唯一标识',
                    hint: 'Facebook 个人账号完整 ID 或 Google 登录账号标识；不是新 Page 名称，禁止填写密码。必须先核验一致才允许创建。',
                  },
                ] : []),
            ...(v.action === 'create' || (v.action === 'initialize' && v.initializationMode === 'create_if_missing') ? [
                  {
                    key: 'category',
                    label: 'Page 类别',
                    optional: account.platform === 'youtube',
                    hint: '按实际业务填写；平台不支持时由 Agent 请求人工补充，不猜测。',
                  },
                  {
                    key: 'description',
                    label: '简介',
                    type: 'textarea' as const,
                    optional: true,
                  },
                ] : []),
            {
              key: 'authorization',
              label: '本次账号操作授权依据',
              hint: '初始化包括检查、可信安装、指定账号登录和所选身份处理；不包括创建个人/Google 登录账号、公开发布或账号轮换。密码和验证码只在任务专用待办中输入。',
            },
            {
              key: 'confirmed',
              label: '确认操作范围',
              options: [
                { id: 'yes', name: '确认本人有权执行上述账号操作，信息已核对' },
              ],
            },
          ]}
          onSubmit={async (v) => {
            const payload = {
              accountId,
              loginIdentity:
                v.action === 'create' || v.action === 'initialize' ? v.loginIdentity : undefined,
              initializationMode: v.action === 'initialize' ? v.initializationMode : undefined,
              projectId: v.project,
              action: v.action,
              expectedId: v.action === 'verify' || (v.action === 'initialize' && v.initializationMode !== 'create_if_missing') ? v.expectedId || undefined : undefined,
              name: v.name,
              category: v.action === 'create' || (v.action === 'initialize' && v.initializationMode === 'create_if_missing') ? v.category || '' : '',
              description: v.action === 'create' || (v.action === 'initialize' && v.initializationMode === 'create_if_missing') ? v.description || '' : '',
              authorizationRef: v.authorization,
              confirmed: v.confirmed === 'yes',
            };
            const signature = JSON.stringify(payload);
            if (request.current?.signature !== signature)
              request.current = { signature, id: crypto.randomUUID() };
            try {
              if (v.action === 'initialize') {
                const deviceId = status.verificationOptions?.deviceId;
                if (!deviceId || (account.deviceRef !== deviceId && bound?.deviceId !== deviceId))
                  throw new Error('ACCOUNT_DEVICE_NOT_REGISTERED');
                if (!status.deviceHolds.some((h) => h.device === deviceId))
                  await runtimeRequest('/device-control', { deviceId, held: true });
              }
              await runtimeRequest('/onboarding', {
                ...payload,
                requestId: request.current.id,
              });
              request.current = null;
              await reload();
              return { ok: true };
            } catch (e) {
              const code = e instanceof Error ? e.message : 'ONBOARDING_FAILED';
              return {
                ok: false,
                error: {
                  code,
                  message:
                    code === 'DEVICE_HOLD_REQUIRED'
                      ? '请先在任务中心申请设备人工接管，再重试。'
                      : `任务未确认启动：${code}。请核对账号授权、设备与已有任务。`,
                },
              };
            }
          }}
        />
      )}
      {!status.verificationOptions?.available && (
        <Notice>
          账号接入尚未配置
          Artemis；请在接入状态核对服务配置。不能据此创建或验证真实身份。
        </Notice>
      )}
      <OnboardingJobs
        jobs={(status.onboarding ?? []).filter(
          (j) => j.accountId === accountId,
        )}
        reload={reload}
      />
    </>
  );
}
