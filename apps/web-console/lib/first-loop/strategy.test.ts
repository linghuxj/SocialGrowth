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

void test('operations: chosen content and entry are respected; stale authorization cannot draft', () => {
  const { engine, context, project } = setup();
  const snapshot = engine.snapshot();
  const input = {
    projectId: project.id,
    outputMode: 'controlled' as const,
    rationale: 'explicit selection',
    assumptions: [],
    contentIdentityId: snapshot.contentIdentities[0]!.id,
    destinationEntryId: snapshot.destinationEntries[0]!.id,
  };
  assert.equal(
    engine.generateStrategyDraft(
      { ...input, contentIdentityId: 'missing' },
      context,
    ).error?.code,
    'STRATEGY_ELIGIBLE_CONTENT_MISSING',
  );
  assert.equal(
    engine.generateStrategyDraft(
      { ...input, destinationEntryId: 'missing' },
      context,
    ).error?.code,
    'STRATEGY_DESTINATION_MISSING',
  );
  assert.equal(
    engine.generateStrategyDraft(input, context).value?.contentIdentityId,
    input.contentIdentityId,
  );
  snapshot.accountServiceRelations[0]!.validUntil = '2026-09-18T00:00:00Z';
  engine.replaceState(snapshot);
  assert.equal(
    engine.generateStrategyDraft(input, context).error?.code,
    'STRATEGY_ELIGIBLE_CONTENT_MISSING',
  );
});

void test('operations: invalid observation windows and duplicate approvals/schedules are rejected; cancellation releases authority', () => {
  const { engine, context, project } = setup();
  const draft = engine.generateStrategyDraft(
    {
      projectId: project.id,
      outputMode: 'controlled',
      rationale: 'test',
      assumptions: [],
    },
    context,
  ).value!;
  const request = {
    strategyDraftId: draft.id,
    expectedStrategyVersion: draft.version,
    quantity: 1,
    validFrom: '2026-09-19T12:00:00Z',
    validUntil: '2026-09-21T12:00:00Z',
    stopConditions: ['stop'],
    observationConditions: ['observe'],
  };
  assert.equal(
    engine.approveStrategy(
      {
        ...request,
        observationPlan: {
          metricKey: 'views',
          source: 'manual',
          unit: 'count',
          scope: 'one',
          windowStart: '2026-09-22',
          windowEnd: '2026-09-21',
        },
      },
      context,
    ).ok,
    false,
  );
  const approval = engine.approveStrategy(request, context).value!;
  assert.equal(
    engine.approveStrategy(request, context).error?.code,
    'APPROVAL_ALREADY_ACTIVE',
  );
  const scheduleRequest = {
    approvalId: approval.id,
    businessTimezone: 'Asia/Shanghai',
    scheduledFor: '2026-09-20T01:00:00Z',
    expiresAt: '2026-09-20T02:00:00Z',
  };
  const schedule = engine.scheduleApproval(scheduleRequest, context).value!;
  assert.equal(
    engine.scheduleApproval(scheduleRequest, context).error?.code,
    'SCHEDULE_ALREADY_ACTIVE',
  );
  assert.equal(
    engine.releaseContent(
      draft.contentIdentityId,
      { approvalsInvalidated: true, schedulesInvalidated: true },
      context,
    ).error?.code,
    'CONTENT_OLD_AUTHORITY_ACTIVE',
  );
  assert.equal(
    engine.cancelSchedule(schedule.id, 'cancel before submission', context).ok,
    true,
  );
  assert.equal(engine.snapshot().executionApprovals[0]?.status, 'invalidated');
  assert.equal(
    engine.releaseContent(
      draft.contentIdentityId,
      { approvalsInvalidated: true, schedulesInvalidated: true },
      context,
    ).ok,
    true,
  );
});

void test('operations: asset fit downgrade invalidates authority and leaves an auditable reason', () => {
  const { engine, context, project } = setup();
  const draft = engine.generateStrategyDraft(
    {
      projectId: project.id,
      outputMode: 'controlled',
      rationale: 'test',
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
      stopConditions: ['stop'],
      observationConditions: ['observe'],
    },
    context,
  ).value!;
  engine.scheduleApproval(
    {
      approvalId: approval.id,
      businessTimezone: 'Asia/Shanghai',
      scheduledFor: '2026-09-20T01:00:00Z',
      expiresAt: '2026-09-20T02:00:00Z',
    },
    context,
  );
  const asset = engine.snapshot().sliceAssets[0]!;
  assert.equal(
    engine.reviewAssetFit(
      asset.id,
      'ineligible',
      'rights evidence needs review',
      context,
    ).ok,
    true,
  );
  const after = engine.snapshot();
  assert.equal(after.executionApprovals[0]?.status, 'invalidated');
  assert.equal(after.publicationSchedules[0]?.status, 'cancelled');
  assert.deepEqual(after.auditLogs.at(-1)?.evidenceRefs, [
    'rights evidence needs review',
  ]);
});

void test('operations: unscheduled approval can be withdrawn, unresolved execution cannot be cleared by withdrawal', () => {
  const { engine, context, project } = setup();
  const draft = engine.generateStrategyDraft(
    {
      projectId: project.id,
      outputMode: 'controlled',
      rationale: 'test',
      assumptions: [],
    },
    context,
  ).value!;
  const request = {
    strategyDraftId: draft.id,
    expectedStrategyVersion: draft.version,
    quantity: 1,
    validFrom: '2026-09-19T12:00:00Z',
    validUntil: '2026-09-21T12:00:00Z',
    stopConditions: ['stop'],
    observationConditions: ['observe'],
  };
  assert.equal(
    engine.approveStrategy({ ...request, quantity: 2 }, context).ok,
    false,
  );
  const approval = engine.approveStrategy(request, context).value!;
  assert.equal(
    engine.cancelApproval(approval.id, 'correct observation plan', context).ok,
    true,
  );
  const renewed = engine.approveStrategy(request, context).value!;
  const asset = engine.snapshot().sliceAssets[0]!;
  engine.recordExecutionReceipt(
    {
      attemptId: 'unknown-attempt',
      contentIdentityId: draft.contentIdentityId,
      sliceId: asset.id,
      accountId: draft.accountId,
      publishStatus: 'unknown',
      evidenceRefs: ['lost-connection'],
    },
    context,
  );
  assert.equal(
    engine.cancelApproval(renewed.id, 'try to clear', context).error?.code,
    'PUBLICATION_UNRESOLVED',
  );
  assert.equal(
    engine.snapshot().publicationAttempts[0]?.publishStatus,
    'unknown',
  );
});
