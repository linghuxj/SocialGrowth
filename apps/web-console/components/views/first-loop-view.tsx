'use client';

import React, { useState } from 'react';
import {
  Activity,
  FilePlus2,
  FolderKanban,
  LockKeyhole,
  ScrollText,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useFirstLoop } from '@/lib/first-loop/context';

const EMPTY_PROJECT = {
  name: '',
  clientId: '',
  primaryGoal: '',
  audience: '',
  ownerId: '',
};
const EMPTY_RELATION = {
  projectId: '',
  accountId: '',
  clientId: '',
  ownerPartyId: '',
  authorizerPartyId: '',
  authorizationRef: '',
  sharedApprovalRef: '',
};
const EMPTY_CONTENT = {
  identityId: '',
  title: '',
  sourceRef: '',
  storySummary: '',
  language: 'en-US',
  fileRef: '',
  sha256: '',
  rightsRef: '',
};
const EMPTY_DESTINATION = {
  projectId: '',
  accountId: '',
  scopeId: '',
  url: '',
  maintenancePermissionRef: '',
};
const EMPTY_STRATEGY = {
  projectId: '',
  statement: '',
  sourceRef: '',
  rationale: '',
};
const EMPTY_APPROVAL = { quantity: '', validUntil: '' };
const EMPTY_OBSERVATION = {
  projectId: '',
  approvalId: '',
  metricKey: '',
  value: '',
  availability: 'observed_value',
  source: '',
  unit: '',
  scope: '',
  windowStart: '',
  windowEnd: '',
  comparisonRole: 'current',
};

