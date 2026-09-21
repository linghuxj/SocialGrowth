'use client';
import React, { useEffect, useState } from 'react';
import { useOperations } from '@/lib/operations-context';
import { label, lookup, names, validRelation } from '@/lib/operations';
import { storeAsset, assetUrl } from '@/lib/local-assets';
import type { Field } from './shared';
import {
  Action,
  Detail,
  Facts,
  Form,
  Link,
  List,
  Notice,
  Panel,
  Status,
  date,
  fail,
  iso,
  options,
  ExclusiveLockPill,
} from './shared';
import type { SliceAsset } from '@/lib/first-loop/types';
import { goals, dataScopes } from '@/lib/first-loop/catalog';
import { BatchContent } from './batch-content';
import { IdentityOnboardingPanel } from './identity-onboarding';
import { Drawer } from './drawer';
import { InsideDetailContext } from './shared';
import { Button } from '@/components/ui/button';
import { Users } from 'lucide-react';

export function Clients({ object, query }: { object: string; query: string }) {
  const { state, run, projectId } = useOperations();
  const project = state.projects.find((p) => p.id === object);
  const client = state.clients.find((c) => c.id === object);
  const [clientDrawerOpen, setClientDrawerOpen] = useState(false);

  useEffect(() => {
    if (client || project) {
      setClientDrawerOpen(false);
    }
  }, [client, project]);

  const projectFields: Field[] = [
    {
      key: 'operatingMode',
      label: '运营方式',
      initial: 'self',
      options: [
        { id: 'self', name: '自营项目' },
        { id: 'client', name: '客户代运营' },
      ],
    },
    { key: 'clientId', label: '客户', options: state.clients, optional: true },
    { key: 'name', label: '项目名称' },
    {
      key: 'primaryGoal',
      label: '主要业务目标',
      options: goals,
      initial: 'views',
    },
    { key: 'audience', label: '目标受众', optional: true },
    { key: 'ownerId', label: '项目负责人', optional: true },
  ];
  return (
    <>
      <Notice>
        从运营项目开始：确认目标，接入账号，设置素材默认值，再制定策略与发布。自营项目无需另建客户档案。
      </Notice>
      <div className="flex items-center gap-3 my-2 flex-wrap">
        <Form
          id="project-new"
          title="新建运营项目"
          fields={(v) =>
            projectFields.filter(
              (f) => f.key !== 'clientId' || v.operatingMode === 'client',
            )
          }
          submit="保存项目草稿"
          description="自营项目自动关联自营主体；代运营选择已有客户。受众和负责人在激活前须补齐。"
          onSubmit={(v) =>
            run((e, c) =>
              e.saveProjectDraft(
                {
                  name: v.name,
                  clientId: v.clientId,
                  primaryGoal: v.primaryGoal,
                  audience: v.audience,
                  ownerId: v.ownerId,
                  operatingMode: v.operatingMode as 'self' | 'client',
                },
                c,
              ),
            )
          }
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => setClientDrawerOpen(true)}
          className="op-trigger-button inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 hover:text-blue-600 hover:border-blue-400 transition-colors shadow-xs"
        >
          <Users className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
          <span>客户档案（代运营使用）</span>
        </Button>
      </div>

      <Drawer
        open={clientDrawerOpen}
        onClose={() => setClientDrawerOpen(false)}
        title="客户档案（代运营使用）"
        description="自营项目无需另建客户档案；代运营在此新增客户并管理关联项目。"
        width="xl"
      >
        <InsideDetailContext.Provider value={true}>
          <div className="space-y-6">
            <Form
              id="client-new"
              title="新增客户"
              fields={[{ key: 'name', label: '客户名称' }]}
              submit="保存客户"
              open={true}
              onSubmit={(v) => run((e, c) => e.registerClient(v.name, c))}
            />
            <Panel title="客户档案列表">
              <List
                query={query}
                columns={['客户', '运营项目', '进行中的项目']}
                rows={state.clients.map((c) => ({
                  id: c.id,
                  search: c.name,
                  cells: [
                    <Link key="n" page="clients" id={c.id}>
                      {c.name}
                    </Link>,
                    state.projects.filter((p) => p.clientId === c.id).length,
                    state.projects.filter(
                      (p) => p.clientId === c.id && p.status === 'active',
                    ).length,
                  ],
                }))}
                empty="自营无需客户档案；代运营在此新增客户。"
              />
            </Panel>
          </div>
        </InsideDetailContext.Provider>
      </Drawer>
      <Panel title={client ? `${client.name}的运营项目` : '运营项目'}>
        <List
          query={query}
          columns={['项目 / 主体', '目标', '负责人', '状态']}
          rows={state.projects
            .filter(
              (p) =>
                (!client || p.clientId === client.id) &&
                (!projectId || p.id === projectId),
            )
            .map((p) => ({
              id: p.id,
              search: `${p.name} ${lookup(state, p.clientId)} ${p.ownerId}`,
              cells: [
                <Link key="n" page="clients" id={p.id} project={p.id}>
                  {p.name} · {lookup(state, p.clientId)}
                </Link>,
                goals.find((g) => g.id === p.primaryGoal)?.name ??
                  p.primaryGoal ??
                  '待补齐',
                p.ownerId,
                <Status key="s">{label(p.status)}</Status>,
              ],
            }))}
        />
      </Panel>
      {client && (
        <Detail page="clients" title={client.name}>
          <Form
            id={`client-edit-${client.id}`}
            title="修改客户名称"
            fields={[{ key: 'name', label: '客户名称', initial: client.name }]}
            submit="保存名称"
            onSubmit={(v) =>
              run((e, c) => e.updateClient(client.id, v.name, c))
            }
          />
        </Detail>
      )}
      {project && (
        <Detail page="clients" title={project.name}>
          <Facts
            items={[
              ['客户', lookup(state, project.clientId)],
              [
                '目标',
                goals.find((g) => g.id === project.primaryGoal)?.name ??
                  project.primaryGoal,
              ],
              ['受众', project.audience],
              ['负责人', project.ownerId],
              ['状态', label(project.status)],
            ]}
          />
          {project.status !== 'exited' && (
            <>
              <Form
                id={`project-${project.id}`}
                title="编辑项目资料"
                fields={projectFields.map((f) => ({
                  ...f,
                  initial:
                    typeof project[f.key as keyof typeof project] === 'string'
                      ? (project[f.key as keyof typeof project] as string)
                      : f.key === 'operatingMode'
                        ? 'client'
                        : '',
                }))}
                submit="保存修改"
                description="修改业务目标会使已有批准及待执行排期失效。"
                onSubmit={(v) =>
                  run((e, c) =>
                    e.saveProjectDraft(
                      {
                        ...project,
                        ...v,
                        operatingMode: v.operatingMode as 'self' | 'client',
                      },
                      c,
                    ),
                  )
                }
              />
              {project.status === 'draft' && (
                <Action
                  name="资料已核对，激活项目"
                  act={() => run((e, c) => e.activateProject(project.id, c))}
                />
              )}
              <Form
                id={`exit-${project.id}`}
                title="结束服务合作"
                fields={[{ key: 'reason', label: '结束原因' }]}
                submit="确认退出并撤销关联授权"
                description="撤销该服务授权与批准、取消待执行排期；导流入口按各自退出约定处理，历史记录保留。"
                onSubmit={(v) =>
                  run((e, c) =>
                    e.exitProject(project.id, {
                      ...c,
                      evidenceRefs: [v.reason],
                    }),
                  )
                }
              />
            </>
          )}
          <div className="op-row">
            <Link page="accounts" project={project.id}>
              账号接入与授权
            </Link>
            <Link page="content" project={project.id}>
              导入本项目素材
            </Link>
            <Link page="strategies" project={project.id}>
              选择策略模板
            </Link>
            <Link page="receipts" project={project.id}>
              任务与人工待办
            </Link>
          </div>
          <Facts
            items={[
              [
                '有效账号授权',
                state.accountServiceRelations.filter(
                  (r) => r.projectId === project.id && validRelation(r),
                ).length,
              ],
              [
                '项目素材',
                state.contentIdentities.filter(
                  (i) =>
                    i.projectId === project.id ||
                    state.accountServiceRelations.some(
                      (r) =>
                        r.projectId === project.id &&
                        r.accountId === i.assignedAccountId,
                    ),
                ).length,
              ],
              [
                '策略草案',
                state.strategyDrafts.filter((d) => d.projectId === project.id)
                  .length,
              ],
            ]}
          />
          {project.status !== 'exited' && (
            <Form
              id={`content-defaults-${project.id}`}
              title="素材默认配置（批量导入继承）"
              submit="保存项目默认值"
              fields={[
                {
                  key: 'sourceRef',
                  label: '原始素材来源',
                  initial: project.contentDefaults?.sourceRef ?? '',
                },
                {
                  key: 'rightsRef',
                  label: '内容权利依据',
                  initial: project.contentDefaults?.rightsRef ?? '',
                  hint: '文件路径或授权凭据；不代表账号登录授权',
                },
                {
                  key: 'language',
                  label: '默认语言',
                  initial: project.contentDefaults?.language ?? 'zh-CN',
                  options: [
                    { id: 'zh-CN', name: '简体中文' },
                    { id: 'en', name: '英语' },
                    { id: 'es', name: '西班牙语' },
                  ],
                },
              ]}
              onSubmit={(v) =>
                run((e, c) =>
                  e.saveProjectDraft(
                    {
                      ...project,
                      contentDefaults: {
                        sourceRef: v.sourceRef,
                        rightsRef: v.rightsRef,
                        language: v.language,
                      },
                    },
                    c,
                  ),
                )
              }
            />
          )}
        </Detail>
      )}
    </>
  );
}

