import type {
  AccountServiceRelation,
  FirstLoopState,
} from './first-loop/types.ts';

export const pages = [
  { id: 'home', name: '工作台', group: 'home' },
  { id: 'device-farm', name: '真机监控大屏', group: 'execution' },
  { id: 'accounts', name: '账号管理', group: 'accounts' },
  { id: 'content', name: '内容资产', group: 'content' },
  { id: 'strategies', name: '策略草案', group: 'strategy' },
  { id: 'rules', name: '规则库', group: 'strategy' },
  { id: 'plans', name: '发布计划', group: 'execution' },
  { id: 'receipts', name: '任务中心', group: 'execution' },
  { id: 'exceptions', name: '异常处理', group: 'execution' },
  { id: 'destinations', name: '导流管理', group: 'destinations' },
  { id: 'metrics', name: '数据表现', group: 'data' },
  { id: 'reviews', name: '复盘记录', group: 'data' },
  { id: 'clients', name: '运营项目', group: 'clients' },
  { id: 'connections', name: '接入状态', group: 'system' },
  { id: 'audit', name: '操作审计', group: 'system' },
] as const;
export type PageId = (typeof pages)[number]['id'];
export function readRoute(hash: string): {
  page: PageId;
  object: string;
  query: string;
  project: string;
} {
  const [path, search = ''] = hash.replace(/^#\/?/, '').split('?');
  const params = new URLSearchParams(search);
  return {
    page: pages.find((p) => p.id === path)?.id ?? 'home',
    object: params.get('object') ?? '',
    query: params.get('q') ?? '',
    project: params.get('project') ?? '',
  };
}
export function href(page: PageId, object = '', query = '', project = '') {
  const params = new URLSearchParams();
  if (object) params.set('object', object);
  if (query) params.set('q', query);
  if (project) params.set('project', project);
  return `#/${page}${params.size ? `?${params}` : ''}`;
}
export const names: Record<string, string> = {
  draft: '草稿',
  active: '有效',
  exited: '已退出',
  unallocated: '未分配',
  reserved: '预占中',
  assigned_locked: '独占分配',
  not_submitted: '尚未提交',
  in_progress: '处理中',
  unknown: '结果待核对',
  confirmed_not_published: '确认未发布',
  published: '已公开',
  available: '本地准入有效',
  service_failure: '服务故障',
  destination_invalid: '目的地失效',
  platform_restricted: '平台限制',
  invalidated: '已失效',
  expired: '已过期',
  scheduled: '待执行',
  cancelled: '已取消',
  started: '已开始',
  observed_value: '已观察数值',
  observed_zero: '明确零值',
  missing: '数据缺失',
  delayed: '来源延迟',
  unauthorized: '无权限',
  required_work_incomplete: '必需工作未完成',
  evidence_insufficient: '证据不足',
  no_improvement: '未观察到改善',
  limited_improvement: '范围内改善',
  accepted: '已记录',
  rejected: '已拒绝',
  baseline: '基线',
  current: '当前',
  continue_observation: '继续观察',
  create_new_draft: '制定新草案',
  stop: '停止',
  facebook: 'Facebook',
  youtube: 'YouTube',
  external_constraint: '外部约束',
  internal_rule: '内部规则',
  unverified_hypothesis: '待验证假设',
  eligible: '已核对可用',
  pending_review: '待核对',
  ineligible: '不可用',
  channel: '频道入口',
  content: '内容入口',
  continue: '按约定继续维护',
  disable: '退出时停用',
};
export const label = (value: string) => names[value] ?? value;
export function validRelation(r: AccountServiceRelation, now = Date.now()) {
  return (
    !r.revokedAt &&
    Date.parse(r.validFrom) <= now &&
    (!r.validUntil || Date.parse(r.validUntil) > now) &&
    r.allowedActions.includes('publish')
  );
}
export function lookup(state: FirstLoopState, id?: string): string {
  if (!id) return '未填写';
  if (id === 'new') return '新建对象';
  const related =
    state.accountServiceRelations.find((x) => x.id === id)?.accountId ??
    state.sliceAssets.find((x) => x.id === id)?.contentIdentityId ??
    state.publicationAttempts.find((x) => x.id === id)?.contentIdentityId ??
    state.strategyDrafts.find((x) => x.id === id)?.contentIdentityId ??
    state.executionApprovals.find((x) => x.id === id)?.contentIdentityId ??
    state.publicationSchedules.find((x) => x.id === id)?.approvalId ??
    state.metricObservations.find((x) => x.id === id)?.approvalId ??
    state.basicReviews.find((x) => x.id === id)?.projectId;
  if (related && related !== id) return lookup(state, related);
  return (
    state.accounts.find((x) => x.id === id)?.name ??
    state.clients.find((x) => x.id === id)?.name ??
    state.projects.find((x) => x.id === id)?.name ??
    state.contentIdentities.find((x) => x.id === id)?.title ??
    state.strategyRules.find((x) => x.id === id)?.statement ??
    state.destinationVersions.find((x) => x.id === id)?.url ??
    state.destinationVersions.find(
      (x) =>
        x.id ===
        state.destinationEntries.find((e) => e.id === id)?.activeVersionId,
    )?.url ??
    id
  );
}
/** A read model only. Commands always run against the full server-owned state. */
export function projectView(
  state: FirstLoopState,
  projectId: string,
): FirstLoopState {
  if (!projectId) return state;
  const relations = state.accountServiceRelations.filter(
    (r) => r.projectId === projectId,
  );
  const accounts = state.accounts.filter((a) =>
    relations.some((r) => r.accountId === a.id),
  );
  const contents = state.contentIdentities.filter(
    (i) =>
      i.projectId === projectId ||
      relations.some((r) => r.accountId === i.assignedAccountId),
  );
  const approvals = state.executionApprovals.filter(
    (a) => a.projectId === projectId,
  );
  return {
    ...state,
    projects: state.projects.filter((p) => p.id === projectId),
    accountServiceRelations: relations,
    accounts,
    contentIdentities: contents,
    sliceAssets: state.sliceAssets.filter((s) =>
      contents.some((i) => i.id === s.contentIdentityId),
    ),
    strategyRules: state.strategyRules.filter((r) => r.projectId === projectId),
    strategyDrafts: state.strategyDrafts.filter(
      (d) => d.projectId === projectId,
    ),
    executionApprovals: approvals,
    publicationSchedules: state.publicationSchedules.filter((s) =>
      approvals.some((a) => a.id === s.approvalId),
    ),
    publicationAttempts: state.publicationAttempts.filter((a) =>
      contents.some((i) => i.id === a.contentIdentityId),
    ),
    destinationEntries: state.destinationEntries.filter(
      (d) => d.projectId === projectId,
    ),
    metricObservations: state.metricObservations.filter(
      (o) => o.projectId === projectId,
    ),
    basicReviews: state.basicReviews.filter((r) => r.projectId === projectId),
  };
}
export function taskList(state: FirstLoopState, now = Date.now()) {
  const tasks: {
    id: string;
    title: string;
    reason: string;
    page: PageId;
    object: string;
    urgent: boolean;
  }[] = [];
  state.projects
    .filter((p) => p.status === 'active')
    .forEach((p) => {
      const relations = state.accountServiceRelations.filter(
        (r) => r.projectId === p.id && validRelation(r, now),
      );
      if (!relations.length)
        tasks.push({
          id: `auth-${p.id}`,
          title: `准备账号授权：${p.name}`,
          reason: '暂无有效发布授权',
          page: 'accounts',
          object: '',
          urgent: false,
        });
      if (
        !state.strategyRules.some(
          (r) => r.projectId === p.id && r.status === 'active',
        )
      )
        tasks.push({
          id: `rule-${p.id}`,
          title: `完善规则：${p.name}`,
          reason: '策略缺少有来源的依据',
          page: 'rules',
          object: '',
          urgent: false,
        });
      if (
        p.primaryGoal === 'traffic' &&
        !state.destinationEntries.some((d) => d.projectId === p.id)
      )
        tasks.push({
          id: `entry-${p.id}`,
          title: `登记入口：${p.name}`,
          reason: '尚无导流目的地',
          page: 'destinations',
          object: '',
          urgent: false,
        });
      if (
        !state.contentIdentities.some(
          (i) =>
            !i.firstPublishedAt &&
            relations.some((r) => r.accountId === i.assignedAccountId),
        )
      )
        tasks.push({
          id: `content-${p.id}`,
          title: `准备内容：${p.name}`,
          reason: '暂无分配到授权账号的未发布内容',
          page: 'content',
          object: '',
          urgent: false,
        });
    });
  state.executionApprovals
    .filter((a) => a.status === 'active' && Date.parse(a.validUntil) > now)
    .forEach((a) => {
      if (
        !state.publicationSchedules.some(
          (s) =>
            s.approvalId === a.id &&
            ['scheduled', 'started'].includes(s.status) &&
            Date.parse(s.expiresAt) > now,
        )
      )
        tasks.push({
          id: `plan-${a.id}`,
          title: `安排发布：${lookup(state, a.contentIdentityId)}`,
          reason: '批准范围内暂无有效排期',
          page: 'plans',
          object: a.id,
          urgent: false,
        });
      if (
        a.observationPlan &&
        !state.metricObservations.some((o) => o.approvalId === a.id)
      )
        tasks.push({
          id: `observe-${a.id}`,
          title: `记录观察：${lookup(state, a.contentIdentityId)}`,
          reason: '基线与当前观察尚未记录',
          page: 'metrics',
          object: a.id,
          urgent: false,
        });
    });
  state.sliceAssets
    .filter((a) => a.destinationFit === 'pending_review')
    .forEach((a) =>
      tasks.push({
        id: `fit-${a.id}`,
        title: `核对素材：${lookup(state, a.contentIdentityId)}`,
        reason: '适配结论待核对',
        page: 'content',
        object: a.contentIdentityId,
        urgent: false,
      }),
    );
  state.projects
    .filter((p) => p.status === 'draft')
    .forEach((p) =>
      tasks.push({
        id: p.id,
        title: `完善 ${p.name}`,
        reason: '补齐资料并激活后才能生成策略',
        page: 'clients',
        object: p.id,
        urgent: false,
      }),
    );
  state.strategyDrafts
    .filter(
      (d) =>
        !state.executionApprovals.some(
          (a) =>
            a.strategyDraftId === d.id &&
            a.status === 'active' &&
            Date.parse(a.validUntil) > now,
        ),
    )
    .forEach((d) =>
      tasks.push({
        id: d.id,
        title: `审阅 ${lookup(state, d.contentIdentityId)}`,
        reason: `${lookup(state, d.projectId)} · 策略 v${d.version}`,
        page: 'strategies',
        object: d.id,
        urgent: false,
      }),
    );
  state.publicationAttempts
    .filter((a) => ['unknown', 'in_progress'].includes(a.publishStatus))
    .forEach((a) =>
      tasks.push({
        id: a.id,
        title: `核对 ${lookup(state, a.contentIdentityId)}`,
        reason: label(a.publishStatus),
        page: 'exceptions',
        object: a.id,
        urgent: true,
      }),
    );
  state.accountServiceRelations
    .filter(
      (r) => !r.revokedAt && r.validUntil && Date.parse(r.validUntil) <= now,
    )
    .forEach((r) =>
      tasks.push({
        id: r.id,
        title: `授权已到期：${lookup(state, r.accountId)}`,
        reason: lookup(state, r.projectId),
        page: 'accounts',
        object: r.accountId,
        urgent: true,
      }),
    );
  state.basicReviews
    .filter((r) => !r.confirmedAt)
    .forEach((r) =>
      tasks.push({
        id: r.id,
        title: `确认复盘：${lookup(state, r.projectId)}`,
        reason: label(r.outcome),
        page: 'reviews',
        object: r.id,
        urgent: false,
      }),
    );
  return tasks.sort((a, b) => Number(b.urgent) - Number(a.urgent));
}
export function reviewedCompletion(state: FirstLoopState, approvalId: string) {
  const a = state.executionApprovals.find((item) => item.id === approvalId);
  if (!a) return false;
  return (
    state.publicationAttempts.filter(
      (item) =>
        item.contentIdentityId === a.contentIdentityId &&
        item.accountId === a.accountId &&
        item.publishStatus === 'published' &&
        item.evidenceRefs.length > 0 &&
        Date.parse(item.createdAt) >= Date.parse(a.createdAt),
    ).length >= a.quantity
  );
}
