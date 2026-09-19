import assert from 'node:assert/strict';
import test from 'node:test';
import { FirstLoopEngine, createEmptyFirstLoopState } from './engine.ts';
import type { AuditLogEntry, CommandContext, SliceAsset } from './types.ts';

function harness() {
  let id = 0;
  const logs: AuditLogEntry[] = [];
  const engine = new FirstLoopEngine(createEmptyFirstLoopState(), {
    now: () => '2026-09-19T10:00:00.000Z',
    nextId: (prefix) => `${prefix}-${++id}`,
    logSink: (entry) => logs.push(entry),
  });
  const context: CommandContext = {
    actorId: 'tester',
    correlationId: 'corr-fl01',
  };
  return { engine, context, logs };
}

function completeProject(engine: FirstLoopEngine, context: CommandContext) {
  const result = engine.saveProjectDraft(
    {
      name: '甲方短剧首发',
      clientId: 'client-a',
      primaryGoal: '验证受众入口',
      audience: '英语地区短剧用户',
      ownerId: 'operator-a',
    },
    context,
  );
  assert.equal(result.ok, true);
  return result.value!;
}

function authorizeAccounts(
  engine: FirstLoopEngine,
  context: CommandContext,
  ...accountIds: string[]
) {
  const project = completeProject(engine, context);
  for (const accountId of accountIds) {
    const result = engine.grantAccountServiceRelation(
      {
        accountId,
        projectId: project.id,
        clientId: project.clientId!,
        ownerPartyId: 'company-owner',
        authorizerPartyId: project.clientId!,
        authorizationRef: `auth://${accountId}`,
        allowedActions: ['publish'],
        allowedData: ['public_metrics'],
        validFrom: '2026-09-01T00:00:00Z',
      },
      context,
    );
    assert.equal(result.ok, true);
  }
}

function asset(
  overrides: Partial<
    Omit<SliceAsset, 'id' | 'contentIdentityId' | 'createdAt'>
  > = {},
) {
  return {
    language: 'en-US',
    variant: 'subtitle' as const,
    fileRef: 's3://controlled/sample-en.mp4',
    sha256: 'a'.repeat(64),
    rightsRef: 'rights://client-a/sample-1',
    destinationFit: 'eligible' as const,
    ...overrides,
  };
}

void test('C-01/C-12: incomplete project remains a draft with actionable gaps and audit log', () => {
  const { engine, context, logs } = harness();
  const saved = engine.saveProjectDraft({ name: '待补项目' }, context);
  assert.equal(saved.ok, true);
  assert.equal(saved.value?.status, 'draft');
  assert.deepEqual(
    engine.listProjectGaps(saved.value!.id).map((gap) => gap.field),
    ['clientId', 'primaryGoal', 'audience', 'ownerId'],
  );
  const activated = engine.activateProject(saved.value!.id, context);
  assert.equal(activated.ok, false);
  assert.equal(activated.error?.code, 'PROJECT_INCOMPLETE');
  assert.equal(logs.length, 2);
  assert.equal(engine.snapshot().auditLogs[1]?.result, 'rejected');
});

