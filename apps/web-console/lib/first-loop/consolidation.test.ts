import test from 'node:test';
import assert from 'node:assert/strict';
import { FirstLoopEngine, createEmptyFirstLoopState } from './engine.ts';
import { projectView, readRoute, href } from '../operations.ts';
import { buildPublishTaskDirective } from './integration.ts';
const ctx = { actorId: 'operator', correlationId: 'consolidation' };
function setup() {
  const e = new FirstLoopEngine(createEmptyFirstLoopState(), {
    now: () => '2026-09-21T00:00:00.000Z',
  });
  const p = e.saveProjectDraft(
    {
      name: '自营项目',
      operatingMode: 'self',
      primaryGoal: 'views',
      audience: '测试',
      ownerId: 'operator',
      contentDefaults: {
        sourceRef: 'source',
        rightsRef: 'rights',
        language: 'en',
      },
    },
    ctx,
  ).value!;
  assert.equal(e.activateProject(p.id, ctx).ok, true);
  const account = e.registerAccount(
    {
      name: 'page',
      platform: 'facebook',
      owner: 'operator',
      positioning: '测试',
    },
    ctx,
  ).value!;
  e.grantAccountServiceRelation(
    {
      accountId: account.id,
      projectId: p.id,
      clientId: p.clientId!,
      ownerPartyId: 'operator',
      authorizerPartyId: 'operator',
      authorizationRef: 'self-confirmed',
      allowedActions: ['publish'],
      allowedData: [],
      validFrom: '2026-09-01T00:00:00Z',
    },
    ctx,
  );
  const content = e.admitContent(
    {
      title: '独立内容',
      sourceRef: 'source',
      storySummary: '单一剧情',
      asset: {
        fileRef: 'file',
        sha256: 'a'.repeat(64),
        language: 'en',
        variant: 'master',
        rightsRef: 'rights',
        destinationFit: 'eligible',
      },
    },
    ctx,
  ).value!;
  e.allocateContent(content.identity.id, account.id, 0, ctx);
  return { e, p, account, content };
}
void test('self-operated projects reuse a single party and retain content defaults', () => {
  const { e, p } = setup();
  const second = e.saveProjectDraft(
    { name: '第二项目', operatingMode: 'self' },
    ctx,
  ).value!;
  assert.equal(second.clientId, p.clientId);
  assert.equal(e.snapshot().clients.length, 1);
  assert.equal(e.snapshot().projects[0].contentDefaults?.language, 'en');
  assert.equal(projectView(e.snapshot(), p.id).projects.length, 1);
  assert.equal(readRoute(href('content', '', '', p.id)).project, p.id);
});
void test('independent rule identities coexist and revision supersedes only the selected rule', () => {
  const { e, p } = setup();
  const input = {
    projectId: p.id,
    category: 'internal_rule' as const,
    statement: '规则甲',
    sourceRef: 'evidence',
  };
  const a = e.addStrategyRule(input, ctx).value!;
  const b = e.addStrategyRule({ ...input, statement: '规则乙' }, ctx).value!;
  const revised = e.addStrategyRule(
    { ...input, ruleKey: a.ruleKey, statement: '规则甲修订' },
    ctx,
  ).value!;
  assert.equal(revised.version, 2);
  assert.equal(
    e.snapshot().strategyRules.find((r) => r.id === a.id)?.status,
    'superseded',
  );
  assert.equal(
    e.snapshot().strategyRules.find((r) => r.id === b.id)?.status,
    'active',
  );
  const builtin = e.addStrategyRule(
    { ...input, ruleKey: 'builtin:exclusive', statement: '试图取消排他锁' },
    ctx,
  ).value!;
  assert.ok(builtin.statement.includes('只选一个版本'));
});
void test('daily template works without a destination through approval and execution directive; traffic still requires one', () => {
  const { e, p, account } = setup();
  const input = {
    projectId: p.id,
    templateId: 'daily_clip' as const,
    rationale: '日常发布',
    outputMode: 'controlled' as const,
    assumptions: [],
  };
  const draft = e.generateStrategyDraft(input, ctx).value!;
  assert.equal(draft.destinationVersionId, undefined);
  assert.equal(draft.ruleIds.length, 4);
  assert.equal(
    e.generateStrategyDraft({ ...input, templateId: 'traffic' }, ctx).error
      ?.code,
    'STRATEGY_DESTINATION_MISSING',
  );
  const approval = e.approveStrategy(
    {
      strategyDraftId: draft.id,
      expectedStrategyVersion: draft.version,
      quantity: 1,
      validFrom: '2026-09-21T00:00:00Z',
      validUntil: '2026-09-22T00:00:00Z',
      stopConditions: ['异常停止'],
      observationConditions: ['记录结果'],
    },
    ctx,
  ).value!;
  assert.ok(approval);
  const schedule = e.scheduleApproval(
    {
      approvalId: approval.id,
      businessTimezone: 'Asia/Shanghai',
      scheduledFor: '2026-09-21T01:00:00Z',
      expiresAt: '2026-09-21T02:00:00Z',
    },
    ctx,
  ).value!;
  const directive = buildPublishTaskDirective(e.snapshot(), {
    approvalId: approval.id,
    scheduleId: schedule.id,
    taskId: 'task',
    attemptId: 'attempt',
    bindingId: 'binding',
    deviceId: 'device',
    platform: 'facebook',
    captionText: 'caption',
    mediaUrl: 'https://example.com/file.mp4',
    mediaExpiresAt: '2026-09-22T00:00:00Z',
    taskTimeoutMs: 300000,
  });
  assert.equal(directive.ok, true);
  assert.equal(directive.value?.accountId, account.id);
  assert.equal(directive.value?.shortLinkUrl, undefined);
});
void test('batch import is atomic, inherits defaults, stays pending, and rejects duplicate files', () => {
  const { e, p } = setup();
  const asset = {
    fileRef: 'file',
    sha256: 'b'.repeat(64),
    rightsRef: 'ignored',
    language: 'ignored',
    variant: 'master' as const,
    destinationFit: 'eligible' as const,
  };
  const input = {
    projectId: p.id,
    batchName: '剧集',
    distinctStoriesConfirmed: true,
    items: [{ title: '第1集', storySummary: '独立剧情', asset }],
  };
  const count = e.snapshot().contentIdentities.length;
  assert.equal(
    e.admitContentBatch(
      {
        ...input,
        items: [
          ...input.items,
          { ...input.items[0], asset: { ...asset, sha256: 'invalid' } },
        ],
      },
      ctx,
    ).ok,
    false,
  );
  assert.equal(e.snapshot().contentIdentities.length, count);
  assert.equal(e.admitContentBatch(input, ctx).value?.count, 1);
  const saved = e.snapshot().sliceAssets.at(-1)!;
  assert.equal(saved.language, 'en');
  assert.equal(saved.rightsRef, 'rights');
  assert.equal(saved.destinationFit, 'pending_review');
  assert.equal(
    e.admitContentBatch(input, ctx).error?.code,
    'CONTENT_BATCH_DUPLICATE',
  );
  assert.equal(e.snapshot().contentIdentities.at(-1)?.projectId, p.id);
});
