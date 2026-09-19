import type {
  AccountServiceRelation,
  AuditLogEntry,
  BasicReview,
  CommandContext,
  CommandResult,
  ContentIdentity,
  DestinationEntry,
  DestinationEvent,
  DestinationHealth,
  DestinationVersion,
  FirstLoopState,
  MetricObservation,
  Project,
  ProjectGap,
  PublicationSchedule,
  PublicationAttempt,
  PublishStatus,
  SliceAsset,
  StrategyDraft,
  StrategyRule,
  ExecutionApproval,
} from './types.ts';

export interface EngineDependencies {
  now?: () => string;
  nextId?: (prefix: string) => string;
  logSink?: (entry: AuditLogEntry) => void;
}

const EMPTY_STATE: FirstLoopState = {
  projects: [],
  accountServiceRelations: [],
  contentIdentities: [],
  sliceAssets: [],
  publicationAttempts: [],
  destinationEntries: [],
  destinationVersions: [],
  destinationEvents: [],
  strategyRules: [],
  strategyDrafts: [],
  executionApprovals: [],
  publicationSchedules: [],
  metricObservations: [],
  basicReviews: [],
  auditLogs: [],
};

function cloneState(state: FirstLoopState): FirstLoopState {
  return structuredClone(state);
}

function normalizeStrings(values: string[]): string[] {
  return [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ].sort();
}

function isValidSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export class FirstLoopEngine {
  private state: FirstLoopState;
  private readonly now: () => string;
  private readonly nextId: (prefix: string) => string;
  private readonly logSink?: (entry: AuditLogEntry) => void;

  constructor(
    initialState: FirstLoopState = EMPTY_STATE,
    dependencies: EngineDependencies = {},
  ) {
    this.state = cloneState(initialState);
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.nextId =
      dependencies.nextId ?? ((prefix) => `${prefix}-${crypto.randomUUID()}`);
    this.logSink = dependencies.logSink;
  }

  snapshot(): FirstLoopState {
    return cloneState(this.state);
  }

  replaceState(nextState: FirstLoopState): void {
    this.state = cloneState(nextState);
  }

  listProjectGaps(projectId: string): ProjectGap[] {
    const project = this.state.projects.find((item) => item.id === projectId);
    if (!project) return [];
    const gaps: ProjectGap[] = [];
    if (!project.clientId)
      gaps.push({
        field: 'clientId',
        message: '缺少服务客户',
        blocks: 'approval',
      });
    if (!project.primaryGoal)
      gaps.push({
        field: 'primaryGoal',
        message: '缺少当前主目标',
        blocks: 'strategy',
      });
    if (!project.audience)
      gaps.push({
        field: 'audience',
        message: '缺少目标受众',
        blocks: 'strategy',
      });
    if (!project.ownerId)
      gaps.push({
        field: 'ownerId',
        message: '缺少责任人',
        blocks: 'execution',
      });
    return gaps;
  }

  saveProjectDraft(
    input: Omit<Project, 'id' | 'status' | 'createdAt' | 'updatedAt'> & {
      id?: string;
    },
    context: CommandContext,
  ): CommandResult<Project> {
    const name = input.name.trim();
    if (!name)
      return this.reject(
        'PROJECT_NAME_REQUIRED',
        '项目名称不能为空',
        'project',
        input.id ?? 'new',
        context,
      );
    if (input.startsAt && input.endsAt && input.startsAt >= input.endsAt) {
      return this.reject(
        'PROJECT_PERIOD_INVALID',
        '项目结束时间必须晚于开始时间',
        'project',
        input.id ?? 'new',
        context,
      );
    }
    const timestamp = this.now();
    const existing = input.id
      ? this.state.projects.find((item) => item.id === input.id)
      : undefined;
    const project: Project = {
      id: existing?.id ?? this.nextId('project'),
      name,
      clientId: input.clientId?.trim() || undefined,
      primaryGoal: input.primaryGoal?.trim() || undefined,
      audience: input.audience?.trim() || undefined,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      ownerId: input.ownerId?.trim() || undefined,
      status: existing?.status ?? 'draft',
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    this.state.projects = existing
      ? this.state.projects.map((item) =>
          item.id === project.id ? project : item,
        )
      : [...this.state.projects, project];
    if (existing?.primaryGoal && existing.primaryGoal !== project.primaryGoal) {
      this.invalidateProjectAuthority(
        project.id,
        'PROJECT_PRIMARY_GOAL_CHANGED',
      );
    }
    const gaps = this.listProjectGaps(project.id);
    this.accept('project.saved', 'project', project.id, context, {
      gapCount: gaps.length,
      status: project.status,
    });
    return { ok: true, value: structuredClone(project) };
  }

  activateProject(
    projectId: string,
    context: CommandContext,
  ): CommandResult<Project> {
    const project = this.state.projects.find((item) => item.id === projectId);
    if (!project)
      return this.reject(
        'PROJECT_NOT_FOUND',
        '项目不存在',
        'project',
        projectId,
        context,
      );
    const gaps = this.listProjectGaps(projectId);
    if (gaps.length > 0) {
      return this.reject(
        'PROJECT_INCOMPLETE',
        `项目仍有 ${gaps.length} 个必需信息缺口`,
        'project',
        projectId,
        context,
      );
    }
    project.status = 'active';
    project.updatedAt = this.now();
    this.accept('project.activated', 'project', projectId, context, {
      gapCount: 0,
    });
    return { ok: true, value: structuredClone(project) };
  }

  grantAccountServiceRelation(
    input: Omit<AccountServiceRelation, 'id' | 'createdAt'>,
    context: CommandContext,
  ): CommandResult<AccountServiceRelation> {
    const project = this.state.projects.find(
      (item) => item.id === input.projectId,
    );
    if (!project)
      return this.reject(
        'PROJECT_NOT_FOUND',
        '项目不存在',
        'account_service_relation',
        'new',
        context,
      );
    const required = [
      input.accountId,
      input.clientId,
      input.ownerPartyId,
      input.authorizerPartyId,
      input.authorizationRef,
    ];
    if (
      required.some((value) => !value.trim()) ||
      input.allowedActions.length === 0
    ) {
      return this.reject(
        'AUTHORIZATION_INCOMPLETE',
        '账号、主体、授权依据和允许动作必须完整',
        'account_service_relation',
        'new',
        context,
      );
    }
    if (input.validUntil && input.validFrom >= input.validUntil) {
      return this.reject(
        'AUTHORIZATION_PERIOD_INVALID',
        '授权结束时间必须晚于开始时间',
        'account_service_relation',
        'new',
        context,
      );
    }
    const overlappingRelations = this.state.accountServiceRelations.filter(
      (relation) =>
        relation.accountId === input.accountId &&
        !relation.revokedAt &&
        relation.clientId !== input.clientId &&
        (!relation.validUntil || relation.validUntil > input.validFrom) &&
        (!input.validUntil || relation.validFrom < input.validUntil),
    );
    if (overlappingRelations.length > 0 && !input.sharedApprovalRef?.trim()) {
      return this.reject(
        'SHARED_APPROVAL_REQUIRED',
        '同一账号并行服务多个客户需要共享批准依据',
        'account_service_relation',
        'new',
        context,
      );
    }
    const relation: AccountServiceRelation = {
      ...input,
      id: this.nextId('relation'),
      allowedActions: normalizeStrings(input.allowedActions),
      allowedData: normalizeStrings(input.allowedData),
      sharedApprovalRef: input.sharedApprovalRef?.trim() || undefined,
      createdAt: this.now(),
    };
    this.state.accountServiceRelations.push(relation);
    this.accept(
      'account.authorization_granted',
      'account_service_relation',
      relation.id,
      context,
      {
        projectId: relation.projectId,
        accountId: relation.accountId,
        shared: Boolean(relation.sharedApprovalRef),
      },
    );
    return { ok: true, value: structuredClone(relation) };
  }

  revokeAccountServiceRelation(
    relationId: string,
    context: CommandContext,
  ): CommandResult<AccountServiceRelation> {
    const relation = this.state.accountServiceRelations.find(
      (item) => item.id === relationId,
    );
    if (!relation) {
      return this.reject(
        'AUTHORIZATION_NOT_FOUND',
        '账号服务授权关系不存在',
        'account_service_relation',
        relationId,
        context,
      );
    }
    if (relation.revokedAt) {
      return this.reject(
        'AUTHORIZATION_ALREADY_REVOKED',
        '账号服务授权已经撤销',
        'account_service_relation',
        relationId,
        context,
      );
    }
    relation.revokedAt = this.now();
    this.invalidateProjectAuthority(
      relation.projectId,
      'ACCOUNT_AUTHORIZATION_REVOKED',
    );
    this.accept(
      'account.authorization_revoked',
      'account_service_relation',
      relation.id,
      context,
      {
        projectId: relation.projectId,
        accountId: relation.accountId,
      },
    );
    return { ok: true, value: structuredClone(relation) };
  }

  admitContent(
    input: {
      identity?: Pick<ContentIdentity, 'id'>;
      title: string;
      sourceRef: string;
      storySummary: string;
      asset: Omit<SliceAsset, 'id' | 'contentIdentityId' | 'createdAt'>;
    },
    context: CommandContext,
  ): CommandResult<{ identity: ContentIdentity; asset: SliceAsset }> {
    if (
      !input.title.trim() ||
      !input.sourceRef.trim() ||
      !input.asset.rightsRef.trim()
    ) {
      return this.reject(
        'CONTENT_PROVENANCE_REQUIRED',
        '标题、来源和权利依据不能为空',
        'content_identity',
        input.identity?.id ?? 'new',
        context,
      );
    }
    if (!isValidSha256(input.asset.sha256)) {
      return this.reject(
        'CONTENT_SHA256_INVALID',
        '素材 SHA256 必须为 64 位十六进制字符串',
        'slice_asset',
        'new',
        context,
      );
    }
    if (input.asset.overlapReview?.decision === 'pending') {
      return this.reject(
        'OVERLAP_REVIEW_PENDING',
        '剧情重叠仍待人工核对，不能进入合格库存',
        'slice_asset',
        'new',
        context,
      );
    }
    const timestamp = this.now();
    let identity = input.identity
      ? this.state.contentIdentities.find(
          (item) => item.id === input.identity?.id,
        )
      : undefined;
    if (input.identity && !identity) {
      return this.reject(
        'CONTENT_IDENTITY_NOT_FOUND',
        '指定内容身份不存在',
        'content_identity',
        input.identity.id,
        context,
      );
    }
    if (!identity) {
      identity = {
        id: this.nextId('content'),
        title: input.title.trim(),
        sourceRef: input.sourceRef.trim(),
        storySummary: input.storySummary.trim(),
        allocationStatus: 'unallocated',
        allocationVersion: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.state.contentIdentities.push(identity);
    }
    const asset: SliceAsset = {
      ...input.asset,
      id: this.nextId('slice'),
      contentIdentityId: identity.id,
      language: input.asset.language.trim(),
      fileRef: input.asset.fileRef.trim(),
      rightsRef: input.asset.rightsRef.trim(),
      createdAt: timestamp,
    };
    this.state.sliceAssets.push(asset);
    if (input.identity)
      this.invalidateContentAuthority(identity.id, 'CONTENT_VERSION_CHANGED');
    this.accept(
      'content.admitted',
      'content_identity',
      identity.id,
      context,
      {
        sliceId: asset.id,
        versionCount: this.state.sliceAssets.filter(
          (item) => item.contentIdentityId === identity?.id,
        ).length,
        eligible: asset.destinationFit === 'eligible',
      },
      [asset.rightsRef, input.sourceRef],
    );
    return {
      ok: true,
      value: {
        identity: structuredClone(identity),
        asset: structuredClone(asset),
      },
    };
  }

  allocateContent(
    contentIdentityId: string,
    accountId: string,
    expectedVersion: number,
    context: CommandContext,
  ): CommandResult<ContentIdentity> {
    const identity = this.state.contentIdentities.find(
      (item) => item.id === contentIdentityId,
    );
    if (!identity)
      return this.reject(
        'CONTENT_IDENTITY_NOT_FOUND',
        '内容身份不存在',
        'content_identity',
        contentIdentityId,
        context,
      );
    if (identity.allocationVersion !== expectedVersion) {
      return this.reject(
        'CONTENT_VERSION_CONFLICT',
        '内容归属版本已变化，请刷新后重试',
        'content_identity',
        contentIdentityId,
        context,
      );
    }
    if (identity.firstPublishedAt) {
      return this.reject(
        'CONTENT_ALREADY_PUBLISHED',
        '内容已有发布历史，原账号及其他账号均不可再次发布',
        'content_identity',
        contentIdentityId,
        context,
      );
    }
    const activeAttempt = this.state.publicationAttempts.find(
      (attempt) =>
        attempt.contentIdentityId === contentIdentityId &&
        ['in_progress', 'unknown', 'published'].includes(attempt.publishStatus),
    );
    if (activeAttempt) {
      return this.reject(
        'CONTENT_ATTEMPT_CONFLICT',
        '内容存在进行中、未知或已发布尝试，不能重新分配',
        'content_identity',
        contentIdentityId,
        context,
      );
    }
    if (
      identity.assignedAccountId &&
      identity.assignedAccountId !== accountId
    ) {
      return this.reject(
        'CONTENT_ACCOUNT_CONFLICT',
        '内容已独占归属其他账号',
        'content_identity',
        contentIdentityId,
        context,
      );
    }
    identity.allocationStatus = 'assigned_locked';
    identity.assignedAccountId = accountId;
    identity.allocationVersion += 1;
    identity.updatedAt = this.now();
    this.accept(
      'content.allocated',
      'content_identity',
      contentIdentityId,
      context,
      {
        accountId,
        allocationVersion: identity.allocationVersion,
      },
    );
    return { ok: true, value: structuredClone(identity) };
  }

  recordPublicationAttempt(
    input: Omit<PublicationAttempt, 'id' | 'createdAt' | 'updatedAt'>,
    context: CommandContext,
  ): CommandResult<PublicationAttempt> {
    const identity = this.state.contentIdentities.find(
      (item) => item.id === input.contentIdentityId,
    );
    const asset = this.state.sliceAssets.find(
      (item) =>
        item.id === input.sliceId &&
        item.contentIdentityId === input.contentIdentityId,
    );
    if (!identity || !asset)
      return this.reject(
        'CONTENT_REFERENCE_INVALID',
        '发布尝试引用的内容身份或文件不存在',
        'publication_attempt',
        'new',
        context,
      );
    if (identity.assignedAccountId !== input.accountId) {
      return this.reject(
        'CONTENT_ACCOUNT_MISMATCH',
        '发布账号与内容归属不一致',
        'publication_attempt',
        'new',
        context,
      );
    }
    if (
      input.publishStatus === 'published' &&
      input.evidenceRefs.length === 0
    ) {
      return this.reject(
        'PUBLICATION_EVIDENCE_REQUIRED',
        '确认公开必须提供证据引用',
        'publication_attempt',
        'new',
        context,
      );
    }
    const timestamp = this.now();
    const attempt: PublicationAttempt = {
      ...input,
      id: this.nextId('attempt'),
      evidenceRefs: normalizeStrings(input.evidenceRefs),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.state.publicationAttempts.push(attempt);
    if (attempt.publishStatus === 'published') {
      identity.firstPublishedAt ??= timestamp;
      identity.updatedAt = timestamp;
    }
    this.accept(
      'publication.attempt_recorded',
      'publication_attempt',
      attempt.id,
      context,
      {
        contentIdentityId: attempt.contentIdentityId,
        accountId: attempt.accountId,
        publishStatus: attempt.publishStatus,
      },
      attempt.evidenceRefs,
    );
    return { ok: true, value: structuredClone(attempt) };
  }

  releaseContent(
    contentIdentityId: string,
    input: { approvalsInvalidated: boolean; schedulesInvalidated: boolean },
    context: CommandContext,
  ): CommandResult<ContentIdentity> {
    const identity = this.state.contentIdentities.find(
      (item) => item.id === contentIdentityId,
    );
    if (!identity)
      return this.reject(
        'CONTENT_IDENTITY_NOT_FOUND',
        '内容身份不存在',
        'content_identity',
        contentIdentityId,
        context,
      );
    const attempts = this.state.publicationAttempts.filter(
      (item) => item.contentIdentityId === contentIdentityId,
    );
    if (
      identity.firstPublishedAt ||
      attempts.some((item) => item.publishStatus === 'published')
    ) {
      return this.reject(
        'CONTENT_ALREADY_PUBLISHED',
        '已有发布历史，不能释放发布资格',
        'content_identity',
        contentIdentityId,
        context,
      );
    }
    if (
      attempts.some((item) =>
        ['in_progress', 'unknown'].includes(item.publishStatus),
      )
    ) {
      return this.reject(
        'CONTENT_RESULT_UNRESOLVED',
        '存在进行中或未知结果，不能释放',
        'content_identity',
        contentIdentityId,
        context,
      );
    }
    if (!input.approvalsInvalidated || !input.schedulesInvalidated) {
      return this.reject(
        'CONTENT_OLD_AUTHORITY_ACTIVE',
        '旧批准和执行安排必须全部失效后才能释放',
        'content_identity',
        contentIdentityId,
        context,
      );
    }
    identity.allocationStatus = 'unallocated';
    identity.assignedAccountId = undefined;
    identity.allocationVersion += 1;
    identity.updatedAt = this.now();
    this.accept(
      'content.released',
      'content_identity',
      contentIdentityId,
      context,
      {
        allocationVersion: identity.allocationVersion,
        attemptCount: attempts.length,
      },
    );
    return { ok: true, value: structuredClone(identity) };
  }

  createDestination(
    input: {
      projectId: string;
      accountId: string;
      scope: DestinationEntry['scope'];
      scopeId: string;
      url: string;
      maintenancePermissionRef: string;
      sharedAttribution: boolean;
      exitPolicy: DestinationEntry['exitPolicy'];
    },
    context: CommandContext,
  ): CommandResult<{ entry: DestinationEntry; version: DestinationVersion }> {
    const project = this.state.projects.find(
      (item) => item.id === input.projectId,
    );
    if (!project)
      return this.reject(
        'PROJECT_NOT_FOUND',
        '项目不存在',
        'destination_entry',
        'new',
        context,
      );
    const relation = this.state.accountServiceRelations.find(
      (item) =>
        item.projectId === input.projectId &&
        item.accountId === input.accountId &&
        !item.revokedAt,
    );
    if (!relation)
      return this.reject(
        'DESTINATION_PERMISSION_MISSING',
        '项目与账号之间没有有效服务授权',
        'destination_entry',
        'new',
        context,
      );
    if (!input.maintenancePermissionRef.trim()) {
      return this.reject(
        'DESTINATION_MAINTENANCE_PERMISSION_REQUIRED',
        '入口维护权限依据不能为空',
        'destination_entry',
        'new',
        context,
      );
    }
    if (!isHttpUrl(input.url)) {
      return this.reject(
        'DESTINATION_URL_INVALID',
        '入口地址必须是 HTTP 或 HTTPS URL',
        'destination_entry',
        'new',
        context,
      );
    }
    if (
      input.scope === 'content' &&
      !this.state.contentIdentities.some((item) => item.id === input.scopeId)
    ) {
      return this.reject(
        'DESTINATION_SCOPE_NOT_FOUND',
        '内容范围不存在',
        'destination_entry',
        'new',
        context,
      );
    }
    const timestamp = this.now();
    const entryId = this.nextId('destination');
    const version: DestinationVersion = {
      id: this.nextId('destination-version'),
      destinationEntryId: entryId,
      url: input.url,
      health: 'available',
      isActive: true,
      changeReason: 'initial',
      createdAt: timestamp,
    };
    const entry: DestinationEntry = {
      id: entryId,
      projectId: input.projectId,
      accountId: input.accountId,
      scope: input.scope,
      scopeId: input.scopeId,
      maintenancePermissionRef: input.maintenancePermissionRef.trim(),
      sharedAttribution: input.sharedAttribution,
      exitPolicy: input.exitPolicy,
      activeVersionId: version.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.state.destinationEntries.push(entry);
    this.state.destinationVersions.push(version);
    this.accept(
      'destination.created',
      'destination_entry',
      entry.id,
      context,
      {
        projectId: entry.projectId,
        accountId: entry.accountId,
        scope: entry.scope,
        sharedAttribution: entry.sharedAttribution,
      },
      [entry.maintenancePermissionRef],
    );
    return {
      ok: true,
      value: {
        entry: structuredClone(entry),
        version: structuredClone(version),
      },
    };
  }

  updateDestination(
    destinationEntryId: string,
    input: {
      url: string;
      health: DestinationHealth;
      changeReason: string;
      permissionRef: string;
    },
    context: CommandContext,
  ): CommandResult<{
    version: DestinationVersion;
    affectedContentIdentityIds: string[];
  }> {
    const entry = this.state.destinationEntries.find(
      (item) => item.id === destinationEntryId,
    );
    if (!entry)
      return this.reject(
        'DESTINATION_NOT_FOUND',
        '入口不存在',
        'destination_entry',
        destinationEntryId,
        context,
      );
    if (input.permissionRef !== entry.maintenancePermissionRef) {
      return this.reject(
        'DESTINATION_CHANGE_UNAUTHORIZED',
        '当前依据无权维护该入口',
        'destination_entry',
        destinationEntryId,
        context,
      );
    }
    if (!isHttpUrl(input.url) || !input.changeReason.trim()) {
      return this.reject(
        'DESTINATION_CHANGE_INVALID',
        '入口地址和变更原因必须有效',
        'destination_entry',
        destinationEntryId,
        context,
      );
    }
    const previous = this.state.destinationVersions.find(
      (item) => item.id === entry.activeVersionId,
    );
    if (previous) previous.isActive = false;
    if (previous)
      this.invalidateDestinationAuthority(
        previous.id,
        'DESTINATION_VERSION_CHANGED',
      );
    const version: DestinationVersion = {
      id: this.nextId('destination-version'),
      destinationEntryId,
      url: input.url,
      health: input.health,
      isActive: true,
      changeReason: input.changeReason.trim(),
      supersedesVersionId: previous?.id,
      createdAt: this.now(),
    };
    this.state.destinationVersions.push(version);
    entry.activeVersionId = version.id;
    entry.updatedAt = this.now();
    const affectedContentIdentityIds =
      entry.scope === 'content'
        ? [entry.scopeId]
        : this.state.contentIdentities
            .filter((item) => item.assignedAccountId === entry.accountId)
            .map((item) => item.id);
    this.accept(
      'destination.updated',
      'destination_entry',
      entry.id,
      context,
      {
        versionId: version.id,
        previousVersionId: previous?.id ?? null,
        affectedContentCount: affectedContentIdentityIds.length,
      },
      [input.permissionRef],
    );
    return {
      ok: true,
      value: { version: structuredClone(version), affectedContentIdentityIds },
    };
  }

  recordDestinationEvent(
    input: Omit<DestinationEvent, 'id' | 'observedAt' | 'correlationId'>,
    context: CommandContext,
  ): CommandResult<DestinationEvent> {
    const entry = this.state.destinationEntries.find(
      (item) => item.id === input.destinationEntryId,
    );
    const version = this.state.destinationVersions.find(
      (item) =>
        item.id === input.destinationVersionId &&
        item.destinationEntryId === input.destinationEntryId,
    );
    if (!entry || !version)
      return this.reject(
        'DESTINATION_REFERENCE_INVALID',
        '入口或入口版本不存在',
        'destination_event',
        'new',
        context,
      );
    if (
      input.eventType === 'redirect_response' &&
      (!input.responseStatus ||
        input.responseStatus < 100 ||
        input.responseStatus > 599)
    ) {
      return this.reject(
        'REDIRECT_STATUS_REQUIRED',
        '跳转响应必须记录有效 HTTP 状态码',
        'destination_event',
        'new',
        context,
      );
    }
    const event: DestinationEvent = {
      ...input,
      id: this.nextId('destination-event'),
      observedAt: this.now(),
      correlationId: context.correlationId,
    };
    this.state.destinationEvents.push(event);
    this.accept(
      'destination.event_observed',
      'destination_event',
      event.id,
      context,
      {
        destinationEntryId: entry.id,
        eventType: event.eventType,
        responseStatus: event.responseStatus ?? null,
      },
    );
    return { ok: true, value: structuredClone(event) };
  }

  destinationObservation(destinationEntryId: string): {
    rawVisits?: number;
    filteredClicks?: number;
    redirectResponses?: number;
  } {
    const events = this.state.destinationEvents.filter(
      (item) => item.destinationEntryId === destinationEntryId,
    );
    const count = (eventType: DestinationEvent['eventType']) =>
      events.filter((item) => item.eventType === eventType).length;
    return {
      ...(events.some((item) => item.eventType === 'raw_visit')
        ? { rawVisits: count('raw_visit') }
        : {}),
      ...(events.some((item) => item.eventType === 'filtered_click')
        ? { filteredClicks: count('filtered_click') }
        : {}),
      ...(events.some((item) => item.eventType === 'redirect_response')
        ? { redirectResponses: count('redirect_response') }
        : {}),
    };
  }

  applyDestinationExit(
    destinationEntryId: string,
    context: CommandContext,
  ): CommandResult<DestinationEntry> {
    const entry = this.state.destinationEntries.find(
      (item) => item.id === destinationEntryId,
    );
    if (!entry)
      return this.reject(
        'DESTINATION_NOT_FOUND',
        '入口不存在',
        'destination_entry',
        destinationEntryId,
        context,
      );
    const version = this.state.destinationVersions.find(
      (item) => item.id === entry.activeVersionId,
    );
    if (entry.exitPolicy === 'disable' && version) version.isActive = false;
    entry.updatedAt = this.now();
    this.accept(
      'destination.exit_policy_applied',
      'destination_entry',
      entry.id,
      context,
      {
        exitPolicy: entry.exitPolicy,
        active: Boolean(version?.isActive),
        activeUrl: version?.url ?? null,
      },
    );
    return { ok: true, value: structuredClone(entry) };
  }

  addStrategyRule(
    input: Omit<StrategyRule, 'id' | 'version' | 'status' | 'createdAt'>,
    context: CommandContext,
  ): CommandResult<StrategyRule> {
    if (!this.state.projects.some((item) => item.id === input.projectId)) {
      return this.reject(
        'PROJECT_NOT_FOUND',
        '项目不存在',
        'strategy_rule',
        'new',
        context,
      );
    }
    if (!input.statement.trim() || !input.sourceRef.trim()) {
      return this.reject(
        'RULE_EVIDENCE_REQUIRED',
        '规则陈述和来源引用不能为空',
        'strategy_rule',
        'new',
        context,
      );
    }
    const existing = this.state.strategyRules.filter(
      (item) =>
        item.projectId === input.projectId && item.category === input.category,
    );
    for (const item of existing) item.status = 'superseded';
    const rule: StrategyRule = {
      ...input,
      id: this.nextId('rule'),
      version: Math.max(0, ...existing.map((item) => item.version)) + 1,
      statement: input.statement.trim(),
      sourceRef: input.sourceRef.trim(),
      status: 'active',
      createdAt: this.now(),
    };
    this.state.strategyRules.push(rule);
    this.accept(
      'strategy.rule_versioned',
      'strategy_rule',
      rule.id,
      context,
      {
        projectId: rule.projectId,
        category: rule.category,
        version: rule.version,
      },
      [rule.sourceRef],
    );
    return { ok: true, value: structuredClone(rule) };
  }

  generateStrategyDraft(
    input: {
      projectId: string;
      outputMode: StrategyDraft['outputMode'];
      rationale: string;
      assumptions: string[];
    },
    context: CommandContext,
  ): CommandResult<StrategyDraft> {
    const project = this.state.projects.find(
      (item) => item.id === input.projectId,
    );
    if (!project || project.status !== 'active') {
      return this.reject(
        'STRATEGY_PROJECT_NOT_ACTIVE',
        '项目不存在或尚未激活',
        'strategy_draft',
        'new',
        context,
      );
    }
    const rules = this.state.strategyRules.filter(
      (item) => item.projectId === input.projectId && item.status === 'active',
    );
    if (rules.length === 0)
      return this.reject(
        'STRATEGY_RULES_MISSING',
        '缺少有来源的当前规则',
        'strategy_draft',
        'new',
        context,
      );
    const relations = this.state.accountServiceRelations.filter(
      (item) => item.projectId === input.projectId && !item.revokedAt,
    );
    const identity = this.state.contentIdentities.find(
      (item) =>
        item.allocationStatus === 'assigned_locked' &&
        relations.some(
          (relation) => relation.accountId === item.assignedAccountId,
        ) &&
        this.state.sliceAssets.some(
          (asset) =>
            asset.contentIdentityId === item.id &&
            asset.destinationFit === 'eligible',
        ),
    );
    if (!identity?.assignedAccountId)
      return this.reject(
        'STRATEGY_ELIGIBLE_CONTENT_MISSING',
        '没有归属到已授权账号的合格内容',
        'strategy_draft',
        'new',
        context,
      );
    const destination = this.state.destinationEntries.find(
      (item) =>
        item.projectId === input.projectId &&
        item.accountId === identity.assignedAccountId,
    );
    const destinationVersion = destination
      ? this.state.destinationVersions.find(
          (item) =>
            item.id === destination.activeVersionId &&
            item.isActive &&
            item.health === 'available',
        )
      : undefined;
    if (!destinationVersion)
      return this.reject(
        'STRATEGY_DESTINATION_MISSING',
        '没有可用的当前入口版本',
        'strategy_draft',
        'new',
        context,
      );
    if (!input.rationale.trim())
      return this.reject(
        'STRATEGY_RATIONALE_REQUIRED',
        '策略草案必须说明依据',
        'strategy_draft',
        'new',
        context,
      );
    const draft: StrategyDraft = {
      id: this.nextId('strategy'),
      projectId: input.projectId,
      version:
        Math.max(
          0,
          ...this.state.strategyDrafts
            .filter((item) => item.projectId === input.projectId)
            .map((item) => item.version),
        ) + 1,
      ruleIds: rules.map((item) => item.id),
      contentIdentityId: identity.id,
      accountId: identity.assignedAccountId,
      destinationVersionId: destinationVersion.id,
      rationale: input.rationale.trim(),
      assumptions: normalizeStrings(input.assumptions),
      evidenceRefs: rules.map((item) => item.sourceRef),
      outputMode: input.outputMode,
      createdAt: this.now(),
    };
    this.state.strategyDrafts.push(draft);
    this.accept(
      'strategy.draft_generated',
      'strategy_draft',
      draft.id,
      context,
      {
        version: draft.version,
        outputMode: draft.outputMode,
        contentIdentityId: draft.contentIdentityId,
      },
      draft.evidenceRefs,
    );
    return { ok: true, value: structuredClone(draft) };
  }

  approveStrategy(
    input: {
      strategyDraftId: string;
      expectedStrategyVersion: number;
      quantity: number;
      costLimit?: number;
      validFrom: string;
      validUntil: string;
      stopConditions: string[];
      observationConditions: string[];
    },
    context: CommandContext,
  ): CommandResult<ExecutionApproval> {
    const draft = this.state.strategyDrafts.find(
      (item) => item.id === input.strategyDraftId,
    );
    if (!draft)
      return this.reject(
        'STRATEGY_DRAFT_NOT_FOUND',
        '策略草案不存在',
        'execution_approval',
        'new',
        context,
      );
    if (draft.version !== input.expectedStrategyVersion)
      return this.reject(
        'STRATEGY_VERSION_CONFLICT',
        '策略版本已变化',
        'execution_approval',
        'new',
        context,
      );
    if (
      !Number.isInteger(input.quantity) ||
      input.quantity <= 0 ||
      input.validFrom >= input.validUntil ||
      input.stopConditions.length === 0 ||
      input.observationConditions.length === 0
    ) {
      return this.reject(
        'APPROVAL_SCOPE_INCOMPLETE',
        '批准必须明确数量、有效期、停止和观察条件',
        'execution_approval',
        'new',
        context,
      );
    }
    const identity = this.state.contentIdentities.find(
      (item) => item.id === draft.contentIdentityId,
    );
    const relation = this.state.accountServiceRelations.find(
      (item) =>
        item.projectId === draft.projectId &&
        item.accountId === draft.accountId &&
        !item.revokedAt,
    );
    const destination = this.state.destinationVersions.find(
      (item) =>
        item.id === draft.destinationVersionId &&
        item.isActive &&
        item.health === 'available',
    );
    if (
      !identity ||
      identity.assignedAccountId !== draft.accountId ||
      identity.firstPublishedAt ||
      !relation ||
      !destination
    ) {
      return this.reject(
        'APPROVAL_QUALIFICATION_CHANGED',
        '内容归属、授权或入口资格已变化',
        'execution_approval',
        'new',
        context,
      );
    }
    const approval: ExecutionApproval = {
      id: this.nextId('approval'),
      projectId: draft.projectId,
      strategyDraftId: draft.id,
      strategyVersion: draft.version,
      contentIdentityId: draft.contentIdentityId,
      accountId: draft.accountId,
      destinationVersionId: draft.destinationVersionId,
      quantity: input.quantity,
      costLimit: input.costLimit,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      stopConditions: normalizeStrings(input.stopConditions),
      observationConditions: normalizeStrings(input.observationConditions),
      status: 'active',
      approvedBy: context.actorId,
      createdAt: this.now(),
    };
    this.state.executionApprovals.push(approval);
    this.accept(
      'strategy.approved',
      'execution_approval',
      approval.id,
      context,
      {
        strategyVersion: approval.strategyVersion,
        quantity: approval.quantity,
        costLimit: approval.costLimit ?? null,
      },
    );
    return { ok: true, value: structuredClone(approval) };
  }

  approveStrategyBatch(
    requests: Parameters<FirstLoopEngine['approveStrategy']>[0][],
    context: CommandContext,
  ): CommandResult<ExecutionApproval>[] {
    return requests.map((request) => this.approveStrategy(request, context));
  }

  scheduleApproval(
    input: Omit<PublicationSchedule, 'id' | 'status' | 'createdAt'>,
    context: CommandContext,
  ): CommandResult<PublicationSchedule> {
    const approval = this.state.executionApprovals.find(
      (item) => item.id === input.approvalId && item.status === 'active',
    );
    if (!approval)
      return this.reject(
        'APPROVAL_NOT_ACTIVE',
        '批准不存在或已经失效',
        'publication_schedule',
        'new',
        context,
      );
    if (
      !input.businessTimezone.trim() ||
      input.scheduledFor >= input.expiresAt ||
      input.expiresAt > approval.validUntil
    ) {
      return this.reject(
        'SCHEDULE_WINDOW_INVALID',
        '排期必须包含业务时区且位于批准有效期内',
        'publication_schedule',
        'new',
        context,
      );
    }
    const schedule: PublicationSchedule = {
      ...input,
      id: this.nextId('schedule'),
      status: 'scheduled',
      createdAt: this.now(),
    };
    this.state.publicationSchedules.push(schedule);
    this.accept(
      'schedule.created',
      'publication_schedule',
      schedule.id,
      context,
      {
        approvalId: schedule.approvalId,
        businessTimezone: schedule.businessTimezone,
        expiresAt: schedule.expiresAt,
      },
    );
    return { ok: true, value: structuredClone(schedule) };
  }

  expireSchedules(
    asOf: string,
    context: CommandContext,
  ): PublicationSchedule[] {
    const expired = this.state.publicationSchedules.filter(
      (item) => item.status === 'scheduled' && item.expiresAt <= asOf,
    );
    for (const schedule of expired) {
      schedule.status = 'expired';
      this.accept(
        'schedule.expired_without_backfill',
        'publication_schedule',
        schedule.id,
        context,
        { asOf },
      );
    }
    return structuredClone(expired);
  }

  recordMetricObservation(
    input: Omit<MetricObservation, 'id' | 'capturedAt'>,
    context: CommandContext,
  ): CommandResult<MetricObservation> {
    const approval = this.state.executionApprovals.find(
      (item) =>
        item.id === input.approvalId &&
        item.projectId === input.projectId &&
        item.strategyVersion === input.strategyVersion,
    );
    if (!approval)
      return this.reject(
        'OBSERVATION_SCOPE_INVALID',
        '观察记录与批准、项目或策略版本不一致',
        'metric_observation',
        'new',
        context,
      );
    if (
      !input.metricKey.trim() ||
      !input.source.trim() ||
      !input.unit.trim() ||
      !input.scope.trim() ||
      input.windowStart >= input.windowEnd
    ) {
      return this.reject(
        'OBSERVATION_METADATA_INCOMPLETE',
        '指标、来源、单位、范围和时间窗必须完整',
        'metric_observation',
        'new',
        context,
      );
    }
    const hasValue =
      typeof input.value === 'number' && Number.isFinite(input.value);
    if (input.availability === 'observed_zero' && input.value !== 0) {
      return this.reject(
        'OBSERVATION_ZERO_MISMATCH',
        '真实零值必须明确记录数值 0',
        'metric_observation',
        'new',
        context,
      );
    }
    if (input.availability === 'observed_value' && !hasValue) {
      return this.reject(
        'OBSERVATION_VALUE_REQUIRED',
        '已观察值必须提供有限数值',
        'metric_observation',
        'new',
        context,
      );
    }
    if (
      !['observed_value', 'observed_zero'].includes(input.availability) &&
      input.value !== undefined
    ) {
      return this.reject(
        'OBSERVATION_UNAVAILABLE_HAS_VALUE',
        '缺失、延迟或无权限不能填入数值',
        'metric_observation',
        'new',
        context,
      );
    }
    const observation: MetricObservation = {
      ...input,
      id: this.nextId('observation'),
      metricKey: input.metricKey.trim(),
      source: input.source.trim(),
      unit: input.unit.trim(),
      scope: input.scope.trim(),
      capturedAt: this.now(),
    };
    this.state.metricObservations.push(observation);
    this.accept(
      'observation.recorded',
      'metric_observation',
      observation.id,
      context,
      {
        metricKey: observation.metricKey,
        availability: observation.availability,
        value: observation.value ?? null,
        source: observation.source,
        controlledData: observation.controlledData,
      },
    );
    return { ok: true, value: structuredClone(observation) };
  }

  createBasicReview(
    input: {
      projectId: string;
      approvalId: string;
      primaryMetricKey: string;
      requiredWorkComplete: boolean;
      sourceComparisonAccepted: boolean;
    },
    context: CommandContext,
  ): CommandResult<BasicReview> {
    const project = this.state.projects.find(
      (item) => item.id === input.projectId,
    );
    const approval = this.state.executionApprovals.find(
      (item) =>
        item.id === input.approvalId && item.projectId === input.projectId,
    );
    if (!project || !approval)
      return this.reject(
        'REVIEW_SCOPE_INVALID',
        '复盘引用的项目或批准不存在',
        'basic_review',
        'new',
        context,
      );
    const observations = this.state.metricObservations.filter(
      (item) =>
        item.projectId === input.projectId &&
        item.approvalId === input.approvalId &&
        item.metricKey === input.primaryMetricKey,
    );
    const baseline = observations.find(
      (item) => item.comparisonRole === 'baseline',
    );
    const current = observations.find(
      (item) => item.comparisonRole === 'current',
    );
    const sources = new Set(observations.map((item) => item.source));
    const sourceChanged = sources.size > 1;
    const limitations: string[] = [];
    let outcome: BasicReview['outcome'];
    if (!input.requiredWorkComplete) {
      outcome = 'required_work_incomplete';
      limitations.push('必需工作未完成，不能评价策略改善');
    } else if (
      !baseline ||
      !current ||
      !['observed_value', 'observed_zero'].includes(baseline.availability) ||
      !['observed_value', 'observed_zero'].includes(current.availability)
    ) {
      outcome = 'evidence_insufficient';
      limitations.push('基线或当前主指标缺失、延迟或无权限');
    } else if (sourceChanged && !input.sourceComparisonAccepted) {
      outcome = 'evidence_insufficient';
      limitations.push('数据来源已变化且可比性尚未确认');
    } else if ((current.value ?? 0) > (baseline.value ?? 0)) {
      outcome = 'limited_improvement';
      limitations.push('改善仅适用于当前批准范围与观察窗');
    } else {
      outcome = 'no_improvement';
      limitations.push('完整观察未显示主指标改善，不自动推广');
    }
    const facts = observations.map(
      (item) =>
        `${item.comparisonRole}:${item.metricKey}:${item.availability}:${item.value ?? 'NA'} ${item.unit}@${item.source}`,
    );
    const review: BasicReview = {
      id: this.nextId('review'),
      projectId: project.id,
      approvalId: approval.id,
      strategyVersion: approval.strategyVersion,
      primaryGoalSnapshot: project.primaryGoal ?? '',
      primaryMetricKey: input.primaryMetricKey,
      outcome,
      facts,
      limitations,
      sourceChanged,
      controlledData: observations.some((item) => item.controlledData),
      aiAnalysis: `基于 ${facts.length} 条可用性记录得出 ${outcome}；限制：${limitations.join('；')}`,
      createdAt: this.now(),
    };
    this.state.basicReviews.push(review);
    this.accept('review.created', 'basic_review', review.id, context, {
      outcome: review.outcome,
      sourceChanged: review.sourceChanged,
      controlledData: review.controlledData,
    });
    return { ok: true, value: structuredClone(review) };
  }

  confirmReview(
    reviewId: string,
    nextAction: NonNullable<BasicReview['nextAction']>,
    context: CommandContext,
  ): CommandResult<BasicReview> {
    const review = this.state.basicReviews.find((item) => item.id === reviewId);
    if (!review)
      return this.reject(
        'REVIEW_NOT_FOUND',
        '复盘不存在',
        'basic_review',
        reviewId,
        context,
      );
    review.confirmedBy = context.actorId;
    review.confirmedAt = this.now();
    review.nextAction = nextAction;
    this.accept('review.confirmed', 'basic_review', review.id, context, {
      nextAction,
    });
    return { ok: true, value: structuredClone(review) };
  }

  recordExecutionReceipt(
    input: {
      attemptId: string;
      contentIdentityId: string;
      sliceId: string;
      accountId: string;
      publishStatus: PublishStatus;
      evidenceRefs: string[];
    },
    context: CommandContext,
  ): CommandResult<PublicationAttempt> {
    const identity = this.state.contentIdentities.find(
      (item) => item.id === input.contentIdentityId,
    );
    const asset = this.state.sliceAssets.find(
      (item) =>
        item.id === input.sliceId &&
        item.contentIdentityId === input.contentIdentityId,
    );
    if (!identity || !asset || identity.assignedAccountId !== input.accountId) {
      return this.reject(
        'EXECUTION_RECEIPT_SCOPE_INVALID',
        '回执与内容、文件或账号归属不一致',
        'publication_attempt',
        input.attemptId,
        context,
      );
    }
    const existing = this.state.publicationAttempts.find(
      (item) => item.id === input.attemptId,
    );
    if (existing) {
      if (existing.publishStatus === 'published')
        return { ok: true, value: structuredClone(existing) };
      if (
        input.publishStatus === 'published' &&
        input.evidenceRefs.length === 0
      ) {
        return this.reject(
          'PUBLICATION_EVIDENCE_REQUIRED',
          '确认公开必须提供证据引用',
          'publication_attempt',
          input.attemptId,
          context,
        );
      }
      existing.publishStatus = input.publishStatus;
      existing.evidenceRefs = normalizeStrings([
        ...existing.evidenceRefs,
        ...input.evidenceRefs,
      ]);
      existing.updatedAt = this.now();
      if (input.publishStatus === 'published') {
        identity.firstPublishedAt ??= existing.updatedAt;
        identity.updatedAt = existing.updatedAt;
      }
      this.accept(
        'publication.receipt_updated',
        'publication_attempt',
        existing.id,
        context,
        {
          publishStatus: existing.publishStatus,
          evidenceCount: existing.evidenceRefs.length,
        },
        input.evidenceRefs,
      );
      return { ok: true, value: structuredClone(existing) };
    }
    if (
      input.publishStatus === 'published' &&
      input.evidenceRefs.length === 0
    ) {
      return this.reject(
        'PUBLICATION_EVIDENCE_REQUIRED',
        '确认公开必须提供证据引用',
        'publication_attempt',
        input.attemptId,
        context,
      );
    }
    const timestamp = this.now();
    const attempt: PublicationAttempt = {
      id: input.attemptId,
      contentIdentityId: input.contentIdentityId,
      sliceId: input.sliceId,
      accountId: input.accountId,
      publishStatus: input.publishStatus,
      evidenceRefs: normalizeStrings(input.evidenceRefs),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.state.publicationAttempts.push(attempt);
    if (attempt.publishStatus === 'published')
      identity.firstPublishedAt ??= timestamp;
    this.accept(
      'publication.receipt_recorded',
      'publication_attempt',
      attempt.id,
      context,
      {
        publishStatus: attempt.publishStatus,
        contentIdentityId: attempt.contentIdentityId,
      },
      attempt.evidenceRefs,
    );
    return { ok: true, value: structuredClone(attempt) };
  }

  exitProject(
    projectId: string,
    context: CommandContext,
  ): CommandResult<Project> {
    const project = this.state.projects.find((item) => item.id === projectId);
    if (!project)
      return this.reject(
        'PROJECT_NOT_FOUND',
        '项目不存在',
        'project',
        projectId,
        context,
      );
    project.status = 'exited';
    project.updatedAt = this.now();
    for (const relation of this.state.accountServiceRelations) {
      if (relation.projectId === projectId && !relation.revokedAt)
        relation.revokedAt = project.updatedAt;
    }
    this.invalidateProjectAuthority(projectId, 'PROJECT_EXITED');
    for (const entry of this.state.destinationEntries.filter(
      (item) => item.projectId === projectId,
    )) {
      const version = this.state.destinationVersions.find(
        (item) => item.id === entry.activeVersionId,
      );
      if (entry.exitPolicy === 'disable' && version) version.isActive = false;
      entry.updatedAt = project.updatedAt;
    }
    this.accept('project.exited', 'project', project.id, context, {
      revokedRelationCount: this.state.accountServiceRelations.filter(
        (item) => item.projectId === projectId && item.revokedAt,
      ).length,
      destinationCount: this.state.destinationEntries.filter(
        (item) => item.projectId === projectId,
      ).length,
    });
    return { ok: true, value: structuredClone(project) };
  }

  private invalidateProjectAuthority(projectId: string, reason: string): void {
    const approvalIds = new Set<string>();
    for (const approval of this.state.executionApprovals) {
      if (approval.projectId === projectId && approval.status === 'active') {
        approval.status = 'invalidated';
        approval.invalidationReason = reason;
        approvalIds.add(approval.id);
      }
    }
    for (const schedule of this.state.publicationSchedules) {
      if (
        approvalIds.has(schedule.approvalId) &&
        schedule.status === 'scheduled'
      )
        schedule.status = 'cancelled';
    }
  }

  private invalidateContentAuthority(
    contentIdentityId: string,
    reason: string,
  ): void {
    const approvalIds = new Set<string>();
    for (const approval of this.state.executionApprovals) {
      if (
        approval.contentIdentityId === contentIdentityId &&
        approval.status === 'active'
      ) {
        approval.status = 'invalidated';
        approval.invalidationReason = reason;
        approvalIds.add(approval.id);
      }
    }
    this.cancelSchedulesForApprovals(approvalIds);
  }

  private invalidateDestinationAuthority(
    destinationVersionId: string,
    reason: string,
  ): void {
    const approvalIds = new Set<string>();
    for (const approval of this.state.executionApprovals) {
      if (
        approval.destinationVersionId === destinationVersionId &&
        approval.status === 'active'
      ) {
        approval.status = 'invalidated';
        approval.invalidationReason = reason;
        approvalIds.add(approval.id);
      }
    }
    this.cancelSchedulesForApprovals(approvalIds);
  }

  private cancelSchedulesForApprovals(approvalIds: Set<string>): void {
    for (const schedule of this.state.publicationSchedules) {
      if (
        approvalIds.has(schedule.approvalId) &&
        schedule.status === 'scheduled'
      )
        schedule.status = 'cancelled';
    }
  }

  private accept(
    action: string,
    entityType: string,
    entityId: string,
    context: CommandContext,
    facts: AuditLogEntry['facts'],
    extraEvidenceRefs: string[] = [],
  ): void {
    this.appendLog({
      id: this.nextId('log'),
      timestamp: this.now(),
      correlationId: context.correlationId,
      actorId: context.actorId,
      action,
      entityType,
      entityId,
      result: 'accepted',
      reasonCode: 'OK',
      facts,
      evidenceRefs: normalizeStrings([
        ...(context.evidenceRefs ?? []),
        ...extraEvidenceRefs,
      ]),
    });
  }

  private reject<T>(
    code: string,
    message: string,
    entityType: string,
    entityId: string,
    context: CommandContext,
  ): CommandResult<T> {
    this.appendLog({
      id: this.nextId('log'),
      timestamp: this.now(),
      correlationId: context.correlationId,
      actorId: context.actorId,
      action: `${entityType}.rejected`,
      entityType,
      entityId,
      result: 'rejected',
      reasonCode: code,
      facts: { message },
      evidenceRefs: normalizeStrings(context.evidenceRefs ?? []),
    });
    return { ok: false, error: { code, message } };
  }

  private appendLog(entry: AuditLogEntry): void {
    this.state.auditLogs.push(entry);
    this.logSink?.(structuredClone(entry));
  }
}

export function createEmptyFirstLoopState(): FirstLoopState {
  return cloneState(EMPTY_STATE);
}

export function createCommandContext(
  actorId = 'operator-demo',
  correlationId = crypto.randomUUID(),
): CommandContext {
  return { actorId, correlationId };
}

export function isBlockingPublishStatus(status: PublishStatus): boolean {
  return (
    status === 'in_progress' || status === 'unknown' || status === 'published'
  );
}
