'use client';
import { ExecutionQueue } from './runtime';
import React from 'react';
import { useOperations } from '@/lib/operations-context';
import { label, lookup, names, validRelation } from '@/lib/operations';
import {
  Detail,
  Facts,
  Form,
  Link,
  List,
  Notice,
  Panel,
  Status,
  date,
  iso,
  options,
} from './shared';
import type { DestinationHealth, StrategyRule } from '@/lib/first-loop/types';
import {
  strategyTemplates,
  ruleTemplates,
  type StrategyTemplateId,
} from '@/lib/first-loop/catalog';
const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
type Props = { object: string; query: string };

export function Rules({ object, query }: Props) {
  const { state, run, projectId } = useOperations();
  const rule = state.strategyRules.find((r) => r.id === object);
  return (
    <>
      <Notice>
        优先使用内置规则。每条规则独立版本化，同类别可以并存；修订只替换该规则，已生成策略保留原版本快照。
      </Notice>
      <Form
        id="rule-new"
        title="新增或修订规则"
        submit="保存规则版本"
        fields={(v) => [
          {
            key: 'project',
            label: '运营项目',
            options: state.projects.filter((p) => p.status === 'active'),
            initial: projectId,
          },
          {
            key: 'template',
            label: '规则模板',
            options: [
              ...ruleTemplates,
              { id: 'custom', name: '高级：自定义规则 / 假设' },
            ],
            initial: 'identity',
          },
          ...(v.template === 'custom'
            ? [
                {
                  key: 'revises',
                  label: '修订已有规则',
                  optional: true,
                  options: state.strategyRules
                    .filter(
                      (r) =>
                        r.projectId === v.project &&
                        r.status === 'active' &&
                        !r.ruleKey?.startsWith('builtin:'),
                    )
                    .map((r) => ({ id: r.ruleKey ?? r.id, name: r.statement })),
                },
                {
                  key: 'category',
                  label: '依据类别',
                  options: options(
                    [
                      'external_constraint',
                      'internal_rule',
                      'unverified_hypothesis',
                    ],
                    names,
                  ),
                },
                {
                  key: 'statement',
                  label: '规则陈述',
                  type: 'textarea' as const,
                },
                { key: 'source', label: '来源 / 证据' },
              ]
            : []),
        ]}
        onSubmit={(v) =>
          run((e, c) =>
            e.addStrategyRule(
              {
                projectId: v.project,
                ruleKey:
                  v.template === 'custom'
                    ? v.revises || undefined
                    : `builtin:${v.template}`,
                category:
                  ruleTemplates.find((t) => t.id === v.template)?.category ??
                  (v.category as StrategyRule['category']),
                statement:
                  ruleTemplates.find((t) => t.id === v.template)?.statement ??
                  v.statement,
                sourceRef:
                  ruleTemplates.find((t) => t.id === v.template)?.sourceRef ??
                  v.source,
              },
              c,
            ),
          )
        }
      />
      <List
        query={query}
        columns={['规则', '运营项目', '类别', '版本 / 状态']}
        rows={state.strategyRules
          .filter((r) => !projectId || r.projectId === projectId)
          .map((r) => ({
            id: r.id,
            search: `${r.statement} ${lookup(state, r.projectId)} ${label(r.category)}`,
            cells: [
              <Link key="n" page="rules" id={r.id}>
                {r.statement}
              </Link>,
              lookup(state, r.projectId),
              label(r.category),
              `v${r.version} · ${r.status === 'active' ? '当前' : '历史'}`,
            ],
          }))}
        empty="暂无规则。请记录有来源的外部约束、内部规则或待验证假设。"
      />
      {rule && (
        <Detail page="rules" title="规则依据">
          <Facts
            items={[
              ['运营项目', lookup(state, rule.projectId)],
              ['规则', rule.statement],
              ['来源', rule.sourceRef],
              ['类别', label(rule.category)],
              ['版本', `v${rule.version}`],
            ]}
          />
          <Link page="strategies">使用规则制定策略</Link>
        </Detail>
      )}
    </>
  );
}
export function Strategies({ object, query }: Props) {
  const { state, run, now, projectId } = useOperations();
  const draft = state.strategyDrafts.find((d) => d.id === object);
  return (
    <>
      <Notice>
        选择模板和独占内容，自动引用账号授权与当前规则。普通发布无需导流地址；预检是可选模式，不是正式发布的前置任务。模板组装不是
        AI 生成，Artemis 仍负责真机识别与执行决策。
        新手机请先到 <Link page="accounts">账号管理</Link>，在账号详情的“接入 Page / 频道”中选择“手机初始化”业务模板；初始化不需要素材，也不会生成发布计划。
      </Notice>
      <Form
        id="strategy-new"
        title="制定策略草案"
        submit="保存待审草案"
        fields={(v) => {
          const relationAccounts = state.accountServiceRelations
            .filter((r) => r.projectId === v.project && validRelation(r))
            .map((r) => r.accountId);
          const content = state.contentIdentities.find(
            (i) => i.id === v.content,
          );
          return [
            {
              key: 'project',
              label: '运营项目',
              options: state.projects.filter((p) => p.status === 'active'),
              initial: projectId,
            },
            {
              key: 'template',
              label: '策略模板',
              options: [...strategyTemplates],
              initial: 'daily_clip',
            },
            {
              key: 'content',
              label: '合格的独占内容',
              options: state.contentIdentities
                .filter(
                  (i) =>
                    !i.firstPublishedAt &&
                    i.assignedAccountId &&
                    relationAccounts.includes(i.assignedAccountId) &&
                    state.sliceAssets.some(
                      (s) =>
                        s.contentIdentityId === i.id &&
                        s.destinationFit === 'eligible' &&
                        (!s.rightsValidUntil ||
                          Date.parse(s.rightsValidUntil) > now),
                    ),
                )
                .map((i) => ({
                  id: i.id,
                  name: `${i.title} · ${lookup(state, i.assignedAccountId)}`,
                })),
            },
            {
              key: 'entry',
              label: '导流目的地',
              optional: v.template !== 'traffic',
              hint: '日常发布可留空；身份主页不是必须填写的导流地址。',
              options: state.destinationEntries
                .filter(
                  (d) =>
                    d.projectId === v.project &&
                    d.accountId === content?.assignedAccountId &&
                    (d.scope === 'channel' || d.scopeId === content?.id) &&
                    state.destinationVersions.some(
                      (x) =>
                        x.id === d.activeVersionId &&
                        x.isActive &&
                        x.health === 'available',
                    ),
                )
                .map((d) => ({
                  id: d.id,
                  name: `${label(d.scope)} · ${state.destinationVersions.find((x) => x.id === d.activeVersionId)?.url}`,
                })),
            },
            {
              key: 'rationale',
              label: '补充说明',
              type: 'textarea',
              optional: true,
            },
            {
              key: 'assumptions',
              label: '仍需验证的假设',
              type: 'textarea',
              optional: true,
            },
          ];
        }}
        onSubmit={(v) =>
          run((e, c) =>
            e.generateStrategyDraft(
              {
                projectId: v.project,
                contentIdentityId: v.content,
                destinationEntryId: v.entry,
                templateId: v.template as StrategyTemplateId,
                outputMode: 'controlled',
                rationale: `${strategyTemplates.find((t) => t.id === v.template)?.rationale ?? ''}${v.rationale ? `\n补充：${v.rationale}` : ''}`,
                assumptions: v.assumptions ? [v.assumptions] : [],
              },
              c,
            ),
          )
        }
      >
        <div className="op-row op-help">
          <Link page="clients">激活服务</Link>
          <Link page="accounts">维护授权</Link>
          <Link page="content">准入并分配内容</Link>
          <Link page="destinations">登记入口</Link>
          <Link page="rules">维护规则</Link>
        </div>
      </Form>
      <List
        query={query}
        columns={['内容 / 策略', '运营项目', '目标账号', '批准情况']}
        rows={state.strategyDrafts
          .filter((d) => !projectId || d.projectId === projectId)
          .map((d) => ({
            id: d.id,
            search: `${lookup(state, d.contentIdentityId)} ${lookup(state, d.projectId)} ${lookup(state, d.accountId)}`,
            cells: [
              <Link key="n" page="strategies" id={d.id}>
                {lookup(state, d.contentIdentityId)} · v{d.version}
              </Link>,
              lookup(state, d.projectId),
              lookup(state, d.accountId),
              state.executionApprovals.some(
                (a) =>
                  a.strategyDraftId === d.id &&
                  a.status === 'active' &&
                  Date.parse(a.validUntil) > now,
              )
                ? '已有有效批准'
                : '待审 / 待重新批准',
            ],
          }))}
      />
      {draft && (
        <Detail
          page="strategies"
          title={`${lookup(state, draft.contentIdentityId)} · 策略 v${draft.version}`}
        >
          <Facts
            items={[
              ['运营项目', lookup(state, draft.projectId)],
              ['归属账号', lookup(state, draft.accountId)],
              [
                '导流版本',
                state.destinationVersions.find(
                  (d) => d.id === draft.destinationVersionId,
                )?.url ?? '不使用导流目的地',
              ],
              ['选择依据', draft.rationale],
              ['待验证假设', draft.assumptions.join('；') || '未记录'],
            ]}
          />
          <Panel title="本次引用的规则">
            {draft.ruleIds.map((id) => {
              const rule = state.strategyRules.find((r) => r.id === id);
              return (
                <p className="op-record" key={id}>
                  {rule?.statement}{' '}
                  <Link page="rules" id={id}>
                    查看来源 · v{rule?.version}
                  </Link>
                </p>
              );
            })}
          </Panel>
          {!state.executionApprovals.some(
            (a) =>
              a.strategyDraftId === draft.id &&
              a.status === 'active' &&
              Date.parse(a.validUntil) > now,
          ) && (
            <Form
              id={`approve-${draft.id}`}
              title="审阅并批准本次执行"
              submit="确认以上范围，批准一次发布"
              description="当前草案仅包含一个内容身份，批准数量固定为 1；授权不是平台执行。下列观察定义会直接带入数据记录。所有时间均使用本机时区。"
              fields={[
                { key: 'from', label: '批准起始时间', type: 'datetime-local' },
                { key: 'until', label: '批准截止时间', type: 'datetime-local' },
                { key: 'stop', label: '停止条件', type: 'textarea' },
                { key: 'metric', label: '主观察指标' },
                {
                  key: 'direction',
                  label: '预期改善方向',
                  options: [
                    { id: 'increase', name: '数值上升' },
                    { id: 'decrease', name: '数值下降' },
                  ],
                },
                { key: 'unit', label: '指标单位' },
                { key: 'source', label: '预定数据来源' },
                {
                  key: 'scope',
                  label: '统计范围',
                  hint: '例如该账号的本条内容；不是随意扩大到整个项目。',
                },
                { key: 'start', label: '观察窗口起始', type: 'datetime-local' },
                { key: 'end', label: '观察窗口截止', type: 'datetime-local' },
                {
                  key: 'criterion',
                  label: '观察与判定条件',
                  type: 'textarea',
                  hint: '明确如何判断；数据缺失时保留未知。',
                },
                {
                  key: 'cost',
                  label: '本次费用上限',
                  type: 'number',
                  optional: true,
                },
              ]}
              onSubmit={(v) =>
                run((e, c) =>
                  e.approveStrategy(
                    {
                      strategyDraftId: draft.id,
                      expectedStrategyVersion: draft.version,
                      quantity: 1,
                      validFrom: iso(v.from),
                      validUntil: iso(v.until),
                      stopConditions: [v.stop],
                      observationConditions: [v.criterion],
                      observationPlan: {
                        metricKey: v.metric,
                        direction: v.direction as 'increase' | 'decrease',
                        unit: v.unit,
                        source: v.source,
                        scope: v.scope,
                        windowStart: iso(v.start),
                        windowEnd: iso(v.end),
                      },
                      costLimit: v.cost ? Number(v.cost) : undefined,
                    },
                    c,
                  ),
                )
              }
            />
          )}
          {state.executionApprovals
            .filter((a) => a.strategyDraftId === draft.id)
            .map((a) => (
              <p className="op-record" key={a.id}>
                {label(a.status)} · {date(a.validFrom)} 至 {date(a.validUntil)}{' '}
                ·{' '}
                <Link page="plans" id={a.id}>
                  查看批准与排期
                </Link>
              </p>
            ))}
        </Detail>
      )}
    </>
  );
}
export function Plans({ object, query }: Props) {
  const { state, run, now, projectId } = useOperations();
  const selectedSchedule = state.publicationSchedules.find(
    (s) => s.id === object,
  );
  const approval = state.executionApprovals.find(
    (a) => a.id === (selectedSchedule?.approvalId ?? object),
  );
  return (
    <>
      <Notice>
        排期保存后需核对素材、账号绑定与发布参数，再加入设备队列。执行结果以归档回执证据为准。
      </Notice>
      <Panel title="批准与排期">
        <List
          query={query}
          columns={['批准内容', '服务 / 账号', '有效期', '批准状态', '排期']}
          rows={state.executionApprovals
            .filter((a) => !projectId || a.projectId === projectId)
            .map((a) => ({
              id: a.id,
              search: `${lookup(state, a.contentIdentityId)} ${lookup(state, a.projectId)} ${lookup(state, a.accountId)}`,
              cells: [
                <Link key="n" page="plans" id={a.id}>
                  {lookup(state, a.contentIdentityId)} · v{a.strategyVersion}
                </Link>,
                `${lookup(state, a.projectId)} / ${lookup(state, a.accountId)}`,
                `${date(a.validFrom)} — ${date(a.validUntil)}`,
                a.status === 'active' && Date.parse(a.validUntil) <= now
                  ? '已到期'
                  : label(a.status),
                state.publicationSchedules.filter(
                  (s) =>
                    s.approvalId === a.id &&
                    s.status === 'scheduled' &&
                    Date.parse(s.expiresAt) > now,
                ).length
                  ? '有待执行排期'
                  : '无待执行排期',
              ],
            }))}
          empty="暂无批准。先审阅策略并明确停止和观察条件。"
        />
      </Panel>
      {approval && (
        <Detail
          page="plans"
          title={`${lookup(state, approval.contentIdentityId)}的执行范围`}
        >
          {approval.status === 'active' && (
            <Form
              id={`cancel-approval-${approval.id}`}
              title="撤销本次批准"
              fields={[{ key: 'reason', label: '撤销原因' }]}
              submit="确认撤销批准及待执行排期"
              description="撤销后可重新制定并批准策略。存在未核对或已公开的执行结果时不允许使用此操作。"
              onSubmit={(v) =>
                run((e, c) => e.cancelApproval(approval.id, v.reason, c))
              }
            />
          )}
          <Facts
            items={[
              [
                '服务 / 账号',
                `${lookup(state, approval.projectId)} / ${lookup(state, approval.accountId)}`,
              ],
              ['数量', `${approval.quantity} 次`],
              [
                '有效期',
                `${date(approval.validFrom)} — ${date(approval.validUntil)}`,
              ],
              ['停止条件', approval.stopConditions.join('；')],
              ['观察条件', approval.observationConditions.join('；')],
              [
                '状态',
                approval.status === 'active' &&
                Date.parse(approval.validUntil) <= now
                  ? '已到期'
                  : label(approval.status),
              ],
            ]}
          />
          {approval.status === 'active' &&
            Date.parse(approval.validUntil) > now &&
            !state.publicationSchedules.some(
              (s) =>
                s.approvalId === approval.id &&
                ['scheduled', 'started'].includes(s.status) &&
                Date.parse(s.expiresAt) > now,
            ) && (
              <Form
                id={`schedule-${approval.id}`}
                title="安排发布时间"
                submit="保存排期"
                description={`按本机时区 ${browserTimezone()} 输入，保存为统一时间。起止须落在批准有效期内；错过后不自动补发。`}
                fields={[
                  { key: 'at', label: '计划发布时间', type: 'datetime-local' },
                  {
                    key: 'until',
                    label: '本次排期截止时间',
                    type: 'datetime-local',
                  },
                ]}
                onSubmit={(v) =>
                  run((e, c) =>
                    e.scheduleApproval(
                      {
                        approvalId: approval.id,
                        businessTimezone: browserTimezone(),
                        scheduledFor: iso(v.at),
                        expiresAt: iso(v.until),
                      },
                      c,
                    ),
                  )
                }
              />
            )}
          {state.publicationSchedules
            .filter((s) => s.approvalId === approval.id)
            .map((s) => (
              <section className="op-record" key={s.id}>
                <h3>
                  {date(s.scheduledFor)}{' '}
                  <Status>
                    {s.status === 'scheduled' && Date.parse(s.expiresAt) <= now
                      ? '已过期，不补发'
                      : label(s.status)}
                  </Status>
                </h3>
                <p className="op-help">
                  截止 {date(s.expiresAt)} · {s.businessTimezone}
                </p>
                <ExecutionQueue scheduleId={s.id} />
                {s.status === 'scheduled' && (
                  <Form
                    id={`cancel-${s.id}`}
                    title="取消本次排期与批准"
                    fields={[{ key: 'reason', label: '取消原因' }]}
                    submit="确认取消"
                    onSubmit={(v) =>
                      run((e, c) => e.cancelSchedule(s.id, v.reason, c))
                    }
                  />
                )}
              </section>
            ))}
          <div className="op-row">
            <Link page="receipts">核查执行记录</Link>
            <Link page="metrics" id={approval.id}>
              记录观察数据
            </Link>
            <Link page="strategies" id={approval.strategyDraftId}>
              返回策略依据
            </Link>
          </div>
        </Detail>
      )}
    </>
  );
}
export function Destinations({ object, query }: Props) {
  const { state, run, projectId } = useOperations();
  const entry = state.destinationEntries.find((d) => d.id === object);
  const version = state.destinationVersions.find(
    (v) => v.id === entry?.activeVersionId,
  );
  return (
    <>
      <Notice>
        仅导流策略需要此处配置。账号身份地址在账号接入中核验，已发布帖子地址在任务回执中查看；不要把这三类地址混作必填项。登记
        URL 不证明目的地可达；当前没有在线短链或真实点击采集接入。
      </Notice>
      <Form
        id="destination-new"
        title="新增导流入口"
        submit="保存入口"
        fields={(v) => [
          {
            key: 'project',
            label: '运营项目',
            initial: projectId,
            options: state.projects.filter((p) => p.status === 'active'),
          },
          {
            key: 'account',
            label: '已授权账号',
            options: state.accounts.filter((a) =>
              state.accountServiceRelations.some(
                (r) =>
                  r.projectId === v.project &&
                  r.accountId === a.id &&
                  validRelation(r),
              ),
            ),
          },
          {
            key: 'scope',
            label: '入口范围',
            options: options(['channel', 'content'], names),
          },
          ...(v.scope === 'content'
            ? [
                {
                  key: 'content',
                  label: '关联内容',
                  options: state.contentIdentities
                    .filter((i) => i.assignedAccountId === v.account)
                    .map((i) => ({ id: i.id, name: i.title })),
                },
              ]
            : []),
          { key: 'url', label: '目的地地址', type: 'url' },
          { key: 'permission', label: '维护权限依据' },
          {
            key: 'exit',
            label: '合作退出后如何处理',
            options: options(['disable', 'continue'], names),
          },
        ]}
        onSubmit={(v) =>
          run((e, c) =>
            e.createDestination(
              {
                projectId: v.project,
                accountId: v.account,
                scope: v.scope as 'channel' | 'content',
                scopeId: v.scope === 'channel' ? v.account : v.content,
                url: v.url,
                maintenancePermissionRef: v.permission,
                sharedAttribution: v.scope === 'channel',
                exitPolicy: v.exit as 'continue' | 'disable',
              },
              c,
            ),
          )
        }
      />
      <List
        query={query}
        columns={[
          '当前目的地',
          '服务 / 账号',
          '范围',
          '本地准入状态',
          '退出约定',
        ]}
        rows={state.destinationEntries
          .filter((d) => !projectId || d.projectId === projectId)
          .map((d) => {
            const v = state.destinationVersions.find(
              (x) => x.id === d.activeVersionId,
            );
            return {
              id: d.id,
              search: `${v?.url} ${lookup(state, d.projectId)} ${lookup(state, d.accountId)}`,
              cells: [
                <Link key="n" page="destinations" id={d.id}>
                  {v?.url}
                </Link>,
                `${lookup(state, d.projectId)} / ${lookup(state, d.accountId)}`,
                label(d.scope),
                v ? label(v.health) : '无当前版本',
                label(d.exitPolicy),
              ],
            };
          })}
      />
      {entry && version && (
        <Detail page="destinations" title="入口详情与变更历史">
          <Facts
            items={[
              ['运营项目', lookup(state, entry.projectId)],
              ['账号', lookup(state, entry.accountId)],
              [
                '当前地址',
                <a
                  key="url"
                  className="op-link"
                  href={version.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {version.url}
                </a>,
              ],
              ['维护依据', entry.maintenancePermissionRef],
              ['退出约定', label(entry.exitPolicy)],
              [
                '归因边界',
                entry.sharedAttribution
                  ? '频道入口共享；不能归因到某条内容'
                  : '内容专属入口',
              ],
            ]}
          />
          <Form
            id={`entry-${entry.id}`}
            title="更新目的地或状态"
            submit="保存新版本"
            description="影响引用旧版本的批准与排期；历史内容、旧事件仍保留原版本。"
            fields={[
              {
                key: 'url',
                label: '新目的地地址',
                type: 'url',
                initial: version.url,
              },
              {
                key: 'health',
                label: '核对状态',
                options: options(
                  [
                    'available',
                    'service_failure',
                    'destination_invalid',
                    'platform_restricted',
                  ],
                  names,
                ),
              },
              { key: 'reason', label: '变更原因与依据' },
            ]}
            onSubmit={(v) =>
              run((e, c) =>
                e.updateDestination(
                  entry.id,
                  {
                    url: v.url,
                    health: v.health as DestinationHealth,
                    changeReason: v.reason,
                    permissionRef: entry.maintenancePermissionRef,
                  },
                  c,
                ),
              )
            }
          />
          <Panel title="版本历史">
            {state.destinationVersions
              .filter((v) => v.destinationEntryId === entry.id)
              .slice()
              .reverse()
              .map((v) => (
                <p key={v.id} className="op-record">
                  {v.isActive ? '当前' : '历史'} · {date(v.createdAt)} · {v.url}
                  <br />
                  {label(v.health)} · {v.changeReason}
                </p>
              ))}
          </Panel>
          <Panel title="事件证据">
            <Facts
              items={[
                [
                  '原始访问',
                  state.destinationEvents.filter(
                    (e) =>
                      e.destinationEntryId === entry.id &&
                      e.eventType === 'raw_visit',
                  ).length,
                ],
                [
                  '过滤后点击',
                  state.destinationEvents.filter(
                    (e) =>
                      e.destinationEntryId === entry.id &&
                      e.eventType === 'filtered_click',
                  ).length,
                ],
                [
                  '重定向响应',
                  state.destinationEvents.filter(
                    (e) =>
                      e.destinationEntryId === entry.id &&
                      e.eventType === 'redirect_response',
                  ).length,
                ],
              ]}
            />
            <p className="op-help">
              以上为已记录事件数，零条不代表真实访问为零。302
              响应不证明目的地到达、播放或转化。
            </p>
          </Panel>
        </Detail>
      )}
    </>
  );
}
