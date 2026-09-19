import type {
  AccountServiceRelation,
  AuditLogEntry,
  CommandContext,
  CommandResult,
  ContentIdentity,
  FirstLoopState,
  Project,
  ProjectGap,
  PublicationAttempt,
  PublishStatus,
  SliceAsset,
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
    const relation = this.state.accountServiceRelations.find(item => item.id === relationId);
    if (!relation) {
      return this.reject('AUTHORIZATION_NOT_FOUND', '账号服务授权关系不存在', 'account_service_relation', relationId, context);
    }
    if (relation.revokedAt) {
      return this.reject('AUTHORIZATION_ALREADY_REVOKED', '账号服务授权已经撤销', 'account_service_relation', relationId, context);
    }
    relation.revokedAt = this.now();
    this.accept('account.authorization_revoked', 'account_service_relation', relation.id, context, {
      projectId: relation.projectId,
      accountId: relation.accountId,
    });
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
