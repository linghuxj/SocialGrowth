'use client';
import React, { useEffect, useState } from 'react';
import { runtimeRequest, useOperations } from '@/lib/operations-context';
import type { CommandResult } from '@/lib/first-loop/types';
import { Form, Panel, Notice, List, Link, iso, date, TerminalStream, type LogLine } from './shared';
import { lookup, label } from '@/lib/operations';
import {
  FIRST_LOOP_STORAGE_KEY,
  loadFirstLoopState,
} from '@/lib/first-loop/storage';
import { assetUrl, storeAsset } from '@/lib/local-assets';
import { HumanAssistance, type HumanChallenge } from './human-assistance';
import { WebVerification, type VerificationJob } from './web-verification';
import { AgentSupervision, type SupervisionStatus } from './agent-supervision';
import { OnboardingJobs } from './identity-onboarding';
import type { IdentityJob } from '../../../../services/execution-runtime/src/identity-onboarding';
type Binding = {
  id: string;
  deviceId: string;
  serial: string;
  platform: string;
  accountId: string;
  platformIdentity: string;
  validUntil: string;
};
type TaskRecord = {
  taskId: string;
  status: string;
  task: {
    settings: { scheduleId: string; mode: string };
    directive: {
      deviceId: string;
      attemptId: string;
      projectId: string;
      accountId: string;
      contentIdentityId: string;
    };
  };
  receipt: null | {
    publishStatus: string;
    evidenceRefs: string[];
    publishedUrl?: string;
    failureCode?: string;
    actionRequired?: {
      kind: 'account' | 'app';
      reason: string;
      expectedIdentity?: string;
      observedIdentity?: string;
      nextAction: string;
    };
  };
};
type RuntimeStatus = {
  onboarding?: IdentityJob[];
  supervision?: SupervisionStatus;
  verificationOptions?: {
    available: boolean;
    deviceId?: string;
    mediaSha256?: string;
  };
  verifications?: VerificationJob[];
  assistance?: HumanChallenge[];
  bindings: Binding[];
  tasks: TaskRecord[];
  pauses: { scope: string; reason: string }[];
  preparations: {
    taskId: string;
    phase: string;
    nextCheckAt: string;
    checks: number;
    report: null | { reason: string; detailCode?: string };
  }[];
  deviceHolds: { device: string }[];
};
export function useRuntimeStatus() {
  const [status, setStatus] = useState<RuntimeStatus>({
    bindings: [],
    tasks: [],
    pauses: [],
    preparations: [],
    deviceHolds: [],
  });
  const [error, setError] = useState('');
  const reload = async () => {
    try {
      setStatus(await runtimeRequest<RuntimeStatus>('/status'));
      setError('');
    } catch {
      setError('执行服务未连接');
    }
  };
  useEffect(() => {
    const first = setTimeout(() => void reload(), 0);
    const timer = setInterval(() => void reload(), 5000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  return { status, error, reload };
}
async function save(
  path: string,
  body: unknown,
): Promise<CommandResult<unknown>> {
  try {
    return await runtimeRequest<CommandResult<unknown>>(path, body);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'RUNTIME_REJECTED',
        message: error instanceof Error ? error.message : '操作未保存',
      },
    };
  }
}
export function DeviceBindings() {
  const { state, refresh } = useOperations();
  const { status, error, reload } = useRuntimeStatus();
  return (
    <Panel title="真机账号绑定">
      <Notice>
        {error ||
          '登记设备与唯一平台身份，核对账号所有方操作授权。绑定不包含账号密码；密钥由本机执行服务管理。'}
      </Notice>
      <Form
        id="device-binding"
        title="登记已核对的账号绑定"
        submit="保存绑定"
        fields={[
          { key: 'account', label: '业务账号', options: state.accounts },
          { key: 'device', label: '设备标识（与账号档案一致）' },
          { key: 'serial', label: 'ADB 真机序列号' },
          { key: 'identity', label: '平台唯一账号 ID 或个人资料 / 频道 URL' },
          { key: 'authorization', label: '账号所有方操作授权依据' },
          { key: 'scope', label: '平台条款核查与允许自动化范围依据' },
          { key: 'until', label: '核对有效期至', type: 'datetime-local' },
        ]}
        onSubmit={async (v) => {
          const account = state.accounts.find((a) => a.id === v.account);
          const result = await save('/bindings', {
            id: `binding:${v.device}:${account?.platform}`,
            deviceId: v.device,
            serial: v.serial,
            accountId: v.account,
            platform: account?.platform,
            platformIdentity: v.identity,
            authorizationRef: v.authorization,
            automationScopeRef: v.scope,
            verifiedAt: new Date().toISOString(),
            validUntil: iso(v.until),
          });
          await reload();
          await refresh();
          return result;
        }}
      />
      <List
        query=""
        columns={['账号', '设备 / 序列号', '平台身份', '有效期']}
        rows={status.bindings.map((b) => ({
          id: b.id,
          search: '',
          cells: [
            lookup(state, b.accountId),
            `${b.deviceId} / ${b.serial}`,
            b.platformIdentity,
            date(b.validUntil),
          ],
        }))}
        empty="尚无经过核对的绑定"
      />
    </Panel>
  );
}
export function ExecutionQueue({ scheduleId }: { scheduleId: string }) {
  const { state, refresh } = useOperations();
  const { status, reload } = useRuntimeStatus();
  const schedule = state.publicationSchedules.find((s) => s.id === scheduleId);
  const approval = state.executionApprovals.find(
    (a) => a.id === schedule?.approvalId,
  );
  const account = state.accounts.find((a) => a.id === approval?.accountId);
  const queued = status.tasks.find(
    (t) => t.task.settings.scheduleId === scheduleId,
  );
  if (!approval || !schedule) return null;
  if (queued)
    return (
      <p className="op-help">
        任务 {queued.taskId} ·{' '}
        {queued.task.settings.mode === 'preflight' ? '发布前验证' : '正式发布'}{' '}
        · {queued.status}。执行证据见执行记录。
      </p>
    );
  return (
    <Form
      id={`dispatch-${scheduleId}`}
      title="核对真机执行参数"
      submit="确认并加入设备队列"
      description="发布前验证停在最终提交页；正式发布仅在具有本次明确发布授权时选择。每个排期只创建一个任务，结果未知不会自动重发。"
      fields={(v) => [
        {
          key: 'binding',
          label: '已核对绑定',
          options: status.bindings
            .filter((b) => b.accountId === approval.accountId)
            .map((b) => ({
              id: b.id,
              name: `${b.deviceId} · ${b.platformIdentity}`,
            })),
        },
        {
          key: 'slice',
          label: '本次唯一素材版本',
          options: state.sliceAssets
            .filter(
              (a) =>
                a.contentIdentityId === approval.contentIdentityId &&
                a.destinationFit === 'eligible',
            )
            .map((a) => ({
              id: a.id,
              name: `${a.language} / ${a.variant} / ${a.sha256.slice(0, 12)}`,
            })),
        },
        {
          key: 'mode',
          label: '执行模式',
          initial: 'publish',
          options: [
            { id: 'preflight', name: '发布前验证（不提交）' },
            { id: 'publish', name: '正式公开发布一次' },
          ],
        },
        { key: 'caption', label: '最终文案', type: 'textarea' },
        {
          key: 'ai',
          label: 'AI 标签',
          options: [
            { id: 'true', name: '开启' },
            { id: 'false', name: '关闭' },
          ],
        },
        { key: 'aiReason', label: 'AI 标签判定依据' },
        { key: 'music', label: '音乐 / 配音授权依据' },
        ...(account?.platform === 'youtube'
          ? [
              {
                key: 'kids',
                label: '是否面向儿童',
                options: [
                  { id: 'true', name: '是' },
                  { id: 'false', name: '否' },
                ],
              },
            ]
          : []),
        ...(v.mode === 'publish'
          ? [{ key: 'permission', label: '本次公开发布授权记录' }]
          : []),
      ]}
      onSubmit={async (v) => {
        const asset = state.sliceAssets.find((a) => a.id === v.slice);
        const result = await save('/tasks', {
          scheduleId,
          sliceId: v.slice,
          bindingId: v.binding,
          mode: v.mode,
          captionText: v.caption,
          audience: 'public',
          aiLabel: v.ai === 'true',
          aiLabelReason: v.aiReason,
          taskTimeoutMs: 600000,
          madeForKids:
            account?.platform === 'youtube' ? v.kids === 'true' : undefined,
          rightsRef: asset?.rightsRef,
          musicRightsRef: v.music,
          publishAuthorizationRef:
            v.mode === 'publish' ? v.permission : undefined,
        });
        await reload();
        await refresh();
        return result;
      }}
    />
  );
}
export function RuntimeDiagnostics() {
  const { status, reload } = useRuntimeStatus();
  return (
    <WebVerification
      options={status.verificationOptions}
      jobs={status.verifications ?? []}
      reload={reload}
    />
  );
}
export function RuntimeReceipts({
  exceptions = false,
  query = '',
  object = '',
}: {
  exceptions?: boolean;
  query?: string;
  object?: string;
}) {
  const { state, refresh, projectId } = useOperations();
  const { status: raw, error, reload } = useRuntimeStatus();
  const [selectedTask, setTaskFilter] = useState(object);
  // Receipt links may identify a publication attempt; resolve it to its runtime task.
  const taskFilter =
    raw.tasks.find((t) => t.task.directive.attemptId === selectedTask)
      ?.taskId ?? selectedTask;
  const [controlError, setControlError] = useState('');
  const pending = new Set([
    ...(raw.assistance ?? [])
      .filter((r) => r.status === 'waiting')
      .map((r) => r.taskId),
    ...(raw.supervision?.requests ?? [])
      .filter((r) => r.status === 'waiting')
      .map((r) => r.taskId),
  ]);
  const tasks = raw.tasks.filter(
    (t) =>
      (!projectId || t.task.directive.projectId === projectId) &&
      (!exceptions ||
        ['blocked', 'failed', 'unknown'].includes(t.status) ||
        pending.has(t.taskId)) &&
      `${t.taskId} ${lookup(state, t.task.directive.contentIdentityId)} ${lookup(state, t.task.directive.accountId)} ${t.status}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const visibleOnboarding = (raw.onboarding ?? []).filter(
    (j) =>
      (!projectId || j.projectId === projectId) &&
      (!exceptions ||
        ['blocked', 'unknown', 'interrupted'].includes(j.status) ||
        pending.has(j.id)) &&
      `${j.name} ${j.id} ${j.status}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const onboarding = visibleOnboarding.filter(
    (j) => !taskFilter || taskFilter === j.id,
  );
  const inScope = (id: string) =>
    (!taskFilter || taskFilter === id) &&
    (tasks.some((t) => t.taskId === id) ||
      onboarding.some((j) => j.id === id) ||
      (!projectId && (!exceptions || pending.has(id))));
  const status = {
    ...raw,
    tasks: tasks.filter((t) => !taskFilter || t.taskId === taskFilter),
    assistance: raw.assistance?.filter(
      (r) => inScope(r.taskId) && (!exceptions || r.status === 'waiting'),
    ),
    supervision: raw.supervision && {
      controls: raw.supervision.controls.filter((r) => inScope(r.taskId)),
      requests: raw.supervision.requests.filter(
        (r) => inScope(r.taskId) && (!exceptions || r.status === 'waiting'),
      ),
      events: raw.supervision.events.filter((r) => inScope(r.taskId)),
    },
  };
  return (
    <Panel title={exceptions ? '需处理的任务与人工待办' : '任务进度与归档证据'}>
      <label className="op-task-filter">
        查看任务{' '}
        <select
          aria-label="查看任务"
          value={taskFilter}
          onChange={(e) => setTaskFilter(e.target.value)}
        >
          <option value="">全部任务</option>
          {tasks.map((t) => (
            <option key={t.taskId} value={t.taskId}>
              {lookup(state, t.task.directive.contentIdentityId)} · {t.status} ·{' '}
              {t.taskId.slice(0, 8)}
            </option>
          ))}
          {visibleOnboarding.map((j) => (
            <option key={j.id} value={j.id}>
              账号接入：{j.name} · {j.status} · {j.id.slice(0, 8)}
            </option>
          ))}
        </select>
      </label>
      {(() => {
        const lines: LogLine[] = [];
        for (const t of status.tasks) {
          lines.push({
            level: t.status === 'failed' || t.status === 'blocked' ? 'error' : 'info',
            message: `[任务快照] ${t.taskId.slice(0, 8)} | ${t.status} | ${t.task.settings.mode} | ${lookup(state, t.task.directive.contentIdentityId)}`,
          });
          for (const p of status.preparations.filter((prep) => prep.taskId === t.taskId)) {
            lines.push({
              level: 'warn',
              message: `[准备巡检] 阶段: ${p.phase} (已检查 ${p.checks} 次) | ${p.report?.reason ?? '无核验异常'}`,
            });
          }
          if (t.receipt) {
            lines.push({
              level: t.receipt.publishStatus === 'published' ? 'info' : 'error',
              message: `[执行回执] 状态: ${label(t.receipt.publishStatus)} ${t.receipt.failureCode ? `| 错误: ${t.receipt.failureCode}` : ''}`,
            });
          }
        }
        for (const e of [...(status.supervision?.events ?? [])].sort((a, b) => a.at.localeCompare(b.at))) {
          lines.push({
            timestamp: date(e.at),
            level: e.type === 'error' ? 'error' : 'info',
            message: `[协同事件] ${e.taskId.slice(0, 8)} ${e.type} ${e.code}`,
          });
        }
        return (
          <div className="my-3" role="log" aria-label="真实任务事件流" aria-live="polite">
            <TerminalStream
              title="Artemis 纯真机执行与协作事件流"
              lines={lines}
              healingLogs={status.tasks
                .filter((t) => t.receipt?.failureCode)
                .map((t) => `任务 ${t.taskId.slice(0, 8)} 状态码自愈尝试: ${t.receipt?.failureCode}`)}
            />
          </div>
        );
      })()}
      <OnboardingJobs jobs={onboarding} reload={reload} />
      <HumanAssistance challenges={status.assistance ?? []} reload={reload} />
      <AgentSupervision value={status.supervision} reload={reload} />
      {error && <Notice>{error}</Notice>}
      {controlError && <Notice>{controlError}</Notice>}
      {Array.from(
        new Set(
          status.bindings
            .filter(
              (b) =>
                !projectId ||
                state.accountServiceRelations.some(
                  (r) =>
                    r.projectId === projectId && r.accountId === b.accountId,
                ),
            )
            .map((b) => b.deviceId),
        ),
      ).map((deviceId) => {
        const held =
          status.deviceHolds?.some((h) => h.device === deviceId) ?? false;
        return (
          <button
            key={deviceId}
            type="button"
            onClick={async () => {
              try {
                await runtimeRequest('/device-control', {
                  deviceId,
                  held: !held,
                });
                setControlError('');
                await reload();
              } catch {
                setControlError(
                  '接管未完成：检查设备是否正在执行或检查中。接管成功后再进行人工登录。',
                );
              }
            }}
          >
            {deviceId}：{held ? '交还自动复查' : '申请人工接管'}
          </button>
        );
      })}
      <Notice>
        原任务请求密码时，使用上方人工登录协助表单，Artemis
        在同一任务内等待并继续判断。
        只有独立手工操作手机时才申请设备接管；登录不等于身份核验通过，必须核对绑定
        Page／频道的完整身份。
        账号不符请取消并由负责人重新分发；结果未知的发布任务不会自动重跑。
      </Notice>
      <List
        query=""
        columns={['内容 / 账号', '模式 / 任务状态', '发布事实', '原始证据']}
        rows={status.tasks.map((t) => ({
          id: t.taskId,
          search: '',
          cells: [
            <Link key="task" page="receipts" id={t.taskId}>
              {lookup(state, t.task.directive.contentIdentityId)} /{' '}
              {lookup(state, t.task.directive.accountId)}
            </Link>,
            `${t.task.settings.mode} / ${t.status}`,
            t.receipt ? label(t.receipt.publishStatus) : '尚未收到回执',
            <div key="e">
              {status.preparations
                ?.filter((p) => p.taskId === t.taskId)
                .map((p) => (
                  <p key={p.taskId}>
                    准备阶段：{p.phase}；复查 {p.checks} 次；{p.report?.reason}{' '}
                    {p.report?.detailCode}。
                    {p.phase === 'waiting' &&
                      `下次可检查：${date(p.nextCheckAt)}。请账号负责人核对绑定 Page／频道、处理登录或验证码，并在目标 App 显示完整身份链接；不会自动切换账号。`}
                  </p>
                ))}
              {t.receipt?.actionRequired && (
                <p>
                  待
                  {t.receipt.actionRequired.kind === 'account'
                    ? '账号'
                    : '设备'}
                  负责人处理：{t.receipt.actionRequired.reason}。
                  {t.receipt.actionRequired.expectedIdentity &&
                    `预期身份：${t.receipt.actionRequired.expectedIdentity}；实际身份：${t.receipt.actionRequired.observedIdentity || '未能读取'}。`}
                  {t.receipt.actionRequired.nextAction}
                </p>
              )}
              {t.receipt?.evidenceRefs.map((ref, i) => (
                <a
                  key={ref}
                  href={`/api/runtime/evidence?id=${encodeURIComponent(ref)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  证据 {i + 1}{' '}
                </a>
              ))}
              {t.receipt?.publishedUrl && (
                <a
                  href={t.receipt.publishedUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  平台帖子
                </a>
              )}
            </div>,
          ],
        }))}
        empty="暂无设备任务"
      />
      {status.pauses.length > 0 && (
        <Notice>
          存在待核对的暂停范围：
          {status.pauses.map((p) => `${p.scope}（${p.reason}）`).join('；')}
          。设备重新上线不会自动解除暂停。
          {exceptions && <Link page="receipts">前往任务中心复核暂停范围</Link>}
        </Notice>
      )}
      {status.tasks
        .filter(
          (t) =>
            t.status === 'unknown' ||
            (t.status === 'blocked' && t.receipt?.actionRequired) ||
            (t.status === 'completed' &&
              t.receipt?.publishStatus === 'confirmed_not_published' &&
              status.pauses.some((pause) => [
                `device:${t.task.directive.deviceId}`,
                `account:${t.task.directive.accountId}`,
                `project:${t.task.directive.projectId}`,
                `content:${t.task.directive.contentIdentityId}`,
              ].includes(pause.scope))),
        )
        .map((t) => (
          <Form
            key={t.taskId}
            id={`review-${t.taskId}`}
            title={`${t.status === 'completed' ? '复核已确认未发布任务的暂停范围' : t.status === 'blocked' ? '处理执行前阻断' : '核对未知结果'}：${lookup(state, t.task.directive.contentIdentityId)}`}
            submit="保存核对并重新审查相关范围"
            fields={[
              {
                key: 'status',
                label: '核对结论',
                options:
                  t.status === 'blocked' &&
                  t.receipt?.publishStatus === 'not_submitted'
                    ? [
                        {
                          id: 'not_submitted',
                          name: '未提交；已处理配置问题，下一次执行仍须自动复核身份并重新批准',
                        },
                      ]
                    : [
                        { id: 'published', name: '已公开' },
                        {
                          id: 'confirmed_not_published',
                          name: '已核验本次未发布且没有在途操作',
                        },
                      ],
              },
              { key: 'evidence', label: '核对证据截图 PNG', type: 'file' },
              {
                key: 'url',
                label: '已公开帖子 URL',
                type: 'url',
                optional: true,
              },
              { key: 'reason', label: '核对过程与结论', type: 'textarea' },
              {
                key: 'scope',
                label: '关联范围与当前授权',
                options: [
                  {
                    id: 'reviewed',
                    name: '已核对设备、账号、服务、内容及当前授权',
                  },
                ],
              },
            ]}
            onSubmit={async (v, form) => {
              const file = new FormData(form).get('evidence');
              if (!(file instanceof File) || file.type !== 'image/png')
                return {
                  ok: false,
                  error: {
                    code: 'PNG_REQUIRED',
                    message: '请提供 PNG 核对截图',
                  },
                };
              const response = await fetch('/api/runtime/evidence', {
                method: 'POST',
                headers: { 'Content-Type': 'image/png', 'X-Task-Id': t.taskId },
                body: file,
              });
              if (!response.ok)
                return {
                  ok: false,
                  error: {
                    code: 'UPLOAD_FAILED',
                    message: '证据未归档，核对结果未保存',
                  },
                };
              const evidence = (await response.json()) as { id: string };
              const result = await save('/reviews', {
                taskId: t.taskId,
                publishStatus: v.status,
                evidenceRefs: [evidence.id],
                publishedUrl: v.url || undefined,
                reason: v.reason,
                relatedScopeReviewed: v.scope === 'reviewed',
                authorizationRechecked: v.scope === 'reviewed',
              });
              await reload();
              await refresh();
              return result;
            }}
          />
        ))}
    </Panel>
  );
}
export function LegacyWorkspace() {
  const { refresh } = useOperations();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Panel title="原浏览器工作区">
      <Notice>
        原始浏览器记录继续保留。迁移只允许写入空的执行服务，素材会逐个上传；旧批准与排期需重新核对，历史发布事实保留。
      </Notice>
      <button
        className="op-button"
        onClick={() => {
          const text = localStorage.getItem(FIRST_LOOP_STORAGE_KEY);
          if (!text) {
            setMessage('当前浏览器没有旧工作区');
            return;
          }
          const url = URL.createObjectURL(
            new Blob([text], { type: 'application/json' }),
          );
          const a = document.createElement('a');
          a.href = url;
          a.download = 'socialgrowth-legacy-workspace.json';
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}
      >
        导出原工作区备份
      </button>{' '}
      <button
        className="op-button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const state = loadFirstLoopState(localStorage);
            if (!state.clients.length && !state.projects.length)
              throw new Error('当前浏览器没有旧业务记录');
            for (const asset of state.sliceAssets) {
              const url = await assetUrl(asset.fileRef);
              if (!url)
                throw new Error(`找不到原素材 ${asset.id}，尚未迁移业务记录`);
              try {
                const response = await fetch(url);
                if (!response.ok) throw new Error('素材读取失败');
                const blob = await response.blob();
                const stored = await storeAsset(
                  new File([blob], `${asset.sha256}.mp4`, {
                    type: 'video/mp4',
                  }),
                );
                if (stored.sha256 !== asset.sha256)
                  throw new Error('原素材哈希不匹配');
                asset.fileRef = stored.fileRef;
              } finally {
                if (url.startsWith('blob:')) URL.revokeObjectURL(url);
              }
            }
            const result = await save('/import', state);
            if (!result.ok) throw new Error(result.error?.message);
            await refresh();
            setMessage('迁移完成，原浏览器记录保留。请重新批准和排期。');
          } catch (error) {
            setMessage(error instanceof Error ? error.message : '迁移未完成');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? '迁移中…' : '迁移到空执行服务'}
      </button>
      {message && <output>{message}</output>}
    </Panel>
  );
}
