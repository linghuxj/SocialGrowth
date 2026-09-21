'use client';
import React, { useRef, useState } from 'react';
import { runtimeRequest, useOperations } from '@/lib/operations-context';
import { Form, Link, Notice, date } from './shared';
import { useRuntimeStatus } from './runtime';
import type { IdentityJob } from '../../../../services/execution-runtime/src/identity-onboarding';
import { validRelation } from '@/lib/operations';

export function OnboardingJobs({
  jobs,
  reload,
}: {
  jobs: IdentityJob[];
  reload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
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
    <section aria-label="账号接入任务">
      {error && <p role="alert">{error}</p>}
      {jobs.map((j) => (
        <article className="op-record" key={j.id}>
          <h3>
            {j.action === 'create' ? '创建' : '核验'}{' '}
            {j.platform === 'facebook' ? 'Facebook Page' : 'YouTube 频道'}：
            {j.name}
          </h3>
          <p>
            <code>{j.id}</code> · {j.status} · {j.reason ?? 'Agent 执行中'} ·{' '}
            {date(j.startedAt)}
          </p>
          {j.reason === 'DEVICE_LOCKED' && (
            <Notice>
              手机安全锁屏未解锁。请在指定手机上手动解锁，再重新发起核验；系统不会猜测
              PIN、密码或图案。
            </Notice>
          )}
          {j.identityUrl && (
            <p>
              身份地址（不是导流目的地）：
              <a
                className="op-link"
                href={j.identityUrl}
                target="_blank"
                rel="noreferrer"
              >
                {j.identityUrl}
              </a>
            </p>
          )}
          <div className="op-row">
            <Link page="receipts" id={j.id} project={j.projectId}>
              任务与人工待办
            </Link>
            {j.status === 'running' && (
              <button
                className="op-button"
                disabled={busy}
                onClick={() => void action('/onboarding/stop', j.id)}
              >
                停止本次账号操作
              </button>
            )}
            {j.screenshotAvailable && j.status !== 'verified' && (
              <a
                className="op-link"
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
                  className="op-link"
                  href={`/api/runtime/onboarding/screenshot?id=${encodeURIComponent(j.id)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看身份核验截图
                </a>
                <button
                  className="op-button"
                  disabled={busy}
                  onClick={() => void action('/onboarding/bind', j.id)}
                >
                  确认核验结果并保存发布绑定
                </button>
              </>
            )}
          </div>
          {['unknown', 'interrupted'].includes(j.status) && (
            <Notice>
              {j.action === 'create'
                ? '创建结果未确认，不允许自动再次创建。请核对原设备与平台记录；已发现的身份请发起“核验已有”任务。'
                : '身份核验未完成，未修改发布绑定。请查看阻断原因或现场截图，处理后重新核验。'}
            </Notice>
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
      </Notice>
      {status.verificationOptions?.available && (
        <Form
          id={`identity-onboard-${accountId}`}
          title="接入 Page / 频道"
          submit="发起一次 Artemis 账号接入任务"
          description="创建会改变真实平台账号资产，请确认名称和权限。已有绑定仅允许核验；需先在任务中心申请设备人工接管，暂停普通发布队列。"
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
              initial: 'verify',
              options: [
                { id: 'verify', name: '核验已有 Page / 频道' },
                ...(!bound
                  ? [{ id: 'create', name: '授权创建一个新 Page / 频道' }]
                  : []),
              ],
            },
            {
              key: 'name',
              label: '平台 Page / 频道准确名称',
              initial: account.name,
            },
            ...(v.action !== 'create'
              ? [
                  {
                    key: 'expectedId',
                    label: '完整 Page ID / 频道 ID',
                    hint: 'Facebook 数字 ID；YouTube 以 UC 开头的 24 位频道 ID。不能只填昵称。',
                  },
                ]
              : [
                  {
                    key: 'loginIdentity',
                    label: '创建所属登录账号的唯一标识',
                    hint: 'Facebook 个人账号完整 ID 或 Google 登录账号标识；不是新 Page 名称，禁止填写密码。必须先核验一致才允许创建。',
                  },
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
                ]),
            {
              key: 'authorization',
              label: '本次账号操作授权依据',
              hint: '仅此项真实核验或创建，不包括公开发布和账号轮换。',
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
                v.action === 'create' ? v.loginIdentity : undefined,
              projectId: v.project,
              action: v.action,
              expectedId: v.action === 'verify' ? v.expectedId : undefined,
              name: v.name,
              category: v.action === 'create' ? v.category || '' : '',
              description: v.action === 'create' ? v.description || '' : '',
              authorizationRef: v.authorization,
              confirmed: v.confirmed === 'yes',
            };
            const signature = JSON.stringify(payload);
            if (request.current?.signature !== signature)
              request.current = { signature, id: crypto.randomUUID() };
            try {
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
