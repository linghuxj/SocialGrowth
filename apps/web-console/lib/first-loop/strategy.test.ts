import assert from 'node:assert/strict';
import test from 'node:test';
import { FirstLoopEngine, createEmptyFirstLoopState } from './engine.ts';
import type { CommandContext } from './types.ts';

function setup(complete = true) {
  let id = 0;
  const engine = new FirstLoopEngine(createEmptyFirstLoopState(), {
    now: () => '2026-09-19T12:00:00.000Z',
    nextId: (prefix) => `${prefix}-${++id}`,
  });
  const context: CommandContext = {
    actorId: 'reviewer-a',
    correlationId: 'corr-fl03',
  };
  const project = engine.saveProjectDraft(
    {
      name: '策略项目',
      clientId: 'client-a',
      primaryGoal: '有效访问',
      audience: '英语受众',
      ownerId: 'owner-a',
    },
    context,
  ).value!;
  engine.activateProject(project.id, context);
  engine.addStrategyRule(
    {
      projectId: project.id,
      category: 'external_constraint',
      statement: '仅使用客户批准入口',
      sourceRef: 'policy://client-a/v1',
    },
    context,
  );
  if (!complete) return { engine, context, project };
  engine.grantAccountServiceRelation(
    {
      accountId: 'fb-a',
      projectId: project.id,
      clientId: 'client-a',
      ownerPartyId: 'owner-party',
      authorizerPartyId: 'client-a',
      authorizationRef: 'auth://a',
      allowedActions: ['publish'],
      allowedData: ['public_metrics'],
      validFrom: '2026-09-01T00:00:00Z',
    },
    context,
  );
  const content = engine.admitContent(
    {
      title: '策略内容',
      sourceRef: 'source://strategy',
      storySummary: '主剧情',
      asset: {
        language: 'en-US',
        variant: 'subtitle',
        fileRef: 'file://strategy',
        sha256: 'd'.repeat(64),
        rightsRef: 'rights://strategy',
        destinationFit: 'eligible',
      },
    },
    context,
  ).value!;
  engine.allocateContent(content.identity.id, 'fb-a', 0, context);
  engine.createDestination(
    {
      projectId: project.id,
      accountId: 'fb-a',
      scope: 'content',
      scopeId: content.identity.id,
      url: 'https://example.com/strategy',
      maintenancePermissionRef: 'permission://strategy',
      sharedAttribution: false,
      exitPolicy: 'continue',
    },
    context,
  );
  return { engine, context, project };
}

void test('C-02: a draft explains why no eligible candidate exists instead of inventing performance', () => {
  const { engine, context, project } = setup(false);
  const result = engine.generateStrategyDraft(
    {
      projectId: project.id,
      outputMode: 'controlled',
      rationale: '根据当前规则选择',
      assumptions: ['尚无历史效果'],
    },
    context,
  );
  assert.equal(result.error?.code, 'STRATEGY_ELIGIBLE_CONTENT_MISSING');
  assert.equal(engine.snapshot().strategyDrafts.length, 0);
});

void test('C-03/C-04: approval pins explicit scope and batch returns each real result', () => {
  const { engine, context, project } = setup();
  const draft = engine.generateStrategyDraft(
    {
      projectId: project.id,
      outputMode: 'controlled',
      rationale: '有来源规则加合格候选',
      assumptions: ['受控输出，未调用真实模型'],
    },
    context,
  ).value!;
  assert.equal(draft.outputMode, 'controlled');
  assert.deepEqual(draft.evidenceRefs, ['policy://client-a/v1']);
  const base = {
    strategyDraftId: draft.id,
    expectedStrategyVersion: draft.version,
    quantity: 1,
    validFrom: '2026-09-19T12:00:00Z',
    validUntil: '2026-09-20T12:00:00Z',
    stopConditions: ['发现身份冲突'],
    observationConditions: ['记录公开证据'],
  };
  const results = engine.approveStrategyBatch(
    [base, { ...base, expectedStrategyVersion: 99 }],
    context,
  );
  assert.equal(results[0]?.ok, true);
  assert.equal(results[1]?.error?.code, 'STRATEGY_VERSION_CONFLICT');
  assert.equal(engine.snapshot().executionApprovals.length, 1);
});

void test('C-10/T-10: schedule keeps timezone, expires without backfill, and goal change invalidates authority', () => {
  const { engine, context, project } = setup();
  const draft = engine.generateStrategyDraft(
    {
      projectId: project.id,
      outputMode: 'controlled',
      rationale: '批准前受控草案',
      assumptions: [],
    },
    context,
  ).value!;
  const approval = engine.approveStrategy(
    {
      strategyDraftId: draft.id,
      expectedStrategyVersion: draft.version,
      quantity: 1,
      validFrom: '2026-09-19T12:00:00Z',
      validUntil: '2026-09-21T12:00:00Z',
      stopConditions: ['结果未知'],
      observationConditions: ['24小时观察窗'],
    },
    context,
  ).value!;
  const schedule = engine.scheduleApproval(
    {
      approvalId: approval.id,
      businessTimezone: 'Asia/Shanghai',
      scheduledFor: '2026-09-20T01:00:00Z',
      expiresAt: '2026-09-20T02:00:00Z',
    },
    context,
  ).value!;
  assert.equal(schedule.businessTimezone, 'Asia/Shanghai');
  assert.equal(
    engine.expireSchedules('2026-09-20T03:00:00Z', context)[0]?.status,
    'expired',
  );

  const secondSchedule = engine.scheduleApproval(
    {
      approvalId: approval.id,
      businessTimezone: 'Asia/Shanghai',
      scheduledFor: '2026-09-20T04:00:00Z',
      expiresAt: '2026-09-20T05:00:00Z',
    },
    context,
  ).value!;
  engine.saveProjectDraft({ ...project, primaryGoal: '新的主指标' }, context);
  const snapshot = engine.snapshot();
  assert.equal(snapshot.executionApprovals[0]?.status, 'invalidated');
  assert.equal(
    snapshot.publicationSchedules.find((item) => item.id === secondSchedule.id)
      ?.status,
    'cancelled',
  );
});
