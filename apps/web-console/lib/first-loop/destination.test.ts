import assert from 'node:assert/strict';
import test from 'node:test';
import { FirstLoopEngine, createEmptyFirstLoopState } from './engine.ts';
import type { CommandContext } from './types.ts';

function setup() {
  let id = 0;
  const engine = new FirstLoopEngine(createEmptyFirstLoopState(), {
    now: () => '2026-09-19T11:00:00.000Z',
    nextId: (prefix) => `${prefix}-${++id}`,
  });
  const context: CommandContext = {
    actorId: 'destination-tester',
    correlationId: 'corr-fl02',
  };
  const project = engine.saveProjectDraft(
    {
      name: '入口项目',
      clientId: 'client-a',
      primaryGoal: '合格访问',
      audience: '英语受众',
      ownerId: 'owner-a',
    },
    context,
  ).value!;
  engine.grantAccountServiceRelation(
    {
      accountId: 'fb-a',
      projectId: project.id,
      clientId: 'client-a',
      ownerPartyId: 'owner-party',
      authorizerPartyId: 'client-a',
      authorizationRef: 'auth://destination',
      allowedActions: ['publish', 'maintain_destination'],
      allowedData: ['public_metrics'],
      validFrom: '2026-09-01T00:00:00Z',
    },
    context,
  );
  return { engine, context, project };
}

void test('C-06/C-12: destination requires an authorized project/account relation and valid URL', () => {
  const { engine, context, project } = setup();
  const denied = engine.createDestination(
    {
      projectId: project.id,
      accountId: 'unknown',
      scope: 'channel',
      scopeId: 'channel-a',
      url: 'https://example.com/a',
      maintenancePermissionRef: 'permission://a',
      sharedAttribution: true,
      exitPolicy: 'continue',
    },
    context,
  );
  assert.equal(denied.error?.code, 'DESTINATION_PERMISSION_MISSING');
  const invalid = engine.createDestination(
    {
      projectId: project.id,
      accountId: 'fb-a',
      scope: 'channel',
      scopeId: 'channel-a',
      url: 'javascript:alert(1)',
      maintenancePermissionRef: 'permission://a',
      sharedAttribution: true,
      exitPolicy: 'continue',
    },
    context,
  );
  assert.equal(invalid.error?.code, 'DESTINATION_URL_INVALID');
});

void test('C-06: raw visits, filtered clicks and redirect responses remain separate observations', () => {
  const { engine, context, project } = setup();
  const created = engine.createDestination(
    {
      projectId: project.id,
      accountId: 'fb-a',
      scope: 'channel',
      scopeId: 'channel-a',
      url: 'https://example.com/a',
      maintenancePermissionRef: 'permission://a',
      sharedAttribution: true,
      exitPolicy: 'continue',
    },
    context,
  ).value!;
  assert.deepEqual(engine.destinationObservation(created.entry.id), {});
  engine.recordDestinationEvent(
    {
      destinationEntryId: created.entry.id,
      destinationVersionId: created.version.id,
      eventType: 'raw_visit',
      reasonCode: 'REQUEST_RECEIVED',
    },
    context,
  );
  engine.recordDestinationEvent(
    {
      destinationEntryId: created.entry.id,
      destinationVersionId: created.version.id,
      eventType: 'redirect_response',
      responseStatus: 302,
      reasonCode: 'HTTP_302_OBSERVED',
    },
    context,
  );
  assert.deepEqual(engine.destinationObservation(created.entry.id), {
    rawVisits: 1,
    redirectResponses: 1,
  });
});

void test('C-08/T-11: shared entry change lists affected history and exit never retargets another client', () => {
  const { engine, context, project } = setup();
  const first = engine.admitContent(
    {
      title: '内容一',
      sourceRef: 'source://1',
      storySummary: '剧情一',
      asset: {
        language: 'en-US',
        variant: 'subtitle',
        fileRef: 'file://1',
        sha256: 'a'.repeat(64),
        rightsRef: 'rights://1',
        destinationFit: 'eligible',
      },
    },
    context,
  ).value!;
  engine.allocateContent(first.identity.id, 'fb-a', 0, context);
  const created = engine.createDestination(
    {
      projectId: project.id,
      accountId: 'fb-a',
      scope: 'channel',
      scopeId: 'channel-a',
      url: 'https://example.com/original',
      maintenancePermissionRef: 'permission://a',
      sharedAttribution: true,
      exitPolicy: 'disable',
    },
    context,
  ).value!;
  const unauthorized = engine.updateDestination(
    created.entry.id,
    {
      url: 'https://example.com/new',
      health: 'available',
      changeReason: '客户目的地变更',
      permissionRef: 'wrong',
    },
    context,
  );
  assert.equal(unauthorized.error?.code, 'DESTINATION_CHANGE_UNAUTHORIZED');
  const updated = engine.updateDestination(
    created.entry.id,
    {
      url: 'https://example.com/new',
      health: 'available',
      changeReason: '客户目的地变更',
      permissionRef: 'permission://a',
    },
    context,
  );
  assert.deepEqual(updated.value?.affectedContentIdentityIds, [
    first.identity.id,
  ]);
  engine.applyDestinationExit(created.entry.id, context);
  const snapshot = engine.snapshot();
  const active = snapshot.destinationVersions.find(
    (item) => item.id === snapshot.destinationEntries[0]?.activeVersionId,
  );
  assert.equal(active?.isActive, false);
  assert.equal(active?.url, 'https://example.com/new');
});