void test('C-08: account ownership, client service and shared approval are separate', () => {
  const { engine, context } = harness();
  const projectA = completeProject(engine, context);
  const projectB = engine.saveProjectDraft(
    {
      name: '乙方项目',
      clientId: 'client-b',
      primaryGoal: '验证内容适配',
      audience: '西语用户',
      ownerId: 'operator-b',
    },
    context,
  ).value!;
  const base = {
    accountId: 'fb-account-1',
    ownerPartyId: 'company-owner',
    authorizerPartyId: 'company-owner',
    authorizationRef: 'auth://a',
    allowedActions: ['publish'],
    allowedData: ['public_metrics'],
    validFrom: '2026-09-01T00:00:00Z',
  };
  assert.equal(
    engine.grantAccountServiceRelation(
      { ...base, projectId: projectA.id, clientId: 'client-a' },
      context,
    ).ok,
    true,
  );
  const withoutApproval = engine.grantAccountServiceRelation(
    {
      ...base,
      projectId: projectB.id,
      clientId: 'client-b',
      authorizationRef: 'auth://b',
    },
    context,
  );
  assert.equal(withoutApproval.error?.code, 'SHARED_APPROVAL_REQUIRED');
  const shared = engine.grantAccountServiceRelation(
    {
      ...base,
      projectId: projectB.id,
      clientId: 'client-b',
      authorizationRef: 'auth://b',
      sharedApprovalRef: 'approval://shared-1',
    },
    context,
  );
  assert.equal(shared.ok, true);
  assert.equal(shared.value?.ownerPartyId, 'company-owner');
  assert.equal(shared.value?.clientId, 'client-b');
  const revoked = engine.revokeAccountServiceRelation(
    shared.value!.id,
    context,
  );
  assert.equal(revoked.ok, true);
  assert.equal(revoked.value?.revokedAt, '2026-09-19T10:00:00.000Z');
  assert.equal(engine.snapshot().accountServiceRelations.length, 2);
});

void test('C-11/T-02: language variants share one identity and optimistic allocation blocks a competitor', () => {
  const { engine, context } = harness();
  authorizeAccounts(engine, context, 'fb-account-1', 'yt-account-2');
  const first = engine.admitContent(
    {
      title: '第1集冲突',
      sourceRef: 'source://series/episode-1',
      storySummary: '共同主剧情',
      asset: asset(),
    },
    context,
  );
  assert.equal(first.ok, true);
  const second = engine.admitContent(
    {
      identity: { id: first.value!.identity.id },
      title: '第1集冲突',
      sourceRef: 'source://series/episode-1',
      storySummary: '共同主剧情',
      asset: asset({
        language: 'es-ES',
        variant: 'voiceover',
        fileRef: 's3://controlled/sample-es.mp4',
        sha256: 'b'.repeat(64),
      }),
    },
    context,
  );
  assert.equal(second.ok, true);
  assert.equal(engine.snapshot().sliceAssets.length, 2);
  const allocated = engine.allocateContent(
    first.value!.identity.id,
    'fb-account-1',
    0,
    context,
  );
  assert.equal(allocated.ok, true);
  const staleCompetitor = engine.allocateContent(
    first.value!.identity.id,
    'yt-account-2',
    0,
    context,
  );
  assert.equal(staleCompetitor.error?.code, 'CONTENT_VERSION_CONFLICT');
  const currentCompetitor = engine.allocateContent(
    first.value!.identity.id,
    'yt-account-2',
    1,
    context,
  );
  assert.equal(currentCompetitor.error?.code, 'CONTENT_ACCOUNT_CONFLICT');
});

void test('T-03: published history blocks the original account and every other account', () => {
  const { engine, context } = harness();
  authorizeAccounts(engine, context, 'fb-account-1');
  const admitted = engine.admitContent(
    {
      title: '已发内容',
      sourceRef: 'source://published',
      storySummary: '已公开',
      asset: asset(),
    },
    context,
  ).value!;
  engine.allocateContent(admitted.identity.id, 'fb-account-1', 0, context);
  const published = engine.recordPublicationAttempt(
    {
      contentIdentityId: admitted.identity.id,
      sliceId: admitted.asset.id,
      accountId: 'fb-account-1',
      publishStatus: 'published',
      evidenceRefs: ['evidence://post/123'],
    },
    context,
  );
  assert.equal(published.ok, true);
  assert.equal(
    engine.releaseContent(
      admitted.identity.id,
      { approvalsInvalidated: true, schedulesInvalidated: true },
      context,
    ).error?.code,
    'CONTENT_ALREADY_PUBLISHED',
  );
  assert.equal(
    engine.allocateContent(admitted.identity.id, 'fb-account-1', 1, context)
      .error?.code,
    'CONTENT_ALREADY_PUBLISHED',
  );
});

