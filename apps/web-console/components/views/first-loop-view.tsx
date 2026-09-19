'use client';

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Database,
  FileWarning,
  LockKeyhole,
  PlugZap,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useFirstLoop } from '@/lib/first-loop/context';

export type OperationsSection =
  | 'overview'
  | 'projects'
  | 'content'
  | 'strategy'
  | 'execution'
  | 'review'
  | 'audit';
type Notice = { kind: 'info' | 'error' | 'success'; text: string };

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-xs font-medium text-slate-700">
      <span>{label}</span>
      {children}
      {hint && (
        <span className="mt-1 block text-[11px] font-normal leading-4 text-slate-500">
          {hint}
        </span>
      )}
    </label>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-xs text-slate-500">
      {children}
    </div>
  );
}
function idName(id: string, projects: Array<{ id: string; name: string }>) {
  return projects.find((item) => item.id === id)?.name ?? id;
}

export function FirstLoopView({ section }: { section: OperationsSection }) {
  const api = useFirstLoop();
  const { state, activeProjectId, selectProject } = api;
  const [notice, setNotice] = useState<Notice>({
    kind: 'info',
    text: '所有写操作都会记录审计日志；生产发布需要外部执行器和回执。',
  });
  const [project, setProject] = useState({
    name: '',
    clientId: '',
    primaryGoal: '',
    audience: '',
    ownerId: '',
  });
  const [relation, setRelation] = useState({
    accountId: '',
    clientId: '',
    ownerPartyId: '',
    authorizerPartyId: '',
    authorizationRef: '',
    sharedApprovalRef: '',
    validUntil: '',
  });
  const [content, setContent] = useState({
    identityId: '',
    title: '',
    sourceRef: '',
    storySummary: '',
    language: 'en-US',
    fileRef: '',
    sha256: '',
    rightsRef: '',
  });
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [destination, setDestination] = useState({
    accountId: '',
    scopeId: '',
    url: '',
    maintenancePermissionRef: '',
  });
  const [strategy, setStrategy] = useState({
    statement: '',
    sourceRef: '',
    rationale: '',
  });
  const [approvalInputs, setApprovalInputs] = useState<
    Record<
      string,
      { quantity: string; validUntil: string; stop: string; observe: string }
    >
  >({});
  const [scheduleInputs, setScheduleInputs] = useState<
    Record<
      string,
      { scheduledFor: string; expiresAt: string; timezone: string }
    >
  >({});
  const [observation, setObservation] = useState({
    approvalId: '',
    metricKey: '',
    availability: 'observed_value',
    value: '',
    source: '',
    unit: '',
    scope: '',
    windowStart: '',
    windowEnd: '',
    comparisonRole: 'current',
  });
  const [reviewChecks, setReviewChecks] = useState({
    requiredWorkComplete: false,
    sourceComparisonAccepted: false,
  });

  const scoped = <T extends { projectId: string }>(items: T[]) =>
    activeProjectId
      ? items.filter((item) => item.projectId === activeProjectId)
      : items;
  const relations = scoped(state.accountServiceRelations).filter(
    (item) => !item.revokedAt,
  );
  const destinations = scoped(state.destinationEntries);
  const drafts = scoped(state.strategyDrafts);
  const approvals = scoped(state.executionApprovals);
  const reviews = scoped(state.basicReviews);
  const authorizedAccounts = useMemo(
    () =>
      Array.from(
        new Set(
          relations
            .filter((item) => item.allowedActions.includes('publish'))
            .map((item) => item.accountId),
        ),
      ),
    [relations],
  );
  const fail = (result: { error?: { code: string; message: string } }) =>
    setNotice({
      kind: 'error',
      text: `${result.error?.code ?? 'OPERATION_FAILED'}：${result.error?.message ?? '操作未完成'}`,
    });
  const ok = (text: string) => setNotice({ kind: 'success', text });

  const noticeClass =
    notice.kind === 'error'
      ? 'border-rose-200 bg-rose-50 text-rose-800'
      : notice.kind === 'success'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
        : 'border-blue-200 bg-blue-50 text-blue-800';

  const Overview = () => {
    const projectsWithGaps = state.projects.filter(
      (item) => api.projectGaps(item.id).length > 0,
    ).length;
    const unallocated = state.contentIdentities.filter(
      (item) => item.allocationStatus === 'unallocated',
    ).length;
    const unknown = state.publicationAttempts.filter(
      (item) => item.publishStatus === 'unknown',
    ).length;
    const pendingReviews = state.basicReviews.filter(
      (item) => !item.confirmedAt,
    ).length;
    return (
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            [
              '资料待补项目',
              projectsWithGaps,
              '补齐客户、目标、受众与责任人后方可激活',
            ],
            ['未分配内容', unallocated, '内容只可分配给当前有效授权账号'],
            ['状态未知回执', unknown, '不得按已发布或失败处理'],
            ['待确认复盘', pendingReviews, '人工确认后续动作，系统不自动放大'],
          ].map(([label, value, hint]) => (
            <div
              key={String(label)}
              className="rounded-lg border border-slate-200 bg-slate-50 p-4"
            >
              <p className="text-xs font-medium text-slate-600">{label}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-950">
                {value}
              </p>
              <p className="mt-2 text-[11px] leading-4 text-slate-500">
                {hint}
              </p>
            </div>
          ))}
        </div>
        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">项目就绪情况</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {state.projects.length === 0 ? (
                <Empty>先在“项目与授权”创建项目草稿。</Empty>
              ) : (
                state.projects.map((item) => {
                  const gaps = api.projectGaps(item.id);
                  return (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => selectProject(item.id)}
                      className="flex w-full items-start justify-between gap-3 rounded-md border border-slate-200 p-3 text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-500"
                    >
                      <div>
                        <strong className="text-xs">{item.name}</strong>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {gaps.length
                            ? `待补：${gaps.join('、')}`
                            : '资料完整，可继续授权与内容准入。'}
                        </p>
                      </div>
                      <Badge variant="outline">{item.status}</Badge>
                    </button>
                  );
                })
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">外部连接边界</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
                <PlugZap className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  未配置平台账号、设备执行器与真实指标数据源。当前页面只能完成受控业务记录和审计。
                </p>
              </div>
              <p className="text-slate-500">
                执行页只展示批准、排期和回执事实，不提供虚假的
                Ping、修复、上线或发布成功按钮。
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  };

  const Projects = () => (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">创建项目草稿</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              const result = api.saveProject(project);
              if (!result.ok) return fail(result);
              selectProject(result.value!.id);
              setProject({
                name: '',
                clientId: '',
                primaryGoal: '',
                audience: '',
                ownerId: '',
              });
              ok(`项目“${result.value!.name}”已保存，并设为当前项目。`);
            }}
          >
            <Field label="项目名称">
              <Input
                required
                value={project.name}
                onChange={(e) =>
                  setProject({ ...project, name: e.target.value })
                }
              />
            </Field>
            <Field label="服务客户 ID">
              <Input
                required
                value={project.clientId}
                onChange={(e) =>
                  setProject({ ...project, clientId: e.target.value })
                }
              />
            </Field>
            <Field label="当前主目标">
              <Input
                required
                value={project.primaryGoal}
                onChange={(e) =>
                  setProject({ ...project, primaryGoal: e.target.value })
                }
              />
            </Field>
            <Field label="目标受众">
              <Input
                required
                value={project.audience}
                onChange={(e) =>
                  setProject({ ...project, audience: e.target.value })
                }
              />
            </Field>
            <Field label="责任人 ID">
              <Input
                required
                value={project.ownerId}
                onChange={(e) =>
                  setProject({ ...project, ownerId: e.target.value })
                }
              />
            </Field>
            <div className="flex items-end">
              <Button className="w-full" type="submit">
                保存项目草稿
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">记录账号服务授权</CardTitle>
        </CardHeader>
        <CardContent>
          {!activeProjectId ? (
            <Empty>先选择当前项目。</Empty>
          ) : (
            <form
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                const result = api.grantAccountServiceRelation({
                  projectId: activeProjectId,
                  ...relation,
                  allowedActions: ['publish'],
                  allowedData: ['public_metrics'],
                  validFrom: new Date().toISOString(),
                  validUntil: relation.validUntil
                    ? new Date(relation.validUntil).toISOString()
                    : undefined,
                  sharedApprovalRef: relation.sharedApprovalRef || undefined,
                });
                if (!result.ok) return fail(result);
                setRelation({
                  accountId: '',
                  clientId: '',
                  ownerPartyId: '',
                  authorizerPartyId: '',
                  authorizationRef: '',
                  sharedApprovalRef: '',
                  validUntil: '',
                });
                ok('授权关系已记录；发布动作与公开指标访问范围已显式保存。');
              }}
            >
              <Field label="账号 ID">
                <Input
                  required
                  value={relation.accountId}
                  onChange={(e) =>
                    setRelation({ ...relation, accountId: e.target.value })
                  }
                />
              </Field>
              <Field label="服务客户 ID">
                <Input
                  required
                  value={relation.clientId}
                  onChange={(e) =>
                    setRelation({ ...relation, clientId: e.target.value })
                  }
                />
              </Field>
              <Field label="账号所有方 ID">
                <Input
                  required
                  value={relation.ownerPartyId}
                  onChange={(e) =>
                    setRelation({ ...relation, ownerPartyId: e.target.value })
                  }
                />
              </Field>
              <Field label="授权方 ID">
                <Input
                  required
                  value={relation.authorizerPartyId}
                  onChange={(e) =>
                    setRelation({
                      ...relation,
                      authorizerPartyId: e.target.value,
                    })
                  }
                />
              </Field>
              <Field label="授权依据引用">
                <Input
                  required
                  value={relation.authorizationRef}
                  onChange={(e) =>
                    setRelation({
                      ...relation,
                      authorizationRef: e.target.value,
                    })
                  }
                />
              </Field>
              <Field label="共享批准引用" hint="仅在存在共享批准时填写">
                <Input
                  value={relation.sharedApprovalRef}
                  onChange={(e) =>
                    setRelation({
                      ...relation,
                      sharedApprovalRef: e.target.value,
                    })
                  }
                />
              </Field>
              <Field label="授权有效期" hint="留空表示未记录截止日期">
                <Input
                  type="datetime-local"
                  value={relation.validUntil}
                  onChange={(e) =>
                    setRelation({ ...relation, validUntil: e.target.value })
                  }
                />
              </Field>
              <div className="flex items-end">
                <Button className="w-full" type="submit">
                  记录授权
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle className="text-sm">项目清单</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {state.projects.map((item) => {
            const gaps = api.projectGaps(item.id);
            return (
              <div
                key={item.id}
                className="rounded-md border border-slate-200 p-3 text-xs"
              >
                <div className="flex justify-between gap-2">
                  <strong>{item.name}</strong>
                  <Badge variant="outline">{item.status}</Badge>
                </div>
                <p className="mt-2 text-slate-500">
                  {gaps.length ? `待补：${gaps.join('、')}` : '资料完整'}
                </p>
                <p className="mt-1 font-mono text-[11px] text-slate-400">
                  {item.id}
                </p>
                {gaps.length === 0 && item.status === 'draft' && (
                  <Button
                    size="sm"
                    className="mt-3 h-8"
                    onClick={() => {
                      const result = api.activateProject(item.id);
                      if (result.ok) ok('项目已激活。');
                      else fail(result);
                    }}
                  >
                    激活项目
                  </Button>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );

  const Content = () => (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">内容身份与文件版本准入</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"
            onSubmit={(event) => {
              event.preventDefault();
              const result = api.addContent(content);
              if (!result.ok) return fail(result);
              setContent({
                identityId: '',
                title: '',
                sourceRef: '',
                storySummary: '',
                language: 'en-US',
                fileRef: '',
                sha256: '',
                rightsRef: '',
              });
              ok(
                `内容身份 ${result.value!.identity.id} 已准入；尚未分配或发布。`,
              );
            }}
          >
            <Field label="已有内容身份 ID" hint="新增语言或文件版本时填写">
              <Input
                value={content.identityId}
                onChange={(e) =>
                  setContent({ ...content, identityId: e.target.value })
                }
              />
            </Field>
            <Field label="内容标题">
              <Input
                required
                value={content.title}
                onChange={(e) =>
                  setContent({ ...content, title: e.target.value })
                }
              />
            </Field>
            <Field label="来源引用">
              <Input
                required
                value={content.sourceRef}
                onChange={(e) =>
                  setContent({ ...content, sourceRef: e.target.value })
                }
              />
            </Field>
            <Field label="剧情范围说明">
              <Input
                required
                value={content.storySummary}
                onChange={(e) =>
                  setContent({ ...content, storySummary: e.target.value })
                }
              />
            </Field>
            <Field label="语言">
              <Input
                required
                value={content.language}
                onChange={(e) =>
                  setContent({ ...content, language: e.target.value })
                }
              />
            </Field>
            <Field label="受控文件引用">
              <Input
                required
                value={content.fileRef}
                onChange={(e) =>
                  setContent({ ...content, fileRef: e.target.value })
                }
              />
            </Field>
            <Field label="SHA-256" hint="64 位文件指纹">
              <Input
                required
                minLength={64}
                maxLength={64}
                value={content.sha256}
                onChange={(e) =>
                  setContent({ ...content, sha256: e.target.value })
                }
              />
            </Field>
            <Field label="权利依据引用">
              <Input
                required
                value={content.rightsRef}
                onChange={(e) =>
                  setContent({ ...content, rightsRef: e.target.value })
                }
              />
            </Field>
            <div className="xl:col-span-4">
              <Button type="submit">准入内容与文件</Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <div className="grid gap-3 md:grid-cols-2">
        {state.contentIdentities.length === 0 ? (
          <Empty>尚无已准入内容。</Empty>
        ) : (
          state.contentIdentities.map((item) => (
            <div
              key={item.id}
              className="rounded-md border border-slate-200 p-4 text-xs"
            >
              <div className="flex justify-between gap-2">
                <strong>{item.title}</strong>
                <Badge variant="outline">{item.allocationStatus}</Badge>
              </div>
              <p className="mt-2 text-slate-500">
                {
                  state.sliceAssets.filter(
                    (asset) => asset.contentIdentityId === item.id,
                  ).length
                }{' '}
                个文件版本 · v{item.allocationVersion}
              </p>
              {item.assignedAccountId ? (
                <p className="mt-3 font-medium text-amber-700">
                  <LockKeyhole className="mr-1 inline h-3.5 w-3.5" />
                  独占账号 {item.assignedAccountId}
                </p>
              ) : (
                <div className="mt-3 flex gap-2">
                  <select
                    aria-label={`为${item.title}选择授权账号`}
                    className="h-9 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2"
                    value={allocations[item.id] ?? ''}
                    onChange={(e) =>
                      setAllocations({
                        ...allocations,
                        [item.id]: e.target.value,
                      })
                    }
                  >
                    <option value="">选择当前项目授权账号</option>
                    {authorizedAccounts.map((account) => (
                      <option key={account} value={account}>
                        {account}
                      </option>
                    ))}
                  </select>
                  <Button
                    disabled={!allocations[item.id]}
                    onClick={() => {
                      const result = api.allocateContent(
                        item.id,
                        allocations[item.id],
                        item.allocationVersion,
                      );
                      if (result.ok)
                        ok(`内容已独占分配给 ${allocations[item.id]}。`);
                      else fail(result);
                    }}
                  >
                    分配
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );

  const Strategy = () => (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">共享导流入口</CardTitle>
        </CardHeader>
        <CardContent>
          {!activeProjectId ? (
            <Empty>先选择当前项目。</Empty>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                const result = api.createDestination({
                  projectId: activeProjectId,
                  ...destination,
                  scope: 'channel',
                  sharedAttribution: true,
                  exitPolicy: 'continue',
                });
                if (!result.ok) return fail(result);
                setDestination({
                  accountId: '',
                  scopeId: '',
                  url: '',
                  maintenancePermissionRef: '',
                });
                ok(
                  '入口及首个版本已保存；健康状态仅表示本地准入，不表示真实访问成功。',
                );
              }}
            >
              <Field label="授权账号">
                <select
                  required
                  className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs"
                  value={destination.accountId}
                  onChange={(e) =>
                    setDestination({
                      ...destination,
                      accountId: e.target.value,
                    })
                  }
                >
                  <option value="">选择账号</option>
                  {authorizedAccounts.map((account) => (
                    <option key={account}>{account}</option>
                  ))}
                </select>
              </Field>
              <Field label="频道或范围 ID">
                <Input
                  required
                  value={destination.scopeId}
                  onChange={(e) =>
                    setDestination({ ...destination, scopeId: e.target.value })
                  }
                />
              </Field>
              <Field label="实际目的地 URL">
                <Input
                  required
                  type="url"
                  value={destination.url}
                  onChange={(e) =>
                    setDestination({ ...destination, url: e.target.value })
                  }
                />
              </Field>
              <Field label="维护权限依据">
                <Input
                  required
                  value={destination.maintenancePermissionRef}
                  onChange={(e) =>
                    setDestination({
                      ...destination,
                      maintenancePermissionRef: e.target.value,
                    })
                  }
                />
              </Field>
              <p className="rounded-md bg-slate-50 p-2 text-[11px] text-slate-500">
                固定业务规则：频道级共享归因；项目退出后继续维护。单条内容不伪分摊共享入口数据。
              </p>
              <Button type="submit">保存入口</Button>
            </form>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">规则与受控草案</CardTitle>
        </CardHeader>
        <CardContent>
          {!activeProjectId ? (
            <Empty>先选择当前项目。</Empty>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                const rule = api.addStrategyRule({
                  projectId: activeProjectId,
                  category: 'internal_rule',
                  statement: strategy.statement,
                  sourceRef: strategy.sourceRef,
                });
                if (!rule.ok) return fail(rule);
                const result = api.generateStrategyDraft({
                  projectId: activeProjectId,
                  outputMode: 'controlled',
                  rationale: strategy.rationale,
                  assumptions: ['未调用真实 AI Provider'],
                });
                if (!result.ok) return fail(result);
                setStrategy({ statement: '', sourceRef: '', rationale: '' });
                ok(`受控草案 ${result.value!.id} 已生成，仍需明确批准边界。`);
              }}
            >
              <Field label="规则陈述">
                <Input
                  required
                  value={strategy.statement}
                  onChange={(e) =>
                    setStrategy({ ...strategy, statement: e.target.value })
                  }
                />
              </Field>
              <Field label="规则来源引用">
                <Input
                  required
                  value={strategy.sourceRef}
                  onChange={(e) =>
                    setStrategy({ ...strategy, sourceRef: e.target.value })
                  }
                />
              </Field>
              <Field label="草案依据说明">
                <Input
                  required
                  value={strategy.rationale}
                  onChange={(e) =>
                    setStrategy({ ...strategy, rationale: e.target.value })
                  }
                />
              </Field>
              <Button type="submit">生成受控草案</Button>
            </form>
          )}
        </CardContent>
      </Card>
      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle className="text-sm">当前入口与草案</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {destinations.map((entry) => {
            const version = state.destinationVersions.find(
              (item) => item.id === entry.activeVersionId,
            );
            return (
              <div
                key={entry.id}
                className="rounded-md border border-slate-200 p-3 text-xs"
              >
                <strong>{entry.scopeId}</strong>
                <p className="mt-1 break-all text-slate-500">{version?.url}</p>
                <p className="mt-1 text-slate-500">
                  本地状态：{version?.health} ·{' '}
                  {version?.isActive ? '活动版本' : '停用'}
                </p>
              </div>
            );
          })}
          {drafts.map((draft) => (
            <div
              key={draft.id}
              className="rounded-md border border-slate-200 p-3 text-xs"
            >
              <strong>草案 v{draft.version}</strong>
              <p className="mt-1 text-slate-500">{draft.rationale}</p>
                    <p className="mt-1 font-mono text-[11px] text-slate-400">
                {draft.id}
              </p>
            </div>
          ))}
          {destinations.length + drafts.length === 0 && (
            <Empty>尚无入口或策略草案。</Empty>
          )}
        </CardContent>
      </Card>
    </div>
  );

  const Execution = () => (
    <div className="space-y-5">
      <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <p>
          外部执行器未配置。批准和排期仅建立可审计边界，不代表已下发、设备在线或已发布。
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {drafts.length === 0 ? (
          <Empty>当前项目尚无可批准草案。</Empty>
        ) : (
          drafts.map((draft) => {
            const values = approvalInputs[draft.id] ?? {
              quantity: '',
              validUntil: '',
              stop: '',
              observe: '',
            };
            return (
              <Card key={draft.id}>
                <CardHeader>
                  <CardTitle className="text-sm">
                    草案 v{draft.version}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-slate-500">{draft.rationale}</p>
                  <Field label="本批批准数量">
                    <Input
                      min="1"
                      required
                      type="number"
                      value={values.quantity}
                      onChange={(e) =>
                        setApprovalInputs({
                          ...approvalInputs,
                          [draft.id]: { ...values, quantity: e.target.value },
                        })
                      }
                    />
                  </Field>
                  <Field label="批准有效期">
                    <Input
                      required
                      type="datetime-local"
                      value={values.validUntil}
                      onChange={(e) =>
                        setApprovalInputs({
                          ...approvalInputs,
                          [draft.id]: { ...values, validUntil: e.target.value },
                        })
                      }
                    />
                  </Field>
                  <Field label="停止条件">
                    <Input
                      required
                      value={values.stop}
                      onChange={(e) =>
                        setApprovalInputs({
                          ...approvalInputs,
                          [draft.id]: { ...values, stop: e.target.value },
                        })
                      }
                    />
                  </Field>
                  <Field label="观察条件">
                    <Input
                      required
                      value={values.observe}
                      onChange={(e) =>
                        setApprovalInputs({
                          ...approvalInputs,
                          [draft.id]: { ...values, observe: e.target.value },
                        })
                      }
                    />
                  </Field>
                  <Button
                    onClick={() => {
                      const result = api.approveStrategy({
                        strategyDraftId: draft.id,
                        expectedStrategyVersion: draft.version,
                        quantity: Number(values.quantity),
                        validFrom: new Date().toISOString(),
                        validUntil: values.validUntil
                          ? new Date(values.validUntil).toISOString()
                          : '',
                        stopConditions: [values.stop],
                        observationConditions: [values.observe],
                      });
                      if (result.ok)
                        ok(`批准 ${result.value!.id} 已记录；尚未执行。`);
                      else fail(result);
                    }}
                  >
                    记录批准
                  </Button>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">批准、排期与回执</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {approvals.length === 0 ? (
            <Empty>尚无执行批准。</Empty>
          ) : (
            approvals.map((item) => {
              const values = scheduleInputs[item.id] ?? {
                scheduledFor: '',
                expiresAt: '',
                timezone: 'Asia/Shanghai',
              };
              const schedules = state.publicationSchedules.filter(
                (schedule) => schedule.approvalId === item.id,
              );
              return (
                <div
                  key={item.id}
                  className="rounded-md border border-slate-200 p-3 text-xs"
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <strong>批准 {item.id}</strong>
                    <Badge variant="outline">{item.status}</Badge>
                  </div>
                  <p className="mt-1 text-slate-500">
                    数量 {item.quantity} · 停止：
                    {item.stopConditions.join('；')} · 观察：
                    {item.observationConditions.join('；')}
                  </p>
                  {schedules.map((schedule) => (
                    <p
                      key={schedule.id}
                      className="mt-2 rounded bg-slate-50 p-2 text-slate-600"
                    >
                      排期 {new Date(schedule.scheduledFor).toLocaleString()} ·{' '}
                      {schedule.businessTimezone} · {schedule.status}
                    </p>
                  ))}
                  {schedules.length === 0 && (
                    <div className="mt-3 grid gap-2 md:grid-cols-4">
                      <Field label="业务时区">
                        <Input
                          value={values.timezone}
                          onChange={(e) =>
                            setScheduleInputs({
                              ...scheduleInputs,
                              [item.id]: {
                                ...values,
                                timezone: e.target.value,
                              },
                            })
                          }
                        />
                      </Field>
                      <Field label="计划时间">
                        <Input
                          type="datetime-local"
                          value={values.scheduledFor}
                          onChange={(e) =>
                            setScheduleInputs({
                              ...scheduleInputs,
                              [item.id]: {
                                ...values,
                                scheduledFor: e.target.value,
                              },
                            })
                          }
                        />
                      </Field>
                      <Field label="排期过期时间">
                        <Input
                          type="datetime-local"
                          value={values.expiresAt}
                          onChange={(e) =>
                            setScheduleInputs({
                              ...scheduleInputs,
                              [item.id]: {
                                ...values,
                                expiresAt: e.target.value,
                              },
                            })
                          }
                        />
                      </Field>
                      <div className="flex items-end">
                        <Button
                          variant="outline"
                          onClick={() => {
                            const result = api.scheduleApproval({
                              approvalId: item.id,
                              businessTimezone: values.timezone,
                              scheduledFor: values.scheduledFor
                                ? new Date(values.scheduledFor).toISOString()
                                : '',
                              expiresAt: values.expiresAt
                                ? new Date(values.expiresAt).toISOString()
                                : '',
                            });
                            if (result.ok)
                              ok('排期已记录；仍未下发外部执行器。');
                            else fail(result);
                          }}
                        >
                          保存排期
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
            <div className="flex items-center gap-2 font-medium">
              <CircleDashed className="h-4 w-4 text-slate-500" />
              外部回执
            </div>
            <p className="mt-1 text-slate-500">
              当前无 Web
              端伪造回执入口。后续执行器必须按内容、文件、账号和证据引用写入回执；状态未知将继续显示为未知。
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const Review = () => (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">记录指标观察</CardTitle>
        </CardHeader>
        <CardContent>
          {!activeProjectId ? (
            <Empty>先选择当前项目。</Empty>
          ) : (
            <form
              className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"
              onSubmit={(event) => {
                event.preventDefault();
                const approval = approvals.find(
                  (item) => item.id === observation.approvalId,
                );
                if (!approval)
                  return setNotice({
                    kind: 'error',
                    text: '请选择当前项目的有效批准。',
                  });
                const needsValue = ['observed_value', 'observed_zero'].includes(
                  observation.availability,
                );
                if (
                  observation.availability === 'observed_value' &&
                  observation.value.trim() === ''
                )
                  return setNotice({
                    kind: 'error',
                    text: '已观察数值不能为空；如实际为零，请选择“真实零值”。',
                  });
                const result = api.recordMetricObservation({
                  projectId: activeProjectId,
                  approvalId: approval.id,
                  strategyVersion: approval.strategyVersion,
                  metricKey: observation.metricKey,
                  value: needsValue
                    ? observation.availability === 'observed_zero'
                      ? 0
                      : Number(observation.value)
                    : undefined,
                  availability: observation.availability as
                    | 'observed_value'
                    | 'observed_zero'
                    | 'missing'
                    | 'delayed'
                    | 'unauthorized',
                  source: observation.source,
                  unit: observation.unit,
                  scope: observation.scope,
                  windowStart: observation.windowStart
                    ? new Date(observation.windowStart).toISOString()
                    : '',
                  windowEnd: observation.windowEnd
                    ? new Date(observation.windowEnd).toISOString()
                    : '',
                  comparisonRole: observation.comparisonRole as
                    | 'baseline'
                    | 'current',
                  controlledData: true,
                });
                if (result.ok) ok('观察已记录，受控数据标记保持可见。');
                else fail(result);
              }}
            >
              <Field label="执行批准">
                <select
                  required
                  className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs"
                  value={observation.approvalId}
                  onChange={(e) =>
                    setObservation({
                      ...observation,
                      approvalId: e.target.value,
                    })
                  }
                >
                  <option value="">选择批准</option>
                  {approvals.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.id} · v{item.strategyVersion}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="主指标键">
                <Input
                  required
                  value={observation.metricKey}
                  onChange={(e) =>
                    setObservation({
                      ...observation,
                      metricKey: e.target.value,
                    })
                  }
                />
              </Field>
              <Field label="数据可用性">
                <select
                  className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs"
                  value={observation.availability}
                  onChange={(e) =>
                    setObservation({
                      ...observation,
                      availability: e.target.value,
                    })
                  }
                >
                  <option value="observed_value">已观察数值</option>
                  <option value="observed_zero">真实零值</option>
                  <option value="missing">缺失</option>
                  <option value="delayed">延迟</option>
                  <option value="unauthorized">无权限</option>
                </select>
              </Field>
              <Field label="数值" hint="不可用状态留空">
                <Input
                  disabled={
                    !['observed_value', 'observed_zero'].includes(
                      observation.availability,
                    )
                  }
                  value={observation.value}
                  onChange={(e) =>
                    setObservation({ ...observation, value: e.target.value })
                  }
                />
              </Field>
              <Field label="来源">
                <Input
                  required
                  value={observation.source}
                  onChange={(e) =>
                    setObservation({ ...observation, source: e.target.value })
                  }
                />
              </Field>
              <Field label="单位">
                <Input
                  required
                  value={observation.unit}
                  onChange={(e) =>
                    setObservation({ ...observation, unit: e.target.value })
                  }
                />
              </Field>
              <Field label="观察范围">
                <Input
                  required
                  value={observation.scope}
                  onChange={(e) =>
                    setObservation({ ...observation, scope: e.target.value })
                  }
                />
              </Field>
              <Field label="比较角色">
                <select
                  className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs"
                  value={observation.comparisonRole}
                  onChange={(e) =>
                    setObservation({
                      ...observation,
                      comparisonRole: e.target.value,
                    })
                  }
                >
                  <option value="baseline">基线</option>
                  <option value="current">当前</option>
                </select>
              </Field>
              <Field label="观察窗开始">
                <Input
                  required
                  type="datetime-local"
                  value={observation.windowStart}
                  onChange={(e) =>
                    setObservation({
                      ...observation,
                      windowStart: e.target.value,
                    })
                  }
                />
              </Field>
              <Field label="观察窗结束">
                <Input
                  required
                  type="datetime-local"
                  value={observation.windowEnd}
                  onChange={(e) =>
                    setObservation({
                      ...observation,
                      windowEnd: e.target.value,
                    })
                  }
                />
              </Field>
              <div className="flex items-end">
                <Button type="submit">记录观察</Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">生成基础复盘</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-2 text-xs">
            <input
              id="required-work-complete"
              type="checkbox"
              className="mt-0.5"
              checked={reviewChecks.requiredWorkComplete}
              onChange={(e) =>
                setReviewChecks({
                  ...reviewChecks,
                  requiredWorkComplete: e.target.checked,
                })
              }
            />
            <label htmlFor="required-work-complete">
              <strong>必需工作已完成</strong>
              <span className="block text-slate-500">
                未勾选时复盘会明确标为工作未完成。
              </span>
            </label>
          </div>
          <div className="flex items-start gap-2 text-xs">
            <input
              id="source-comparison-accepted"
              type="checkbox"
              className="mt-0.5"
              checked={reviewChecks.sourceComparisonAccepted}
              onChange={(e) =>
                setReviewChecks({
                  ...reviewChecks,
                  sourceComparisonAccepted: e.target.checked,
                })
              }
            />
            <label htmlFor="source-comparison-accepted">
              <strong>已确认不同来源可比</strong>
              <span className="block text-slate-500">
                只有来源变化且已完成核查时勾选。
              </span>
            </label>
          </div>
          <Button
            variant="outline"
            disabled={
              !activeProjectId ||
              !observation.approvalId ||
              !observation.metricKey
            }
            onClick={() => {
              const result = api.createBasicReview({
                projectId: activeProjectId,
                approvalId: observation.approvalId,
                primaryMetricKey: observation.metricKey,
                ...reviewChecks,
              });
              if (result.ok) ok(`复盘结果：${result.value!.outcome}`);
              else fail(result);
            }}
          >
            按当前事实生成复盘
          </Button>
          <div className="space-y-2">
            {reviews.map((item) => (
              <div
                key={item.id}
                className="rounded-md border border-slate-200 p-3 text-xs"
              >
                <div className="flex justify-between gap-2">
                  <strong>{item.outcome}</strong>
                  {item.confirmedAt ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <FileWarning className="h-4 w-4 text-amber-600" />
                  )}
                </div>
                <p className="mt-1 text-slate-500">{item.aiAnalysis}</p>
                {!item.confirmedAt && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(
                      [
                        'stop',
                        'continue_observation',
                        'create_new_draft',
                      ] as const
                    ).map((action) => (
                      <Button
                        key={action}
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const result = api.confirmReview(item.id, action);
                          if (result.ok) ok(`后续动作已人工确认为 ${action}。`);
                          else fail(result);
                        }}
                      >
                        {action}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const Audit = () => (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Database className="h-4 w-4" />
        最近记录优先；拒绝操作也会保留原因码。
      </div>
      {state.auditLogs.length === 0 ? (
        <Empty>尚无审计日志。</Empty>
      ) : (
        [...state.auditLogs].reverse().map((entry) => (
          <div
            key={entry.id}
            className="grid gap-2 rounded-md border border-slate-200 p-3 text-xs md:grid-cols-[160px_1fr_auto]"
          >
            <time className="font-mono text-[11px] text-slate-500">
              {new Date(entry.timestamp).toLocaleString()}
            </time>
            <div>
              <strong>{entry.action}</strong>
              <p className="mt-1 break-all text-slate-500">
                {entry.entityType} · {entry.entityId} · {entry.reasonCode}
              </p>
            </div>
            <Badge
              variant="outline"
              className={
                entry.result === 'accepted'
                  ? 'border-emerald-200 text-emerald-700'
                  : 'border-rose-200 text-rose-700'
              }
            >
              {entry.result}
            </Badge>
          </div>
        ))
      )}
    </div>
  );

  const sections: Record<OperationsSection, React.ReactNode> = {
    overview: Overview(),
    projects: Projects(),
    content: Content(),
    strategy: Strategy(),
    execution: Execution(),
    review: Review(),
    audit: Audit(),
  };
  return (
    <div className="space-y-4">
      <output
        aria-live="polite"
        className={`block rounded-md border px-3 py-2.5 text-xs ${noticeClass}`}
      >
        {notice.text}
      </output>
      {sections[section]}
      {activeProjectId && (
        <p className="text-right font-mono text-[11px] text-slate-400">
          project: {idName(activeProjectId, state.projects)}
        </p>
      )}
    </div>
  );
}
