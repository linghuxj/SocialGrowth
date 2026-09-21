'use client';
import {
  DeviceBindings,
  RuntimeReceipts,
  RuntimeDiagnostics,
  LegacyWorkspace,
} from './runtime';
import { DeviceFarmMonitor } from './device-farm';
import React from 'react';
import { useOperations } from '@/lib/operations-context';
import {
  label,
  lookup,
  names,
  reviewedCompletion,
  taskList,
  projectView,
} from '@/lib/operations';
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
  fail,
  iso,
  options,
  MetricCard,
} from './shared';
import type { BasicReview, MetricAvailability } from '@/lib/first-loop/types';
type Props = { object: string; query: string };

export function Home({ query }: Props) {
  const { state: fullState, projectId } = useOperations();
  const state = projectView(fullState, projectId);
  const tasks = taskList(state);
  return (
    <>
      <p className="op-intro">从需要处理的事项开始，按业务进度进入对应页面。</p>

      {/* 核心 KPI 审计指标卡网格 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-4">
        <MetricCard
          title="在管账号矩阵"
          value={state.accounts.length}
          unit="个"
          type="observed"
          sourceInfo="真机 1:1 物理绑定"
          description="当前在管的 Facebook / YouTube 平台账号"
        />
        <MetricCard
          title="内容素材资产"
          value={state.contentIdentities.length}
          unit="条"
          type="observed"
          sourceInfo="切片素材排他独占库"
          description="包含主版本及各多语言变体素材"
        />
        <MetricCard
          title="有效排期任务"
          value={state.publicationSchedules.length}
          unit="项"
          type="plan"
          sourceInfo="待执行与进行中排期"
          description="经策略审批的真机发布指令"
        />
        <MetricCard
          title="待确认复盘"
          value={state.basicReviews.filter((r) => !r.confirmedAt).length}
          unit="项"
          type="hypothetical"
          sourceInfo="A/B 与小样本业务复盘"
          description="待单人审计核验的复盘记录"
        />
      </div>

      <div className="my-6">
        <DeviceFarmMonitor />
      </div>

      {!state.clients.length && (
        <Panel title="建立运营工作区">
          <p>
            先建立自营或代运营项目，再接入账号与授权。继承素材默认值并核对内容后，选择策略模板、批准和排期；普通发布无需导流目的地。
          </p>
          <div className="op-row">
            <Link page="clients">建立运营项目</Link>
            <Link page="accounts">登记账号</Link>
            <Link page="connections">查看接入范围</Link>
          </div>
        </Panel>
      )}
      <Panel title="待办事项">
        <List
          query={query}
          columns={['待处理事项', '原因', '优先级']}
          empty="没有待办记录；这不代表外部服务已运行或效果已达成。"
          rows={tasks.map((t) => ({
            id: t.id,
            search: `${t.title} ${t.reason}`,
            cells: [
              <Link key="n" page={t.page} id={t.object}>
                {t.title}
              </Link>,
              t.reason,
              t.urgent ? '优先核对' : '常规处理',
            ],
          }))}
        />
      </Panel>
      <Panel title="业务入口">
        <div className="op-row">
          <Link page="accounts">账号 {state.accounts.length}</Link>
          <Link page="content">内容 {state.contentIdentities.length}</Link>
          <Link page="plans">发布计划</Link>
          <Link page="metrics">数据表现</Link>
          <Link page="reviews">
            待确认复盘 {state.basicReviews.filter((r) => !r.confirmedAt).length}
          </Link>
        </div>
      </Panel>
      <Notice>
        业务状态与素材保存至本机执行服务。真机任务须经过账号绑定、参数核对和明确批准；外部
        AI 策略、在线短链与指标自动采集仍待接入。
      </Notice>
    </>
  );
}
export function Receipts({
  object,
  query,
  exceptions = false,
}: Props & { exceptions?: boolean }) {
  const { state: fullState, projectId } = useOperations();
  const state = projectView(fullState, projectId);
  const attempt = state.publicationAttempts.find((a) => a.id === object);
  const records = state.publicationAttempts.filter(
    (a) => !exceptions || ['unknown', 'in_progress'].includes(a.publishStatus),
  );
  return (
    <>
      <Notice>
        {exceptions
          ? '结果未知或处理中时禁止盲目重发。先由执行方核对原始证据；确认未公开后才可解除相关限制。'
          : '执行记录来自真机回执与归档证据；任务完成不等于帖子已公开。'}
      </Notice>
      <RuntimeReceipts exceptions={exceptions} query={query} object={object} />
      <List
        query={query}
        columns={['内容', '目标账号', '结果', '证据', '最近更新']}
        rows={records.map((a) => ({
          id: a.id,
          search: `${lookup(state, a.contentIdentityId)} ${lookup(state, a.accountId)} ${label(a.publishStatus)}`,
          cells: [
            <Link
              key="n"
              page={exceptions ? 'exceptions' : 'receipts'}
              id={a.id}
            >
              {lookup(state, a.contentIdentityId)}
            </Link>,
            lookup(state, a.accountId),
            <Status key="s">{label(a.publishStatus)}</Status>,
            a.evidenceRefs.length,
            date(a.updatedAt),
          ],
        }))}
        empty={
          exceptions
            ? '没有待核对执行回执。'
            : '尚未收到执行回执；保存排期不会生成执行结果。'
        }
      />
      {attempt && (
        <Detail
          page={exceptions ? 'exceptions' : 'receipts'}
          title={lookup(state, attempt.contentIdentityId)}
        >
          <Facts
            items={[
              ['账号', lookup(state, attempt.accountId)],
              ['执行状态', label(attempt.publishStatus)],
              ['证据引用', attempt.evidenceRefs.join('；') || '无'],
              ['记录时间', date(attempt.updatedAt)],
            ]}
          />
          {['unknown', 'in_progress'].includes(attempt.publishStatus) && (
            <Notice>请在上方设备队列中上传核对证据并记录结论。</Notice>
          )}
          <Link page="content" id={attempt.contentIdentityId}>
            查看内容与归属
          </Link>
        </Detail>
      )}
    </>
  );
}
export function Metrics({ object, query }: Props) {
  const { state: fullState, run, projectId } = useOperations();
  const state = projectView(fullState, projectId);
  const approval = state.executionApprovals.find((a) => a.id === object);
  const plan = approval?.observationPlan;
  return (
    <>
      <Notice>
        按已批准的指标、来源、单位和统计范围记录。缺失、延迟和无权限分别标记；只有明确零值才记为
        0。当前手工记录为本地受控数据。
      </Notice>
      <Panel title="观察计划">
        <List
          query={query}
          columns={['批准内容', '服务范围', '主指标', '观察窗口', '已记录']}
          rows={state.executionApprovals.map((a) => ({
            id: a.id,
            search: `${lookup(state, a.projectId)} ${lookup(state, a.contentIdentityId)} ${a.observationPlan?.metricKey}`,
            cells: [
              <Link key="n" page="metrics" id={a.id}>
                {lookup(state, a.contentIdentityId)} · v{a.strategyVersion}
              </Link>,
              lookup(state, a.projectId),
              a.observationPlan?.metricKey ?? '未定义',
              a.observationPlan
                ? `${date(a.observationPlan.windowStart)} — ${date(a.observationPlan.windowEnd)}`
                : '待定义',
              state.metricObservations.filter((o) => o.approvalId === a.id)
                .length,
            ],
          }))}
        />
      </Panel>
      {approval && (
        <Detail
          page="metrics"
          title={`${lookup(state, approval.contentIdentityId)}的观察`}
        >
          <Facts
            items={[
              ['主指标', plan?.metricKey],
              ['单位', plan?.unit],
              ['来源', plan?.source],
              ['统计范围', plan?.scope],
              ['观察条件', approval.observationConditions.join('；')],
            ]}
          />
          {plan ? (
            <Form
              id={`metric-${approval.id}`}
              title="记录本次观察"
              submit="保存观察记录"
              description="当前数据沿用批准时的观察窗口；基线使用对应比较窗口。两者的单位、范围及来源须可比较。"
              fields={(v) => [
                {
                  key: 'role',
                  label: '比较角色',
                  options: options(['baseline', 'current'], names),
                },
                {
                  key: 'availability',
                  label: '数据可得性',
                  options: options(
                    [
                      'observed_value',
                      'observed_zero',
                      'missing',
                      'delayed',
                      'unauthorized',
                    ],
                    names,
                  ),
                },
                ...(v.availability === 'observed_value'
                  ? [
                      {
                        key: 'value',
                        label: `观察数值（${plan.unit}）`,
                        type: 'number' as const,
                      },
                    ]
                  : []),
                ...(v.role === 'baseline'
                  ? [
                      {
                        key: 'start',
                        label: '基线窗口起始（本机时区）',
                        type: 'datetime-local' as const,
                      },
                      {
                        key: 'end',
                        label: '基线窗口截止（本机时区）',
                        type: 'datetime-local' as const,
                      },
                    ]
                  : []),
                { key: 'evidence', label: '数据证据或缺失原因' },
              ]}
              onSubmit={(v) =>
                run((e, c) =>
                  e.recordMetricObservation(
                    {
                      ...plan,
                      projectId: approval.projectId,
                      approvalId: approval.id,
                      strategyVersion: approval.strategyVersion,
                      comparisonRole: v.role as 'baseline' | 'current',
                      availability: v.availability as MetricAvailability,
                      value:
                        v.availability === 'observed_value'
                          ? Number(v.value)
                          : v.availability === 'observed_zero'
                            ? 0
                            : undefined,
                      windowStart:
                        v.role === 'baseline' ? iso(v.start) : plan.windowStart,
                      windowEnd:
                        v.role === 'baseline' ? iso(v.end) : plan.windowEnd,
                      controlledData: true,
                    },
                    { ...c, evidenceRefs: [v.evidence] },
                  ),
                )
              }
            />
          ) : (
            <Notice>
              此批准没有观察计划，请返回策略明确指标定义后重新批准。
            </Notice>
          )}
          <Link page="reviews" id={approval.id}>
            查看并发起复盘
          </Link>
        </Detail>
      )}
      <Panel title="已记录的数据">
        <List
          query={query}
          columns={[
            '内容 / 策略',
            '指标',
            '数值 / 状态',
            '来源 / 单位',
            '角色',
            '时间窗',
          ]}
          rows={state.metricObservations
            .filter((o) => !approval || o.approvalId === approval.id)
            .map((o) => {
              const a = state.executionApprovals.find(
                (a) => a.id === o.approvalId,
              );
              return {
                id: o.id,
                search: `${lookup(state, o.projectId)} ${lookup(state, a?.contentIdentityId)} ${o.metricKey} ${o.source}`,
                cells: [
                  <Link key="n" page="metrics" id={o.approvalId}>
                    {lookup(state, a?.contentIdentityId)} · v{o.strategyVersion}
                  </Link>,
                  o.metricKey,
                  o.availability === 'observed_value' ||
                  o.availability === 'observed_zero'
                    ? o.value
                    : label(o.availability),
                  `${o.source} / ${o.unit}`,
                  label(o.comparisonRole),
                  `${date(o.windowStart)} — ${date(o.windowEnd)}`,
                ],
              };
            })}
        />
      </Panel>
    </>
  );
}
export function Reviews({ object, query }: Props) {
  const { state: fullState, run, projectId } = useOperations();
  const state = projectView(fullState, projectId);
  const review = state.basicReviews.find((r) => r.id === object);
  return (
    <>
      <Notice>
        基础复盘使用批准范围、已记录观察与发布证据。必需工作是否完成由已有回执判定；本地受控数据不能证明真实业务效果。
      </Notice>
      <Form
        id="review-new"
        title="形成基础复盘"
        submit="核对证据并形成复盘"
        fields={[
          {
            key: 'approval',
            label: '已批准的观察范围',
            initial: state.executionApprovals.some((a) => a.id === object)
              ? object
              : '',
            options: state.executionApprovals.map((a) => ({
              id: a.id,
              name: `${lookup(state, a.contentIdentityId)} · ${lookup(state, a.projectId)} · v${a.strategyVersion}`,
            })),
          },
        ]}
        onSubmit={(v) => {
          const a = state.executionApprovals.find((a) => a.id === v.approval);
          if (!a?.observationPlan) return fail('该批准没有主观察指标');
          return run((e, c) =>
            e.createBasicReview(
              {
                projectId: a.projectId,
                approvalId: a.id,
                primaryMetricKey: a.observationPlan!.metricKey,
                requiredWorkComplete: reviewedCompletion(state, a.id),
                sourceComparisonAccepted: false,
              },
              c,
            ),
          );
        }}
      />
      <List
        query={query}
        columns={['服务范围 / 策略', '主指标', '结论', '人工确认', '后续动作']}
        rows={state.basicReviews.map((r) => ({
          id: r.id,
          search: `${lookup(state, r.projectId)} ${r.primaryMetricKey} ${label(r.outcome)}`,
          cells: [
            <Link key="n" page="reviews" id={r.id}>
              {lookup(state, r.projectId)} · v{r.strategyVersion}
            </Link>,
            r.primaryMetricKey,
            label(r.outcome),
            r.confirmedAt ? date(r.confirmedAt) : '待确认',
            r.nextAction ? label(r.nextAction) : '待决定',
          ],
        }))}
      />
      {review && (
        <Detail
          page="reviews"
          title={`${lookup(state, review.projectId)} · 复盘 v${review.strategyVersion}`}
        >
          <Facts
            items={[
              ['主要目标', review.primaryGoalSnapshot],
              ['结论', label(review.outcome)],
              ['事实', review.facts.join('；')],
              ['局限', review.limitations.join('；')],
              ['本地辅助分析', review.aiAnalysis],
              [
                '数据边界',
                review.controlledData ? '包含受控数据' : '按已记录来源核对',
              ],
            ]}
          />
          {!review.confirmedAt && (
            <Form
              id={`review-confirm-${review.id}`}
              title="人工确认复盘"
              submit="确认并记录后续动作"
              fields={[
                {
                  key: 'action',
                  label: '后续动作',
                  options: options(
                    ['continue_observation', 'create_new_draft', 'stop'],
                    names,
                  ),
                },
              ]}
              description="记录决策，不会自动生成策略、发布或终止其他安排；相关操作仍须在对应页面完成。"
              onSubmit={(v) =>
                run((e, c) =>
                  e.confirmReview(
                    review.id,
                    v.action as NonNullable<BasicReview['nextAction']>,
                    c,
                  ),
                )
              }
            />
          )}
          <div className="op-row">
            <Link page="metrics" id={review.approvalId}>
              核对原始观察
            </Link>
            <Link page="plans" id={review.approvalId}>
              查看执行范围
            </Link>
            {review.nextAction === 'create_new_draft' && (
              <Link page="strategies">制定下一版草案</Link>
            )}
          </div>
        </Detail>
      )}
    </>
  );
}
const actionNames: Record<string, string> = {
  'client.updated': '更新客户名称',
  'account.profile_updated': '更新账号资料',
  'account.authorization_granted': '登记服务授权',
  'account.authorization_revoked': '撤销服务授权',
  'strategy.approval_cancelled': '撤销执行批准',
  'observation.recorded': '记录观察数据',
  'publication.attempt_recorded': '记录执行尝试',
  'publication.receipt_recorded': '登记执行回执',
  'publication.receipt_updated': '核对执行回执',
  'destination.event_observed': '记录导流事件',
  'destination.exit_policy_applied': '按约定处理入口退出',
  'schedule.expired_without_backfill': '排期到期，不补发',
  'client.created': '登记客户',
  'account.created': '登记账号',
  'project.saved': '保存服务资料',
  'project.activated': '激活服务',
  'project.exited': '结束服务',
  'account_service_relation.granted': '登记账号授权',
  'account_service_relation.revoked': '撤销账号授权',
  'content.admitted': '登记内容',
  'content.allocated': '分配内容',
  'content.released': '释放内容分配',
  'content.fit_reviewed': '核对素材适配',
  'destination.created': '登记导流入口',
  'destination.updated': '更新导流入口',
  'strategy.rule_versioned': '修订规则',
  'strategy.draft_generated': '制定策略',
  'strategy.approved': '批准执行',
  'schedule.created': '创建排期',
  'schedule.cancelled': '取消排期',
  'metric.observed': '记录观察',
  'review.created': '形成复盘',
  'review.confirmed': '确认复盘',
};
export function Audit({ object, query }: Props) {
  const { state } = useOperations();
  const entry = state.auditLogs.find((e) => e.id === object);
  const exportData = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `socialgrowth-operations-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <>
      <div className="op-row">
        <p className="op-help">
          所有本地业务命令的接受、拒绝与证据引用。操作者为本地开发身份。
        </p>
        <button className="op-button" onClick={exportData}>
          导出完整业务与审计快照
        </button>
      </div>
      <List
        query={query}
        columns={['时间', '操作 / 对象', '结果', '原因', '操作者']}
        rows={state.auditLogs
          .slice()
          .reverse()
          .map((e) => ({
            id: e.id,
            search: `${e.action} ${actionNames[e.action]} ${lookup(state, e.entityId)} ${e.reasonCode} ${e.correlationId} ${label(e.result)} ${JSON.stringify(e.facts)}`,
            cells: [
              <Link key="n" page="audit" id={e.id}>
                {date(e.timestamp)}
              </Link>,
              `${e.result === 'rejected' ? '业务校验拒绝' : (actionNames[e.action] ?? e.action)} / ${lookup(state, e.entityId)}`,
              label(e.result),
              e.reasonCode === 'OK'
                ? '—'
                : typeof e.facts.message === 'string'
                  ? e.facts.message
                  : e.reasonCode,
              e.actorId === 'local-operator' ? '本地操作者' : e.actorId,
            ],
          }))}
      />
      {entry && (
        <Detail page="audit" title={actionNames[entry.action] ?? entry.action}>
          <Facts
            items={[
              ['对象', lookup(state, entry.entityId)],
              ['结果', label(entry.result)],
              ['原因', entry.reasonCode],
              ['关联编号', entry.correlationId],
              ['证据', entry.evidenceRefs.join('；') || '未附引用'],
            ]}
          />
          <pre className="op-json">{JSON.stringify(entry, null, 2)}</pre>
        </Detail>
      )}
    </>
  );
}
export function Connections() {
  return (
    <>
      <Notice>
        当前工作区使用本机执行服务。真机由已配置的 Google Artemis
        环境执行，账号绑定与实际验收按证据分别记录。
      </Notice>
      <DeviceBindings />
      <RuntimeDiagnostics />
      <LegacyWorkspace />
      <List
        query=""
        columns={['能力', '当前状态', '接入后提供', '验收所需']}
        rows={[
          {
            id: 'ai',
            search: '',
            cells: [
              'AI 策略服务',
              '未接入',
              '带来源的策略建议',
              '真实提供方输出与错误回执',
            ],
          },
          {
            id: 'device',
            search: '',
            cells: [
              'Artemis 物理真机',
              '运行时适配已提供，实际状态见绑定与回执',
              '执行调度、原生 App 发布与证据',
              '设备身份、账号路由与真实执行日志',
            ],
          },
          {
            id: 'link',
            search: '',
            cells: [
              '在线导流服务',
              '未接入',
              '短链与访问 / 点击 / 重定向记录',
              '实际部署地址与事件回流',
            ],
          },
          {
            id: 'metrics',
            search: '',
            cells: [
              '指标来源',
              '未接入',
              '授权范围内的观察数据',
              '来源权限、口径和缺失处理',
            ],
          },
          {
            id: 'storage',
            search: '',
            cells: [
              '工作区存储',
              '本机服务 SQLite 与素材存储',
              '本机业务状态与素材保存',
              '生产部署与多人权限待接入',
            ],
          },
        ]}
        empty=""
      />
      <p className="op-help">
        页面不保存提供方密钥。接入实现完成后再开放配置操作；本地数据可在操作审计中导出，素材文件需单独保留。
      </p>
    </>
  );
}
