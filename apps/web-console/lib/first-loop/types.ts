export type ProjectStatus = 'draft' | 'active' | 'exited';
export type AllocationStatus = 'unallocated' | 'reserved' | 'assigned_locked';
export type PublishStatus =
  | 'not_submitted'
  | 'in_progress'
  | 'unknown'
  | 'confirmed_not_published'
  | 'published';

export interface Project {
  id: string;
  name: string;
  clientId?: string;
  primaryGoal?: string;
  audience?: string;
  startsAt?: string;
  endsAt?: string;
  ownerId?: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectGap {
  field: 'clientId' | 'primaryGoal' | 'audience' | 'ownerId';
  message: string;
  blocks: 'strategy' | 'approval' | 'execution';
}

export interface AccountServiceRelation {
  id: string;
  accountId: string;
  projectId: string;
  clientId: string;
  ownerPartyId: string;
  authorizerPartyId: string;
  authorizationRef: string;
  allowedActions: string[];
  allowedData: string[];
  validFrom: string;
  validUntil?: string;
  sharedApprovalRef?: string;
  revokedAt?: string;
  createdAt: string;
}

export interface ContentIdentity {
  id: string;
  title: string;
  sourceRef: string;
  storySummary: string;
  allocationStatus: AllocationStatus;
  assignedAccountId?: string;
  allocationVersion: number;
  firstPublishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SliceAsset {
  id: string;
  contentIdentityId: string;
  language: string;
  variant: 'subtitle' | 'voiceover' | 'cover' | 'master';
  fileRef: string;
  sha256: string;
  rightsRef: string;
  rightsValidUntil?: string;
  destinationFit: 'eligible' | 'ineligible' | 'pending_review';
  overlapReview?: {
    relatedContentIdentityId: string;
    rangeDescription: string;
    decision: 'distinct_main_story' | 'same_identity' | 'pending';
    evidenceRef: string;
    reviewedBy: string;
  };
  createdAt: string;
}

export interface PublicationAttempt {
  id: string;
  contentIdentityId: string;
  sliceId: string;
  accountId: string;
  publishStatus: PublishStatus;
  evidenceRefs: string[];
  createdAt: string;
  updatedAt: string;
}

export type DestinationScope = 'content' | 'channel';
export type DestinationHealth =
  | 'available'
  | 'service_failure'
  | 'destination_invalid'
  | 'platform_restricted';

export interface DestinationVersion {
  id: string;
  destinationEntryId: string;
  url: string;
  health: DestinationHealth;
  isActive: boolean;
  changeReason: string;
  supersedesVersionId?: string;
  createdAt: string;
}

export interface DestinationEntry {
  id: string;
  projectId: string;
  accountId: string;
  scope: DestinationScope;
  scopeId: string;
  maintenancePermissionRef: string;
  sharedAttribution: boolean;
  exitPolicy: 'continue' | 'disable';
  activeVersionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface DestinationEvent {
  id: string;
  destinationEntryId: string;
  destinationVersionId: string;
  eventType: 'raw_visit' | 'filtered_click' | 'redirect_response';
  observedAt: string;
  responseStatus?: number;
  reasonCode: string;
  correlationId: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  correlationId: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  result: 'accepted' | 'rejected';
  reasonCode: string;
  facts: Record<string, string | number | boolean | null>;
  evidenceRefs: string[];
}

export interface FirstLoopState {
  projects: Project[];
  accountServiceRelations: AccountServiceRelation[];
  contentIdentities: ContentIdentity[];
  sliceAssets: SliceAsset[];
  publicationAttempts: PublicationAttempt[];
  destinationEntries: DestinationEntry[];
  destinationVersions: DestinationVersion[];
  destinationEvents: DestinationEvent[];
  auditLogs: AuditLogEntry[];
}

export interface CommandContext {
  actorId: string;
  correlationId: string;
  evidenceRefs?: string[];
}

export interface CommandResult<T> {
  ok: boolean;
  value?: T;
  error?: {
    code: string;
    message: string;
  };
}