export function FirstLoopView() {
  const {
    state,
    saveProject,
    activateProject,
    grantAccountServiceRelation,
    createDestination,
    addStrategyRule,
    generateStrategyDraft,
    approveStrategy,
    recordMetricObservation,
    createBasicReview,
    confirmReview,
    addContent,
    allocateContent,
    projectGaps,
  } = useFirstLoop();
  const [project, setProject] = useState(EMPTY_PROJECT);
  const [relation, setRelation] = useState(EMPTY_RELATION);
  const [content, setContent] = useState(EMPTY_CONTENT);
  const [destination, setDestination] = useState(EMPTY_DESTINATION);
  const [strategy, setStrategy] = useState(EMPTY_STRATEGY);
  const [approval, setApproval] = useState(EMPTY_APPROVAL);
  const [observation, setObservation] = useState(EMPTY_OBSERVATION);
  const [feedback, setFeedback] = useState(
    '当前为本地受控工作区；真实数据库、账号和发布接入仍需分别验证。',
  );

  const submitProject = (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = saveProject(project);
    if (!result.ok)
      return setFeedback(`${result.error?.code}: ${result.error?.message}`);
    const gaps = projectGaps(result.value!.id);
    setFeedback(
      gaps.length
        ? `草稿已保存，仍需补充：${gaps.join('、')}`
        : '项目资料完整，可由有权限人员激活。',
    );
    setProject(EMPTY_PROJECT);
  };

  const submitRelation = (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = grantAccountServiceRelation({
      ...relation,
      allowedActions: ['publish'],
      allowedData: ['public_metrics'],
      validFrom: new Date().toISOString(),
      sharedApprovalRef: relation.sharedApprovalRef || undefined,
    });
    setFeedback(
      result.ok
        ? `服务关系 ${result.value!.id} 已记录；账号所有方与服务客户保持分离。`
        : `${result.error?.code}: ${result.error?.message}`,
    );
    if (result.ok) setRelation(EMPTY_RELATION);
  };

  const submitContent = (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = addContent(content);
    if (!result.ok)
      return setFeedback(`${result.error?.code}: ${result.error?.message}`);
    setFeedback(
      `素材已进入受控库存，内容身份 ${result.value!.identity.id}；尚未批准或发布。`,
    );
    setContent(EMPTY_CONTENT);
  };

  const submitDestination = (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = createDestination({
      ...destination,
      scope: 'channel',
      sharedAttribution: true,
      exitPolicy: 'continue',
    });
    setFeedback(
      result.ok
        ? `入口 ${result.value!.entry.id} 已保存，预览与活动版本 ${result.value!.version.id} 使用同一地址。`
        : `${result.error?.code}: ${result.error?.message}`,
    );
    if (result.ok) setDestination(EMPTY_DESTINATION);
  };

  const submitStrategy = (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const rule = addStrategyRule({
      projectId: strategy.projectId,
      category: 'internal_rule',
      statement: strategy.statement,
      sourceRef: strategy.sourceRef,
    });
    if (!rule.ok)
      return setFeedback(`${rule.error?.code}: ${rule.error?.message}`);
    const draft = generateStrategyDraft({
      projectId: strategy.projectId,
      outputMode: 'controlled',
      rationale: strategy.rationale,
      assumptions: ['受控规则生成，尚未调用真实 AI Provider'],
    });
    setFeedback(
      draft.ok
        ? `策略草案 ${draft.value!.id} 已生成；必须明确数量、有效期、停止及观察条件后才能批准。`
        : `${draft.error?.code}: ${draft.error?.message}`,
    );
  };

  const submitObservation = (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const approvalRecord = state.executionApprovals.find(
      (item) => item.id === observation.approvalId,
    );
    if (!approvalRecord)
      return setFeedback('OBSERVATION_SCOPE_INVALID: 未找到批准记录');
    const hasValue =
      observation.availability === 'observed_value' ||
      observation.availability === 'observed_zero';
    const result = recordMetricObservation({
      projectId: observation.projectId,
      approvalId: observation.approvalId,
      strategyVersion: approvalRecord.strategyVersion,
      metricKey: observation.metricKey,
      value: hasValue ? Number(observation.value) : undefined,
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
      comparisonRole: observation.comparisonRole as 'baseline' | 'current',
      controlledData: true,
    });
    setFeedback(
      result.ok
        ? `观察 ${result.value!.id} 已记录，受控数据标记保持可见。`
        : `${result.error?.code}: ${result.error?.message}`,
    );
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold text-slate-900">
            首条业务闭环 · 项目与内容准入
          </h2>
          <Badge
            variant="outline"
            className="border-blue-200 bg-blue-50 text-blue-700"
          >
            FL-01 受控实现
          </Badge>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          草稿、授权、内容身份、归属及发布事实分开记录；页面操作会产生结构化审计日志。
        </p>
      </div>

      <output className="block rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-900">
        {feedback}
      </output>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <FolderKanban className="h-4 w-4" />
              项目草稿
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
              onSubmit={submitProject}
            >
              <Input
                required
                placeholder="项目名称"
                value={project.name}
                onChange={(e) =>
                  setProject({ ...project, name: e.target.value })
                }
              />
              <Input
                placeholder="服务客户 ID"
                value={project.clientId}
                onChange={(e) =>
                  setProject({ ...project, clientId: e.target.value })
                }
              />
              <Input
                placeholder="当前主目标"
                value={project.primaryGoal}
                onChange={(e) =>
                  setProject({ ...project, primaryGoal: e.target.value })
                }
              />
              <Input
                placeholder="目标受众"
                value={project.audience}
                onChange={(e) =>
                  setProject({ ...project, audience: e.target.value })
                }
              />
              <Input
                placeholder="责任人 ID"
                value={project.ownerId}
                onChange={(e) =>
                  setProject({ ...project, ownerId: e.target.value })
                }
              />
              <Button type="submit" className="gap-2">
                <FilePlus2 className="h-4 w-4" />
                保存草稿
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <LockKeyhole className="h-4 w-4" />
              内容身份与文件版本
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
              onSubmit={submitContent}
            >
              <Input
                placeholder="已有内容身份 ID（新增语言版本时填写）"
                value={content.identityId}
                onChange={(e) =>
                  setContent({ ...content, identityId: e.target.value })
                }
              />
              <Input
                required
                placeholder="内容标题"
                value={content.title}
                onChange={(e) =>
                  setContent({ ...content, title: e.target.value })
                }
              />
              <Input
                required
                placeholder="来源引用"
                value={content.sourceRef}
                onChange={(e) =>
                  setContent({ ...content, sourceRef: e.target.value })
                }
              />
              <Input
                placeholder="剧情范围说明"
                value={content.storySummary}
                onChange={(e) =>
                  setContent({ ...content, storySummary: e.target.value })
                }
              />
              <Input
                required
                placeholder="语言，如 en-US"
                value={content.language}
                onChange={(e) =>
                  setContent({ ...content, language: e.target.value })
                }
              />
              <Input
                required
                placeholder="受控文件引用"
                value={content.fileRef}
                onChange={(e) =>
                  setContent({ ...content, fileRef: e.target.value })
                }
              />
              <Input
                required
                placeholder="SHA256（64位）"
                value={content.sha256}
                onChange={(e) =>
                  setContent({ ...content, sha256: e.target.value })
                }
              />
              <Input
                required
                placeholder="权利依据引用"
                value={content.rightsRef}
                onChange={(e) =>
                  setContent({ ...content, rightsRef: e.target.value })
                }
              />
              <Button type="submit" className="gap-2">
                <FilePlus2 className="h-4 w-4" />
                准入素材
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">观察、可用性与基础复盘</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
            onSubmit={submitObservation}
          >
            <Input
              required
              placeholder="项目 ID"
              value={observation.projectId}
              onChange={(e) =>
                setObservation({ ...observation, projectId: e.target.value })
              }
            />
            <Input
              required
              placeholder="批准 ID"
              value={observation.approvalId}
              onChange={(e) =>
                setObservation({ ...observation, approvalId: e.target.value })
              }
            />
            <Input
              required
              placeholder="主指标键"
              value={observation.metricKey}
              onChange={(e) =>
                setObservation({ ...observation, metricKey: e.target.value })
              }
            />
            <select
              className="h-9 rounded-md border border-slate-200 px-3 text-xs"
              value={observation.availability}
              onChange={(e) =>
                setObservation({ ...observation, availability: e.target.value })
              }
            >
              <option value="observed_value">已观察数值</option>
              <option value="observed_zero">真实零值</option>
              <option value="missing">缺失</option>
              <option value="delayed">延迟</option>
              <option value="unauthorized">无权限</option>
            </select>
            <Input
              placeholder="数值（不可用状态留空）"
              value={observation.value}
              onChange={(e) =>
                setObservation({ ...observation, value: e.target.value })
              }
            />
            <Input
              required
              placeholder="来源"
              value={observation.source}
              onChange={(e) =>
                setObservation({ ...observation, source: e.target.value })
              }
            />
            <Input
              required
              placeholder="单位"
              value={observation.unit}
              onChange={(e) =>
                setObservation({ ...observation, unit: e.target.value })
              }
            />
            <Input
              required
              placeholder="范围"
              value={observation.scope}
              onChange={(e) =>
                setObservation({ ...observation, scope: e.target.value })
              }
            />
            <Input
              required
              type="datetime-local"
              aria-label="观察窗开始"
              value={observation.windowStart}
              onChange={(e) =>
                setObservation({ ...observation, windowStart: e.target.value })
              }
            />
            <Input
              required
              type="datetime-local"
              aria-label="观察窗结束"
              value={observation.windowEnd}
              onChange={(e) =>
                setObservation({ ...observation, windowEnd: e.target.value })
              }
            />
            <select
              className="h-9 rounded-md border border-slate-200 px-3 text-xs"
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
            <Button type="submit">记录观察</Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const result = createBasicReview({
                  projectId: observation.projectId,
                  approvalId: observation.approvalId,
                  primaryMetricKey: observation.metricKey,
                  requiredWorkComplete: true,
                  sourceComparisonAccepted: false,
                });
                setFeedback(
                  result.ok
                    ? `复盘 ${result.value!.id}: ${result.value!.outcome}`
                    : `${result.error?.code}: ${result.error?.message}`,
                );
              }}
            >
              按当前事实生成复盘
            </Button>
          </form>
          {state.basicReviews.map((review) => (
            <div
              key={review.id}
              className="rounded border border-slate-200 p-3 text-xs"
            >
              <strong>
                {review.outcome} · 原目标：{review.primaryGoalSnapshot}
              </strong>
              <p className="mt-1 text-slate-500">{review.aiAnalysis}</p>
              <Button
                size="sm"
                className="mt-2 h-7 text-xs"
                onClick={() => {
                  const result = confirmReview(review.id, 'create_new_draft');
                  setFeedback(
                    result.ok
                      ? '后续动作已由人工确认为新草案；系统未自动扩大执行。'
                      : `${result.error?.code}: ${result.error?.message}`,
                  );
                }}
              >
                确认新草案后续动作
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <LockKeyhole className="h-4 w-4" />
            账号服务授权
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
            onSubmit={submitRelation}
          >
            <Input
              required
              placeholder="项目 ID"
              value={relation.projectId}
              onChange={(e) =>
                setRelation({ ...relation, projectId: e.target.value })
              }
            />
            <Input
              required
              placeholder="账号 ID"
              value={relation.accountId}
              onChange={(e) =>
                setRelation({ ...relation, accountId: e.target.value })
              }
            />
            <Input
              required
              placeholder="服务客户 ID"
              value={relation.clientId}
              onChange={(e) =>
                setRelation({ ...relation, clientId: e.target.value })
              }
            />
            <Input
              required
              placeholder="账号所有方 ID"
              value={relation.ownerPartyId}
              onChange={(e) =>
                setRelation({ ...relation, ownerPartyId: e.target.value })
              }
            />
            <Input
              required
              placeholder="授权方 ID"
              value={relation.authorizerPartyId}
              onChange={(e) =>
                setRelation({ ...relation, authorizerPartyId: e.target.value })
              }
            />
            <Input
              required
              placeholder="授权依据引用"
              value={relation.authorizationRef}
              onChange={(e) =>
                setRelation({ ...relation, authorizationRef: e.target.value })
              }
            />
            <Input
              placeholder="共享批准引用（按需）"
              value={relation.sharedApprovalRef}
              onChange={(e) =>
                setRelation({ ...relation, sharedApprovalRef: e.target.value })
              }
            />
            <Button type="submit">记录授权</Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">项目与资料缺口</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {state.projects.length === 0 && (
              <p className="text-xs text-slate-500">尚无项目草稿。</p>
            )}
            {state.projects.map((item) => {
              const gaps = projectGaps(item.id);
              return (
                <div
                  key={item.id}
                  className="rounded border border-slate-200 p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong>{item.name}</strong>
                    <Badge variant="outline">{item.status}</Badge>
                  </div>
                  <p className="mt-1 text-slate-500">
                    {gaps.length
                      ? `待补：${gaps.join('、')}`
                      : '资料完整；仍需核对真实授权事实。'}
                  </p>
                  {gaps.length === 0 && item.status === 'draft' && (
                    <Button
                      size="sm"
                      className="mt-2 h-7 text-xs"
                      onClick={() => {
                        const result = activateProject(item.id);
                        setFeedback(
                          result.ok
                            ? '项目已激活；真实动作仍按授权范围校验。'
                            : `${result.error?.code}: ${result.error?.message}`,
                        );
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

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">内容归属</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {state.contentIdentities.length === 0 && (
              <p className="text-xs text-slate-500">尚无已准入内容。</p>
            )}
            {state.contentIdentities.map((item) => (
              <div
                key={item.id}
                className="rounded border border-slate-200 p-3 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <strong>{item.title}</strong>
                  <Badge variant="outline">{item.allocationStatus}</Badge>
                </div>
                <p className="mt-1 text-slate-500">
                  身份 {item.id} ·{' '}
                  {
                    state.sliceAssets.filter(
                      (asset) => asset.contentIdentityId === item.id,
                    ).length
                  }{' '}
                  个文件版本
                </p>
                {!item.assignedAccountId && (
                  <Button
                    size="sm"
                    className="mt-2 h-7 text-xs"
                    onClick={() => {
                      const result = allocateContent(
                        item.id,
                        'controlled-account-1',
                        item.allocationVersion,
                      );
                      setFeedback(
                        result.ok
                          ? '内容已归属 controlled-account-1；尚未批准或发布。'
                          : `${result.error?.code}: ${result.error?.message}`,
                      );
                    }}
                  >
                    受控分配
                  </Button>
                )}
                {item.assignedAccountId && (
                  <p className="mt-2 font-medium text-amber-700">
                    归属账号：{item.assignedAccountId}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Activity className="h-4 w-4" />
            导流入口与版本
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
            onSubmit={submitDestination}
          >
            <Input
              required
              placeholder="项目 ID"
              value={destination.projectId}
              onChange={(e) =>
                setDestination({ ...destination, projectId: e.target.value })
              }
            />
            <Input
              required
              placeholder="账号 ID"
              value={destination.accountId}
              onChange={(e) =>
                setDestination({ ...destination, accountId: e.target.value })
              }
            />
            <Input
              required
              placeholder="频道/范围 ID"
              value={destination.scopeId}
              onChange={(e) =>
                setDestination({ ...destination, scopeId: e.target.value })
              }
            />
            <Input
              required
              type="url"
              placeholder="实际目的地 URL"
              value={destination.url}
              onChange={(e) =>
                setDestination({ ...destination, url: e.target.value })
              }
            />
            <Input
              required
              placeholder="维护权限依据"
              value={destination.maintenancePermissionRef}
              onChange={(e) =>
                setDestination({
                  ...destination,
                  maintenancePermissionRef: e.target.value,
                })
              }
            />
            <Button type="submit">保存共享入口</Button>
          </form>
          {state.destinationEntries.map((entry) => {
            const version = state.destinationVersions.find(
              (item) => item.id === entry.activeVersionId,
            );
            return (
              <div
                key={entry.id}
                className="rounded border border-slate-200 p-3 text-xs"
              >
                <strong>
                  {entry.scope}/{entry.scopeId}
                </strong>
                <p className="mt-1 text-slate-500">
                  {version?.url} · {version?.health} ·{' '}
                  {version?.isActive ? '活动' : '停用'}
                </p>
                <p className="mt-1 text-slate-500">
                  共享入口只保留频道级观察，不伪分摊到单条内容。
                </p>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">规则、受控草案与明确批准</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            onSubmit={submitStrategy}
          >
            <Input
              required
              placeholder="项目 ID"
              value={strategy.projectId}
              onChange={(e) =>
                setStrategy({ ...strategy, projectId: e.target.value })
              }
            />
            <Input
              required
              placeholder="规则陈述"
              value={strategy.statement}
              onChange={(e) =>
                setStrategy({ ...strategy, statement: e.target.value })
              }
            />
            <Input
              required
              placeholder="规则来源引用"
              value={strategy.sourceRef}
              onChange={(e) =>
                setStrategy({ ...strategy, sourceRef: e.target.value })
              }
            />
            <Input
              required
              placeholder="草案依据说明"
              value={strategy.rationale}
              onChange={(e) =>
                setStrategy({ ...strategy, rationale: e.target.value })
              }
            />
            <Button type="submit">生成受控草案</Button>
          </form>
          {state.strategyDrafts.map((draft) => (
            <div
              key={draft.id}
              className="rounded border border-slate-200 p-3 text-xs"
            >
              <strong>
                {draft.id} · v{draft.version} · {draft.outputMode}
              </strong>
              <p className="mt-1 text-slate-500">{draft.rationale}</p>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Input
                  type="number"
                  min="1"
                  placeholder="本批批准数量"
                  value={approval.quantity}
                  onChange={(e) =>
                    setApproval({ ...approval, quantity: e.target.value })
                  }
                />
                <Input
                  type="datetime-local"
                  aria-label="批准有效期"
                  value={approval.validUntil}
                  onChange={(e) =>
                    setApproval({ ...approval, validUntil: e.target.value })
                  }
                />
              </div>
              <Button
                size="sm"
                className="mt-2 h-7 text-xs"
                onClick={() => {
                  const validFrom = new Date().toISOString();
                  const result = approveStrategy({
                    strategyDraftId: draft.id,
                    expectedStrategyVersion: draft.version,
                    quantity: Number(approval.quantity),
                    validFrom,
                    validUntil: approval.validUntil
                      ? new Date(approval.validUntil).toISOString()
                      : '',
                    stopConditions: ['结果未知或身份冲突时停止'],
                    observationConditions: ['保留公开证据及观察来源'],
                  });
                  setFeedback(
                    result.ok
                      ? `批准 ${result.value!.id} 已记录；数量和有效期来自本次明确输入。`
                      : `${result.error?.code}: ${result.error?.message}`,
                  );
                }}
              >
                批准单条受控试验
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <ScrollText className="h-4 w-4" />
            核心流程审计日志
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-72 overflow-auto rounded bg-slate-950 p-3 font-mono text-[11px] text-slate-200">
            {state.auditLogs.length === 0
              ? '尚无操作日志。'
              : state.auditLogs
                  .slice()
                  .reverse()
                  .map((entry) => (
                    <div
                      key={entry.id}
                      className="mb-2 border-b border-slate-800 pb-2 last:mb-0 last:border-0"
                    >
                      <div className="flex items-center gap-2">
                        <Activity className="h-3 w-3" />
                        <span>{entry.timestamp}</span>
                        <strong>{entry.action}</strong>
                        <span
                          className={
                            entry.result === 'accepted'
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }
                        >
                          {entry.result}
                        </span>
                      </div>
                      <div className="mt-1 text-slate-400">
                        corr={entry.correlationId} entity={entry.entityType}/
                        {entry.entityId} reason={entry.reasonCode} facts=
                        {JSON.stringify(entry.facts)}
                      </div>
                    </div>
                  ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
