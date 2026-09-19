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

export function FirstLoopView() {
  const {
    state,
    saveProject,
    activateProject,
    grantAccountServiceRelation,
    addContent,
    allocateContent,
    projectGaps,
  } = useFirstLoop();
  const [project, setProject] = useState(EMPTY_PROJECT);
  const [relation, setRelation] = useState(EMPTY_RELATION);
  const [content, setContent] = useState(EMPTY_CONTENT);
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