void test('T-04/T-05/T-07: release only succeeds for resolved non-submission with old authority invalidated', () => {
  const { engine, context } = harness();
  authorizeAccounts(engine, context, 'fb-account-1', 'fb-account-2');
  const unknown = engine.admitContent(
    {
      title: '未知结果',
      sourceRef: 'source://unknown',
      storySummary: '回执丢失',
      asset: asset(),
    },
    context,
  ).value!;
  engine.allocateContent(unknown.identity.id, 'fb-account-1', 0, context);
  engine.recordPublicationAttempt(
    {
      contentIdentityId: unknown.identity.id,
      sliceId: unknown.asset.id,
      accountId: 'fb-account-1',
      publishStatus: 'unknown',
      evidenceRefs: ['evidence://timeout'],
    },
    context,
  );
  assert.equal(
    engine.releaseContent(
      unknown.identity.id,
      { approvalsInvalidated: true, schedulesInvalidated: true },
      context,
    ).error?.code,
    'CONTENT_RESULT_UNRESOLVED',
  );

  const neverSubmitted = engine.admitContent(
    {
      title: '未提交内容',
      sourceRef: 'source://not-submitted',
      storySummary: '取消',
      asset: asset({ sha256: 'c'.repeat(64) }),
    },
    context,
  ).value!;
  engine.allocateContent(
    neverSubmitted.identity.id,
    'fb-account-2',
    0,
    context,
  );
  engine.recordPublicationAttempt(
    {
      contentIdentityId: neverSubmitted.identity.id,
      sliceId: neverSubmitted.asset.id,
      accountId: 'fb-account-2',
      publishStatus: 'not_submitted',
      evidenceRefs: ['evidence://pre-submit-cancel'],
    },
    context,
  );
  assert.equal(
    engine.releaseContent(
      neverSubmitted.identity.id,
      { approvalsInvalidated: false, schedulesInvalidated: true },
      context,
    ).error?.code,
    'CONTENT_OLD_AUTHORITY_ACTIVE',
  );
  const released = engine.releaseContent(
    neverSubmitted.identity.id,
    { approvalsInvalidated: true, schedulesInvalidated: true },
    context,
  );
  assert.equal(released.ok, true);
  assert.equal(released.value?.allocationStatus, 'unallocated');
  assert.equal(released.value?.assignedAccountId, undefined);
});

void test('content allocation rejects an account without an active publish authorization', () => {
  const { engine, context, logs } = harness();
  const admitted = engine.admitContent(
    {
      title: '未授权账号测试',
      sourceRef: 'source://unauthorized-allocation',
      storySummary: '校验账号服务授权',
      asset: asset({ sha256: 'f'.repeat(64) }),
    },
    context,
  ).value!;

  const rejected = engine.allocateContent(
    admitted.identity.id,
    'account-without-authorization',
    0,
    context,
  );

  assert.equal(rejected.error?.code, 'CONTENT_ACCOUNT_UNAUTHORIZED');
  assert.equal(admitted.identity.allocationStatus, 'unallocated');
  assert.equal(logs.at(-1)?.reasonCode, 'CONTENT_ACCOUNT_UNAUTHORIZED');
  assert.equal(logs.at(-1)?.facts.accountId, 'account-without-authorization');
});

void test('content admission rejects unresolved overlap and malformed checksums', () => {
  const { engine, context } = harness();
  const unresolved = engine.admitContent(
    {
      title: '重叠内容',
      sourceRef: 'source://overlap',
      storySummary: '待核对',
      asset: asset({
        overlapReview: {
          relatedContentIdentityId: 'content-old',
          rangeDescription: '开头 3 秒',
          decision: 'pending',
          evidenceRef: 'review://pending',
          reviewedBy: 'operator-a',
        },
      }),
    },
    context,
  );
  assert.equal(unresolved.error?.code, 'OVERLAP_REVIEW_PENDING');
  const invalidHash = engine.admitContent(
    {
      title: '坏哈希',
      sourceRef: 'source://hash',
      storySummary: '非法文件标识',
      asset: asset({ sha256: 'not-a-sha' }),
    },
    context,
  );
  assert.equal(invalidHash.error?.code, 'CONTENT_SHA256_INVALID');
});
