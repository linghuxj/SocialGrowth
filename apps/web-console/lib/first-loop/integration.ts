import type { PublishTaskDirective } from '../../../artemis-controller/src/types.ts';
import type { CommandResult, FirstLoopState } from './types.ts';

const appPackages: Record<PublishTaskDirective['platform'], string> = {
  facebook: 'com.facebook.katana',
  instagram: 'com.instagram.android',
  youtube: 'com.google.android.youtube',
};

export function buildPublishTaskDirective(
  state: FirstLoopState,
  input: {
    approvalId: string;
    scheduleId: string;
    taskId: string;
    attemptId: string;
    previousAttemptId?: string;
    bindingId: string;
    deviceId: string;
    platform: PublishTaskDirective['platform'];
    captionText: string;
    mediaUrl: string;
    mediaExpiresAt: string;
    taskTimeoutMs: number;
  },
): CommandResult<PublishTaskDirective> {
  const approval = state.executionApprovals.find(
    (item) => item.id === input.approvalId && item.status === 'active',
  );
  const schedule = state.publicationSchedules.find(
    (item) =>
      item.id === input.scheduleId &&
      item.approvalId === input.approvalId &&
      item.status === 'scheduled',
  );
  if (!approval || !schedule)
    return {
      ok: false,
      error: {
        code: 'EXECUTION_AUTHORITY_INVALID',
        message: '批准或排期不存在、已失效或已过期',
      },
    };
  const relation = state.accountServiceRelations.find(
    (item) =>
      item.projectId === approval.projectId &&
      item.accountId === approval.accountId &&
      !item.revokedAt,
  );
  const identity = state.contentIdentities.find(
    (item) =>
      item.id === approval.contentIdentityId &&
      item.assignedAccountId === approval.accountId &&
      !item.firstPublishedAt,
  );
  const asset = state.sliceAssets.find(
    (item) =>
      item.contentIdentityId === approval.contentIdentityId &&
      item.destinationFit === 'eligible',
  );
  const destination = state.destinationVersions.find(
    (item) =>
      item.id === approval.destinationVersionId &&
      item.isActive &&
      item.health === 'available',
  );
  if (!relation || !identity || !asset || !destination) {
    return {
      ok: false,
      error: {
        code: 'EXECUTION_QUALIFICATION_CHANGED',
        message: '授权、内容归属、合格文件或入口资格已变化',
      },
    };
  }
  if (input.mediaExpiresAt <= schedule.expiresAt) {
    return {
      ok: false,
      error: {
        code: 'MEDIA_URL_EXPIRES_TOO_EARLY',
        message: '素材地址有效期必须覆盖执行排期',
      },
    };
  }
  return {
    ok: true,
    value: {
      schemaVersion: 'design-v1',
      taskId: input.taskId,
      attemptId: input.attemptId,
      previousAttemptId: input.previousAttemptId,
      projectId: approval.projectId,
      strategyVersionId: approval.strategyDraftId,
      approvalId: approval.id,
      bindingId: input.bindingId,
      deviceId: input.deviceId,
      accountId: approval.accountId,
      platform: input.platform,
      targetAppPackage: appPackages[input.platform],
      contentIdentityId: identity.id,
      sliceId: asset.id,
      media: {
        url: input.mediaUrl,
        sha256: asset.sha256,
        expiresAt: input.mediaExpiresAt,
      },
      captionText: input.captionText,
      destinationVersionId: destination.id,
      shortLinkUrl: destination.url,
      scheduledAt: schedule.scheduledFor,
      expiresAt: schedule.expiresAt,
      timeZone: schedule.businessTimezone,
      steps: [],
      taskTimeoutMs: input.taskTimeoutMs,
    },
  };
}