export function Accounts({ object, query }: { object: string; query: string }) {
  const { state, run, projectId } = useOperations();
  const account = state.accounts.find((a) => a.id === object);
  return (
    <>
      <Notice>
        档案与服务授权集中维护。设备编号是绑定登记；设备在线、平台登录状态需真实接入后确认。
      </Notice>
      <Form
        id="account-new"
        title="新增账号档案"
        submit="保存账号"
        fields={[
          { key: 'name', label: '账号显示名称' },
          {
            key: 'platform',
            label: '平台',
            options: options(['facebook', 'youtube'], names),
          },
          { key: 'owner', label: '账号归属方' },
          { key: 'positioning', label: '内容定位' },
          {
            key: 'deviceRef',
            label: '真机设备编号',
            optional: true,
            hint: '同一设备同一平台只允许一个账号。',
          },
        ]}
        onSubmit={(v) =>
          run((e, c) =>
            e.registerAccount(
              {
                name: v.name,
                platform: v.platform as 'facebook' | 'youtube',
                owner: v.owner,
                positioning: v.positioning,
                deviceRef: v.deviceRef || undefined,
              },
              c,
            ),
          )
        }
      />
      <List
        query={query}
        columns={[
          '账号',
          '平台 / 归属',
          '内容定位',
          '有效服务授权',
          '设备登记',
        ]}
        empty="暂无账号，请先登记名称、平台和归属方。"
        rows={state.accounts
          .filter(
            (a) =>
              !projectId ||
              a.id === object ||
              state.accountServiceRelations.some(
                (r) => r.projectId === projectId && r.accountId === a.id,
              ) ||
              !state.accountServiceRelations.some((r) => r.accountId === a.id),
          )
          .map((a) => ({
            id: a.id,
            search: `${a.name} ${a.owner} ${a.platform} ${a.positioning}`,
            cells: [
              <Link key="n" page="accounts" id={a.id}>
                {a.name}
              </Link>,
              `${label(a.platform)} · ${a.owner}`,
              a.positioning,
              state.accountServiceRelations.filter(
                (r) => r.accountId === a.id && validRelation(r),
              ).length,
              a.deviceRef ?? '未登记',
            ],
          }))}
      />
      {account && (
        <Detail page="accounts" title={account.name}>
          <Form
            id={`profile-${account.id}`}
            title="编辑账号资料"
            fields={[
              { key: 'name', label: '账号显示名称', initial: account.name },
              {
                key: 'positioning',
                label: '内容定位',
                initial: account.positioning,
              },
            ]}
            submit="保存账号资料"
            description="平台、所有方与设备属于身份和授权依据，不随显示名称一起变更。"
            onSubmit={(v) =>
              run((e, c) =>
                e.updateAccountProfile(
                  account.id,
                  { name: v.name, positioning: v.positioning },
                  c,
                ),
              )
            }
          />
          <Facts
            items={[
              ['平台', label(account.platform)],
              ['归属方', account.owner],
              ['定位', account.positioning],
              ['真机设备', account.deviceRef ?? '未登记'],
            ]}
          />
          <Form
            id={`grant-${account.id}`}
            title="新增项目授权"
            submit="保存授权"
            fields={(v) => {
              const p = state.projects.find((p) => p.id === v.projectId);
              return [
                {
                  key: 'projectId',
                  label: '运营项目',
                  initial: projectId,
                  options: state.projects.filter((p) => p.status !== 'exited'),
                },
                ...(p?.operatingMode === 'self'
                  ? [
                      {
                        key: 'selfConfirmation',
                        label: '自有账号运营授权',
                        options: [
                          {
                            id: 'confirmed',
                            name: '确认有权代表账号所有方授权本项目发布',
                          },
                        ],
                      },
                    ]
                  : [
                      {
                        key: 'authorizer',
                        label: '授权方',
                        options: [
                          {
                            id: account.owner,
                            name: `${account.owner}（账号所有方）`,
                          },
                          ...state.clients
                            .filter((x) => x.name !== account.owner)
                            .map((x) => ({ id: x.name, name: x.name })),
                        ],
                      },
                      {
                        key: 'reference',
                        label: '授权依据',
                        hint: '合同、授权文件或可核查凭据的位置',
                      },
                    ]),
                {
                  key: 'until',
                  label: '有效至（本机时区）',
                  type: 'datetime-local',
                },
                {
                  key: 'data',
                  label: '授权数据范围',
                  initial: 'none',
                  options: dataScopes,
                  hint: '记录允许访问的范围，不代表已获得平台权限或已采集。',
                },
                {
                  key: 'shared',
                  label: '跨服务共享批准依据',
                  optional: true,
                  hint: '账号已服务其他客户/项目时必填。',
                },
              ];
            }}
            description="一次授权由后续切片复用；不保存密码，不等同平台登录或管理员权限。"
            onSubmit={(v) => {
              const p = state.projects.find((x) => x.id === v.projectId);
              if (!p?.clientId) return fail('所选服务缺少客户资料');
              return run((e, c) =>
                e.grantAccountServiceRelation(
                  {
                    accountId: account.id,
                    projectId: p.id,
                    clientId: p.clientId!,
                    ownerPartyId: account.owner,
                    authorizerPartyId:
                      p.operatingMode === 'self' ? account.owner : v.authorizer,
                    authorizationRef:
                      p.operatingMode === 'self' &&
                      v.selfConfirmation === 'confirmed'
                        ? `自有账号运营确认：${account.id} / ${p.id}`
                        : v.reference || '',
                    allowedActions: ['publish'],
                    allowedData: v.data === 'none' ? [] : [v.data],
                    validFrom: new Date().toISOString(),
                    validUntil: iso(v.until),
                    sharedApprovalRef: v.shared || undefined,
                  },
                  c,
                ),
              );
            }}
          />
          {state.accountServiceRelations
            .filter((r) => r.accountId === account.id)
            .map((r) => (
              <section key={r.id} className="op-record">
                <h3>
                  {lookup(state, r.projectId)}{' '}
                  <Status>
                    {r.revokedAt
                      ? '已撤销'
                      : validRelation(r)
                        ? '授权有效'
                        : '未生效 / 已到期'}
                  </Status>
                </h3>
                <Facts
                  items={[
                    ['依据', r.authorizationRef],
                    ['数据范围', r.allowedData.join('、')],
                    ['有效期', `${date(r.validFrom)} — ${date(r.validUntil)}`],
                  ]}
                />
                {!r.revokedAt && (
                  <Form
                    id={`revoke-${r.id}`}
                    title="撤销该授权"
                    fields={[{ key: 'reason', label: '撤销原因' }]}
                    description="关联批准与待执行排期将失效。"
                    submit="确认撤销"
                    onSubmit={(v) =>
                      run((e, c) =>
                        e.revokeAccountServiceRelation(r.id, {
                          ...c,
                          evidenceRefs: [v.reason],
                        }),
                      )
                    }
                  />
                )}
              </section>
            ))}
          <IdentityOnboardingPanel accountId={account.id} />
        </Detail>
      )}
    </>
  );
}
function AssetPreview({ asset }: { asset: SliceAsset }) {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    let local: string | undefined;
    assetUrl(asset.fileRef)
      .then((value) => {
        local = value;
        if (alive) {
          setUrl(value);
          if (!value) setError('找不到该素材，请核查执行服务或迁移原文件。');
        } else if (value?.startsWith('blob:')) URL.revokeObjectURL(value);
      })
      .catch(() => {
        if (alive) setError('读取素材失败，请检查执行服务连接。');
      });
    return () => {
      alive = false;
      if (local?.startsWith('blob:')) URL.revokeObjectURL(local);
    };
  }, [asset.fileRef]);
  return (
    <div className="op-record">
      <h3>
        {asset.language} ·{' '}
        {asset.variant === 'master' ? '主版本' : asset.variant}{' '}
        <Status>{label(asset.destinationFit)}</Status>
      </h3>
      {url && (
        <a className="op-link" href={url} target="_blank" rel="noreferrer">
          打开素材预览
        </a>
      )}
      {error && <p role="alert">{error}</p>}
      <Facts
        items={[
          ['权利依据', asset.rightsRef],
          ['权利期限', date(asset.rightsValidUntil)],
          ['文件指纹', <code key="sha">{asset.sha256}</code>],
        ]}
      />
    </div>
  );
}
export function Content({ object, query }: { object: string; query: string }) {
  const { state, run, projectId } = useOperations();
  const content = state.contentIdentities.find((x) => x.id === object);
  return (
    <>
      <Notice>
        按内容身份管理所有语言版本。同一内容只选一个版本发布一次；已发布或结果待核对时不能释放重发。
      </Notice>
      <BatchContent />
      <Form
        id="content-new"
        title="登记内容与素材"
        submit="计算指纹并保存"
        fields={(v) => [
          {
            key: 'identityId',
            label: '已有内容的语言版本',
            optional: true,
            options: state.contentIdentities.map((i) => ({
              id: i.id,
              name: i.title,
            })),
            hint: '同一故事的字幕、配音和封面版本须归入同一内容；新故事留空。',
          },
          ...(!v.identityId
            ? [
                { key: 'title', label: '内容标题' },
                {
                  key: 'source',
                  label: '原始内容来源',
                  initial: state.projects.find((p) => p.id === projectId)
                    ?.contentDefaults?.sourceRef,
                },
                {
                  key: 'summary',
                  label: '故事范围说明',
                  type: 'textarea' as const,
                },
              ]
            : []),
          { key: 'file', label: '素材文件', type: 'file' },
          {
            key: 'language',
            label: '语言',
            initial: state.projects.find((p) => p.id === projectId)
              ?.contentDefaults?.language,
            options: [
              { id: 'zh-CN', name: '简体中文' },
              { id: 'en', name: '英语' },
              { id: 'es', name: '西班牙语' },
              { id: 'ja', name: '日语' },
            ],
          },
          {
            key: 'variant',
            label: '版本类型',
            options: [
              { id: 'master', name: '主版本' },
              { id: 'subtitle', name: '字幕版本' },
              { id: 'voiceover', name: '配音版本' },
              { id: 'cover', name: '封面版本' },
            ],
          },
          {
            key: 'rights',
            label: '权利依据',
            initial: state.projects.find((p) => p.id === projectId)
              ?.contentDefaults?.rightsRef,
          },
          {
            key: 'rightsUntil',
            label: '权利有效至（本机时区）',
            type: 'datetime-local',
            optional: true,
          },
          {
            key: 'fit',
            label: '目的地适配核对',
            options: options(
              ['pending_review', 'eligible', 'ineligible'],
              names,
            ),
          },
        ]}
        description="文件上传至本机执行服务并校验 SHA-256。请先人工核对故事范围与重叠情况；指纹只能识别文件相同，不能判断剧情重复。"
        onSubmit={async (v, form) => {
          const file = new FormData(form).get('file');
          if (!(file instanceof File) || !file.size)
            return fail('请选择非空素材文件');
          if (file.size > 100 * 1024 * 1024)
            return fail('本地工作区单文件上限 100 MB，请选择压缩后的素材');
          const prior = state.contentIdentities.find(
            (x) => x.id === v.identityId,
          );
          const stored = await storeAsset(file);
          return run((e, c) =>
            e.admitContent(
              {
                identity: prior ? { id: prior.id } : undefined,
                projectId: prior?.projectId ?? (projectId || undefined),
                title: prior?.title ?? v.title,
                sourceRef: prior?.sourceRef ?? v.source,
                storySummary: prior?.storySummary ?? v.summary,
                asset: {
                  ...stored,
                  language: v.language,
                  variant: v.variant as SliceAsset['variant'],
                  rightsRef: v.rights,
                  rightsValidUntil: v.rightsUntil
                    ? iso(v.rightsUntil)
                    : undefined,
                  destinationFit: v.fit as SliceAsset['destinationFit'],
                },
              },
              c,
            ),
          );
        }}
      />
      <List
        query={query}
        columns={['内容', '来源', '归属账号', '版本', '状态']}
        rows={state.contentIdentities
          .filter(
            (x) =>
              !projectId ||
              x.projectId === projectId ||
              state.accountServiceRelations.some(
                (r) =>
                  r.projectId === projectId &&
                  r.accountId === x.assignedAccountId,
              ),
          )
          .map((x) => ({
            id: x.id,
            search: `${x.title} ${x.sourceRef} ${lookup(state, x.assignedAccountId)} ${label(x.allocationStatus)}`,
            cells: [
              <Link key="n" page="content" id={x.id}>
                {x.title}
              </Link>,
              x.sourceRef,
              x.assignedAccountId
                ? lookup(state, x.assignedAccountId)
                : '待分配',
              state.sliceAssets.filter((s) => s.contentIdentityId === x.id)
                .length,
              <Status key="s">
                {x.firstPublishedAt
                  ? '已发布 · 禁止重发'
                  : label(x.allocationStatus)}
              </Status>,
            ],
          }))}
        empty="暂无内容。登记素材后在详情中核对适配并分配账号。"
      />
      {content && (
        <Detail page="content" title={content.title}>
          <div className="my-3">
            <ExclusiveLockPill
              isLocked={content.allocationStatus === 'assigned_locked' || Boolean(content.assignedAccountId)}
              targetAccountId={content.assignedAccountId}
              targetAccountName={content.assignedAccountId ? lookup(state, content.assignedAccountId) : undefined}
              lockedAt={content.updatedAt}
            />
          </div>
          <Facts
            items={[
              ['故事范围', content.storySummary],
              ['归属', lookup(state, content.assignedAccountId)],
              ['首次发布', date(content.firstPublishedAt)],
            ]}
          />
          {!content.firstPublishedAt &&
            content.allocationStatus === 'unallocated' && (
              <Form
                id={`allocate-${content.id}`}
                title="分配唯一目标账号"
                fields={[
                  {
                    key: 'account',
                    label: '具备有效发布授权的账号',
                    options: state.accounts.filter((a) =>
                      state.accountServiceRelations.some(
                        (r) =>
                          r.accountId === a.id &&
                          (!content.projectId ||
                            r.projectId === content.projectId) &&
                          validRelation(r),
                      ),
                    ),
                  },
                ]}
                submit="确认独占分配"
                onSubmit={(v) =>
                  run((e, c) =>
                    e.allocateContent(
                      content.id,
                      v.account,
                      content.allocationVersion,
                      c,
                    ),
                  )
                }
              />
            )}
          {state.sliceAssets
            .filter((a) => a.contentIdentityId === content.id)
            .map((a) => (
              <React.Fragment key={a.id}>
                <AssetPreview asset={a} />
                {!content.firstPublishedAt && (
                  <Form
                    id={`fit-${a.id}`}
                    title="更新适配核对"
                    fields={[
                      {
                        key: 'fit',
                        label: '适配结论',
                        options: options(
                          ['eligible', 'ineligible', 'pending_review'],
                          names,
                        ),
                      },
                      { key: 'reason', label: '核对依据' },
                    ]}
                    submit="保存核对结论"
                    onSubmit={(v) =>
                      run((e, c) =>
                        e.reviewAssetFit(
                          a.id,
                          v.fit as SliceAsset['destinationFit'],
                          v.reason,
                          c,
                        ),
                      )
                    }
                  />
                )}
              </React.Fragment>
            ))}
          {content.allocationStatus === 'assigned_locked' &&
            !content.firstPublishedAt && (
              <Form
                id={`release-${content.id}`}
                title="申请释放分配"
                fields={[{ key: 'evidence', label: '未公开 / 取消证据' }]}
                submit="校验并释放"
                description="存在已发布、处理中或结果未知的执行记录时拒绝释放。"
                onSubmit={(v) =>
                  run((e, c) =>
                    e.releaseContent(
                      content.id,
                      {
                        approvalsInvalidated: !state.executionApprovals.some(
                          (a) =>
                            a.contentIdentityId === content.id &&
                            a.status === 'active' &&
                            Date.parse(a.validUntil) > Date.now(),
                        ),
                        schedulesInvalidated: !state.publicationSchedules.some(
                          (s) =>
                            s.status === 'scheduled' &&
                            Date.parse(s.expiresAt) > Date.now() &&
                            state.executionApprovals.some(
                              (a) =>
                                a.id === s.approvalId &&
                                a.contentIdentityId === content.id,
                            ),
                        ),
                      },
                      { ...c, evidenceRefs: [v.evidence] },
                    ),
                  )
                }
              />
            )}
          <Link page="strategies">前往策略管理</Link>
        </Detail>
      )}
    </>
  );
}
