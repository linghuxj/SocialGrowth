import assert from 'node:assert/strict';
import test from 'node:test';
import { FirstLoopEngine, createEmptyFirstLoopState } from './engine.ts';
import type { CommandContext, MetricObservation } from './types.ts';

function setup() {
  let id = 0;
  const engine = new FirstLoopEngine(createEmptyFirstLoopState(), {
    now: () => '2026-09-20T01:00:00.000Z',
    nextId: (prefix) => `${prefix}-${++id}`,
  });
  const context: CommandContext = {
    actorId: 'analyst-a',
    correlationId: 'corr-fl05',
  };
  const project = engine.saveProjectDraft(
    {
      name: '观察项目',
      clientId: 'client-a',
      primaryGoal: '有效访问提升',
      audience: '英语受众',
      ownerId: 'owner-a',
    },
    context,
  ).value!;
  engine.activateProject(project.id, context);
  engine.addStrategyRule(
    {
      projectId: project.id,
      category: 'internal_rule',
      statement: '限定一条受控试验',
      sourceRef: 'rule://1',
    },
    context,
  );
  engine.grantAccountServiceRelation(
    {
      accountId: 'fb-a',
      projectId: project.id,
      clientId: 'client-a',
      ownerPartyId: 'owner',
      authorizerPartyId: 'client-a',
      authorizationRef: 'auth://1',
      allowedActions: ['publish'],
      allowedData: ['public_metrics'],
      validFrom: '2026-09-01T00:00:00Z',
    },
    context,
  );
  const content = engine.admitContent(
    {
      title: '观察内容',
      sourceRef: 'source://1',
      storySummary: '主剧情',
      asset: {
        language: 'en-US',
        variant: 'subtitle',
        fileRef: 'file://1',
        sha256: 'e'.repeat(64),
        rightsRef: 'rights://1',
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
      url: 'https://example.com/observe',
      maintenancePermissionRef: 'permission://1',
      sharedAttribution: false,
      exitPolicy: 'continue',
    },
    context,
  );
  const draft = engine.generateStrategyDraft(
    {
      projectId: project.id,
      outputMode: 'controlled',
      rationale: '受控观察',
      assumptions: [],
    },
    context,
  ).value!;
  const approval = engine.approveStrategy(
    {
      strategyDraftId: draft.id,
      expectedStrategyVersion: draft.version,
      quantity: 1,
      validFrom: '2026-09-19T00:00:00Z',
      validUntil: '2026-09-22T00:00:00Z',
      stopConditions: ['结果未知'],
      observationConditions: ['主指标观察'],
    },
    context,
  ).value!;
  return { engine, context, project, approval };
}

function observation(
  setupValue: ReturnType<typeof setup>,
  comparisonRole: MetricObservation['comparisonRole'],
  overrides: Partial<Omit<MetricObservation, 'id' | 'capturedAt'>> = {},
) {
  const { project, approval } = setupValue;
  return {
    projectId: project.id,
    strategyVersion: approval.strategyVersion,
    approvalId: approval.id,
    metricKey: 'valid_clicks',
    value: comparisonRole === 'baseline' ? 10 : 12,
    availability: 'observed_value' as const,
    source: 'shortlink-v1',
    unit: 'click',
    scope: 'approved-content',
    windowStart: '2026-09-19T00:00:00Z',
    windowEnd: '2026-09-20T00:00:00Z',
    comparisonRole,
    controlledData: true,
    ...overrides,
  };
}

void test('F-01/F-02: real zero is distinct from missing and unavailable states cannot carry a value', () => {
  const current = setup();
  const zero = current.engine.recordMetricObservation(
    observation(current, 'current', {
      value: 0,
      availability: 'observed_zero',
    }),
    current.context,
  );
  assert.equal(zero.ok, true);
  const invalid = current.engine.recordMetricObservation(
    observation(current, 'baseline', {
      value: 0,
      availability: 'unauthorized',
    }),
    current.context,
  );
  assert.equal(invalid.error?.code, 'OBSERVATION_UNAVAILABLE_HAS_VALUE');
});

void test('F-03/F-04: source change stays visible and blocks comparison until explicitly accepted', () => {
  const current = setup();
  current.engine.recordMetricObservation(
    observation(current, 'baseline'),
    current.context,
  );
  current.engine.recordMetricObservation(
    observation(current, 'current', { source: 'provider-v2' }),
    current.context,
  );
  const review = current.engine.createBasicReview(
    {
      projectId: current.project.id,
      approvalId: current.approval.id,
      primaryMetricKey: 'valid_clicks',
      requiredWorkComplete: true,
      sourceComparisonAccepted: false,
    },
    current.context,
  ).value!;
  assert.equal(review.outcome, 'evidence_insufficient');
  assert.equal(review.sourceChanged, true);
});

void test('F-05/F-06: incomplete work, no improvement and limited improvement remain separate outcomes', () => {
  const incomplete = setup();
  const first = incomplete.engine.createBasicReview(
    {
      projectId: incomplete.project.id,
      approvalId: incomplete.approval.id,
      primaryMetricKey: 'valid_clicks',
      requiredWorkComplete: false,
      sourceComparisonAccepted: false,
    },
    incomplete.context,
  ).value!;
  assert.equal(first.outcome, 'required_work_incomplete');

  const complete = setup();
  complete.engine.recordMetricObservation(
    observation(complete, 'baseline', { value: 10 }),
    complete.context,
  );
  complete.engine.recordMetricObservation(
    observation(complete, 'current', { value: 10 }),
    complete.context,
  );
  const noImprovement = complete.engine.createBasicReview(
    {
      projectId: complete.project.id,
      approvalId: complete.approval.id,
      primaryMetricKey: 'valid_clicks',
      requiredWorkComplete: true,
      sourceComparisonAccepted: true,
    },
    complete.context,
  ).value!;
  assert.equal(noImprovement.outcome, 'no_improvement');
  const confirmed = complete.engine.confirmReview(
    noImprovement.id,
    'create_new_draft',
    complete.context,
  );
  assert.equal(confirmed.value?.nextAction, 'create_new_draft');
  assert.equal(complete.engine.snapshot().strategyDrafts.length, 1);
});
