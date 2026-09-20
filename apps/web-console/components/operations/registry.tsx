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
} from './shared';
import type { SliceAsset } from '@/lib/first-loop/types';

export function Clients({ object, query }: { object: string; query: string }) {
  const { state, run } = useOperations();
  const project = state.projects.find((p) => p.id === object);
  const client = state.clients.find((c) => c.id === object);
  const projectFields: Field[] = [
    { key: 'clientId', label: '客户', options: state.clients, optional: true },
    { key: 'name', label: '服务名称' },
    { key: 'primaryGoal', label: '主要业务目标', optional: true },
    { key: 'audience', label: '目标受众', optional: true },
    { key: 'ownerId', label: '服务负责人', optional: true },
  ];
  return (
    <>
      <Notice>
        客户档案管理合作方；服务范围记录目标、受众和责任人。账号、内容和待办跨服务统一查看。
      </Notice>
      <Form
        id="client-new"
        title="新增客户"
        fields={[{ key: 'name', label: '客户名称' }]}
        submit="保存客户"
        onSubmit={(v) => run((e, c) => e.registerClient(v.name, c))}
      />
      <Form
        id="project-new"
        title="新建服务范围"
        fields={projectFields}
        submit="保存服务草稿"
        description="仅填写名称即可暂存草稿；客户、目标、受众和负责人在激活前须补齐。"
        onSubmit={(v) =>
          run((e, c) =>
            e.saveProjectDraft(
              {
                name: v.name,
                clientId: v.clientId,
                primaryGoal: v.primaryGoal,
                audience: v.audience,
                ownerId: v.ownerId,
              },
              c,
            ),
          )
        }
      />
      <Panel title="客户档案">
        <List
          query={query}
          columns={['客户', '服务范围', '进行中的服务']}
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
          empty="尚无客户。新增客户后登记服务范围。"
        />
      </Panel>
      <Panel title={client ? `${client.name}的服务范围` : '所有服务范围'}>
        <List
          query={query}
          columns={['服务 / 客户', '目标', '负责人', '状态']}
          rows={state.projects
            .filter((p) => !client || p.clientId === client.id)
            .map((p) => ({
              id: p.id,
              search: `${p.name} ${lookup(state, p.clientId)} ${p.ownerId}`,
              cells: [
                <Link key="n" page="clients" id={p.id}>
                  {p.name} · {lookup(state, p.clientId)}
                </Link>,
                p.primaryGoal ?? '待补齐',
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
              ['目标', project.primaryGoal],
              ['受众', project.audience],
              ['负责人', project.ownerId],
              ['状态', label(project.status)],
            ]}
          />
          {project.status !== 'exited' && (
            <>
              <Form
                id={`project-${project.id}`}
                title="编辑服务资料"
                fields={projectFields.map((f) => ({
                  ...f,
                  initial: String(project[f.key as keyof typeof project] ?? ''),
                }))}
                submit="保存修改"
                description="修改业务目标会使已有批准及待执行排期失效。"
                onSubmit={(v) =>
                  run((e, c) => e.saveProjectDraft({ ...project, ...v }, c))
                }
              />
              {project.status === 'draft' && (
                <Action
                  name="资料已核对，激活服务"
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
            <Link page="accounts">查看账号与授权</Link>
            <Link page="strategies">查看策略草案</Link>
          </div>
        </Detail>
      )}
    </>
  );
}

export function Accounts({ object, query }: { object: string; query: string }) {
  const { state, run } = useOperations();
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
        rows={state.accounts.map((a) => ({
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
            title="新增服务授权"
            submit="保存授权"
            fields={[
              {
                key: 'projectId',
                label: '服务范围',
                options: state.projects.filter((p) => p.status !== 'exited'),
              },
              { key: 'authorizer', label: '授权方' },
              {
                key: 'reference',
                label: '授权依据',
                hint: '合同、授权文件或可核查凭据的位置',
              },
              {
                key: 'until',
                label: '有效至（本机时区）',
                type: 'datetime-local',
              },
              {
                key: 'data',
                label: '授权数据范围',
                hint: '按授权原文填写，例如公开播放数据；不代表已接入。',
              },
              {
                key: 'shared',
                label: '跨服务共享批准依据',
                optional: true,
                hint: '账号已服务其他客户/项目时必填。',
              },
            ]}
            description="此授权允许内容发布，自保存时生效。账号归属方自动取自档案；客户自动取自所选服务。"
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
                    authorizerPartyId: v.authorizer,
                    authorizationRef: v.reference,
                    allowedActions: ['publish'],
                    allowedData: [v.data],
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
          if (!value) setError('该素材文件不在当前浏览器，请核查原文件。');
        } else if (value?.startsWith('blob:')) URL.revokeObjectURL(value);
      })
      .catch(() => {
        if (alive) setError('读取素材失败，请检查浏览器存储。');
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
  const { state, run } = useOperations();
  const content = state.contentIdentities.find((x) => x.id === object);
  return (
    <>
      <Notice>
        按内容身份管理所有语言版本。同一内容只选一个版本发布一次；已发布或结果待核对时不能释放重发。
      </Notice>
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
                { key: 'source', label: '原始内容来源' },
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
          { key: 'rights', label: '权利依据' },
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
        description="文件保存在当前浏览器；指纹自动计算，不上传外部。请先人工核对故事范围与重叠情况；指纹只能识别文件相同，不能判断剧情重复。"
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
        rows={state.contentIdentities.map((x) => ({
          id: x.id,
          search: `${x.title} ${x.sourceRef} ${lookup(state, x.assignedAccountId)} ${label(x.allocationStatus)}`,
          cells: [
            <Link key="n" page="content" id={x.id}>
              {x.title}
            </Link>,
            x.sourceRef,
            x.assignedAccountId ? lookup(state, x.assignedAccountId) : '待分配',
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
                        (r) => r.accountId === a.id && validRelation(r),
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
