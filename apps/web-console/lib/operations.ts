import type { AccountServiceRelation, FirstLoopState } from './first-loop/types.ts';

export const pages = [
  { id: 'home', name: '工作台', group: 'home' },
  { id: 'accounts', name: '账号管理', group: 'accounts' },
  { id: 'content', name: '内容资产', group: 'content' },
  { id: 'strategies', name: '策略草案', group: 'strategy' },
  { id: 'rules', name: '规则库', group: 'strategy' },
  { id: 'plans', name: '发布计划', group: 'execution' },
  { id: 'receipts', name: '执行记录', group: 'execution' },
  { id: 'exceptions', name: '异常处理', group: 'execution' },
  { id: 'destinations', name: '导流管理', group: 'destinations' },
  { id: 'metrics', name: '数据表现', group: 'data' },
  { id: 'reviews', name: '复盘记录', group: 'data' },
  { id: 'clients', name: '客户服务', group: 'clients' },
  { id: 'connections', name: '接入状态', group: 'system' },
  { id: 'audit', name: '操作审计', group: 'system' },
] as const;
export type PageId = typeof pages[number]['id'];
export function readRoute(hash: string): { page: PageId; object: string; query: string } {
  const [path, search = ''] = hash.replace(/^#\/?/, '').split('?');
  const params = new URLSearchParams(search);
  return { page: pages.find((p) => p.id === path)?.id ?? 'home', object: params.get('object') ?? '', query: params.get('q') ?? '' };
}
export function href(page: PageId, object = '', query = '') {
  const params = new URLSearchParams();
  if (object) params.set('object', object);
  if (query) params.set('q', query);
  return `#/${page}${params.size ? `?${params}` : ''}`;
}
export const names: Record<string, string> = {
  draft:'草稿', active:'有效', exited:'已退出', unallocated:'未分配', reserved:'预占中', assigned_locked:'独占分配',
  not_submitted:'尚未提交', in_progress:'处理中', unknown:'结果待核对', confirmed_not_published:'确认未发布', published:'已公开',
  available:'本地准入有效', service_failure:'服务故障', destination_invalid:'目的地失效', platform_restricted:'平台限制',
  invalidated:'已失效', expired:'已过期', scheduled:'待执行', cancelled:'已取消', started:'已开始',
  observed_value:'已观察数值', observed_zero:'明确零值', missing:'数据缺失', delayed:'来源延迟', unauthorized:'无权限',
  required_work_incomplete:'必需工作未完成', evidence_insufficient:'证据不足', no_improvement:'未观察到改善', limited_improvement:'范围内改善',
  accepted:'已记录', rejected:'已拒绝', baseline:'基线', current:'当前', continue_observation:'继续观察', create_new_draft:'制定新草案', stop:'停止',
  facebook:'Facebook', youtube:'YouTube', external_constraint:'外部约束', internal_rule:'内部规则', unverified_hypothesis:'待验证假设',
  eligible:'已核对可用', pending_review:'待核对', ineligible:'不可用', channel:'频道入口', content:'内容入口', continue:'按约定继续维护', disable:'退出时停用',
};
export const label = (value: string) => names[value] ?? value;
export function validRelation(r: AccountServiceRelation, now = Date.now()) {
  return !r.revokedAt && Date.parse(r.validFrom) <= now && (!r.validUntil || Date.parse(r.validUntil) > now) && r.allowedActions.includes('publish');
}
export function lookup(state: FirstLoopState, id?: string): string {
  if (!id) return '未填写';
  return state.accounts.find((x) => x.id === id)?.name ?? state.clients.find((x) => x.id === id)?.name ??
    state.projects.find((x) => x.id === id)?.name ?? state.contentIdentities.find((x) => x.id === id)?.title ?? id;
}
export function taskList(state: FirstLoopState, now = Date.now()) {
  const tasks: { id: string; title: string; reason: string; page: PageId; object: string; urgent: boolean }[] = [];
  state.projects.filter((p) => p.status === 'draft').forEach((p) => tasks.push({ id:p.id, title:`完善 ${p.name}`, reason:'补齐资料并激活后才能生成策略', page:'clients', object:p.id, urgent:false }));
  state.strategyDrafts.filter((d) => !state.executionApprovals.some((a) => a.strategyDraftId === d.id && a.status === 'active' && Date.parse(a.validUntil) > now)).forEach((d) => tasks.push({ id:d.id, title:`审阅 ${lookup(state,d.contentIdentityId)}`, reason:`${lookup(state,d.projectId)} · 策略 v${d.version}`, page:'strategies',object:d.id,urgent:false }));
  state.publicationAttempts.filter((a) => ['unknown','in_progress'].includes(a.publishStatus)).forEach((a) => tasks.push({id:a.id,title:`核对 ${lookup(state,a.contentIdentityId)}`,reason:label(a.publishStatus),page:'exceptions',object:a.id,urgent:true}));
  state.accountServiceRelations.filter((r) => !r.revokedAt && r.validUntil && Date.parse(r.validUntil) <= now).forEach((r) => tasks.push({id:r.id,title:`授权已到期：${lookup(state,r.accountId)}`,reason:lookup(state,r.projectId),page:'accounts',object:r.accountId,urgent:true}));
  state.basicReviews.filter((r) => !r.confirmedAt).forEach((r) => tasks.push({id:r.id,title:`确认复盘：${lookup(state,r.projectId)}`,reason:label(r.outcome),page:'reviews',object:r.id,urgent:false}));
  return tasks.sort((a,b) => Number(b.urgent)-Number(a.urgent));
}
export function reviewedCompletion(state: FirstLoopState, approvalId: string) {
  const a = state.executionApprovals.find((item) => item.id === approvalId);
  if (!a) return false;
  return state.publicationAttempts.filter((item) => item.contentIdentityId === a.contentIdentityId && item.accountId === a.accountId && item.publishStatus === 'published' && item.evidenceRefs.length > 0 && Date.parse(item.createdAt) >= Date.parse(a.createdAt)).length >= a.quantity;
}
