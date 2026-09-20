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
const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
type Props = { object: string; query: string };

export function Rules({ object, query }: Props) {
  const { state, run } = useOperations();
  const rule = state.strategyRules.find((r) => r.id === object);
  return (
    <>
      <Notice>
        规则按服务范围和类别版本化。修改同一类别会替代旧版；已生成策略保留原规则快照，重新制定策略才会使用新版。
      </Notice>
      <Form
        id="rule-new"
        title="新增或修订规则"
        submit="保存规则版本"
        fields={[
          {
            key: 'project',
            label: '服务范围',
            options: state.projects.filter((p) => p.status === 'active'),
          },
          {
            key: 'category',
            label: '依据类别',
            options: options(
              ['external_constraint', 'internal_rule', 'unverified_hypothesis'],
              names,
            ),
          },
          { key: 'statement', label: '规则陈述', type: 'textarea' },
          { key: 'source', label: '来源 / 证据' },
        ]}
        onSubmit={(v) =>
          run((e, c) =>
            e.addStrategyRule(
              {
                projectId: v.project,
                category: v.category as StrategyRule['category'],
                statement: v.statement,
                sourceRef: v.source,
              },
              c,
            ),
          )
        }
      />
      <List
        query={query}
        columns={['规则', '服务范围', '类别', '版本 / 状态']}
        rows={state.strategyRules.map((r) => ({
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
              ['服务范围', lookup(state, rule.projectId)],
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
  const { state, run, now } = useOperations();
  const draft = state.strategyDrafts.find((d) => d.id === object);
  return (
    <>
      <Notice>
        选择服务和内容后，自动带入归属账号与当前规则。当前为本地规则辅助组装，需要人工审阅；外部
        AI 未接入。
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
              label: '服务范围',
              options: state.projects.filter((p) => p.status === 'active'),
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
              label: '导流入口',
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
            { key: 'rationale', label: '选择依据', type: 'textarea' },
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
                outputMode: 'controlled',
                rationale: v.rationale,
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
        columns={['内容 / 策略', '服务范围', '目标账号', '批准情况']}
        rows={state.strategyDrafts.map((d) => ({
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
              ['服务范围', lookup(state, draft.projectId)],
              ['归属账号', lookup(state, draft.accountId)],
              [
                '导流版本',
                state.destinationVersions.find(
                  (d) => d.id === draft.destinationVersionId,
                )?.url,
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
  const { state, run, now } = useOperations();
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
          rows={state.executionApprovals.map((a) => ({
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
  const { state, run } = useOperations();
  const entry = state.destinationEntries.find((d) => d.id === object);
  const version = state.destinationVersions.find(
    (v) => v.id === entry?.activeVersionId,
  );
  return (
    <>
      <Notice>
        这里维护导流目的地、权限、退出约定和历史版本。登记 URL
        不证明目的地可达；当前没有在线短链或真实点击采集接入。
      </Notice>
      <Form
        id="destination-new"
        title="新增导流入口"
        submit="保存入口"
        fields={(v) => [
          {
            key: 'project',
            label: '服务范围',
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
        rows={state.destinationEntries.map((d) => {
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
              ['服务范围', lookup(state, entry.projectId)],
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
