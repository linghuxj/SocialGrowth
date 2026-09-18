export type PlatformType = 'facebook' | 'youtube' | 'instagram';

export type AccountStage = 'cold_start' | 'active_operation' | 'restricted' | 'replaced';

export type DeviceHealth = 'healthy' | 'warning' | 'critical';

export type LockStatus = 'unallocated' | 'assigned_locked' | 'published';

export type RuleNature = 'constraint' | 'heuristic';

export type RuleStatus = 'verified_effective' | 'verifying' | 'unverified' | 'deprecated';

export type AnomalyType = 'account_restriction' | 'algorithmic_throttle' | 'traffic_drop' | 'task_timeout';

export interface DeviceEntity {
  id: string;
  model: string;
  serial: string;
  carrier?: string;
  batteryLevel: number;
  temperatureC: number;
  networkLatencyMs: number;
  health: DeviceHealth;
  location: string;
  assignedFbAccountId: string;
  assignedYtAccountId: string;
  currentTask?: {
    platform: PlatformType;
    action: string;
    step: string;
    elapsedSeconds: number;
  };
}

export interface AccountEntity {
  id: string;
  platform: PlatformType;
  name: string;
  handle: string;
  boundDeviceId: string;
  followers: number;
  stage: AccountStage;
  autoPilotEnabled: boolean;
  publishedCount: number;
  totalViews: number;
  lastActiveAt: string;
  isColdSpare?: boolean;
}

export interface ClipAssetEntity {
  id: string;
  title: string;
  series: string;
  episode: number;
  durationSeconds: number;
  aspectRatio: '9:16' | '16:9';
  tags: string[];
  lockStatus: LockStatus;
  exclusiveAccountId?: string;
  lockedAt?: string;
  publishedAt?: string;
  coverUrl: string;
}

export interface ClipVaultStats {
  totalClipsInVault: number;
  assignedLockedCount: number;
  publishedCount: number;
  unallocatedCount: number;
  duplicateAttemptInterceptions: number;
  exclusiveLockEnforcementRate: number;
}

export interface StrategyRuleEntity {
  id: string;
  version: string;
  title: string;
  nature: RuleNature;
  targetPlatforms: PlatformType[];
  applicableStage: 'cold_start' | 'active_operation' | 'all';
  triggerCondition: string;
  actionInstruction: string;
  status: RuleStatus;
  conflictCheckPassed: boolean;
  updatedAt: string;
}

export interface StrategyReviewItem {
  id: string;
  accountId: string;
  accountName: string;
  platform: PlatformType;
  postTime: string;
  clipTitle: string;
  copywriting: string;
  shortlinkType: 'post_direct' | 'bio_channel';
  referencedRuleIds: string[];
  aiReasoning: string;
  status: 'pending' | 'approved' | 'rejected';
}

export interface StrategyStats {
  totalRulesCount: number;
  constraintRulesCount: number;
  heuristicRulesCount: number;
  verifiedRulesCount: number;
  verifyingRulesCount: number;
  activeAccountsCount: number;
  autoPilotAccountsCount: number;
  manualReviewAccountsCount: number;
  pendingReviewCount: number;
  approvedTodayCount: number;
}

export interface ShortlinkEntity {
  id: string;
  slug: string;
  fullShortUrl: string;
  destinationUrl: string;
  platform: PlatformType;
  accountId: string;
  rawClicks: number;
  filteredClicks: number;
  successfulRedirects: number;
  status: 'active' | 'rotated' | 'paused';
  createdAt: string;
}

export interface DomainHealthEntity {
  domain: string;
  role: 'primary' | 'standby' | 'quarantined';
  healthScore: number;
  interceptRate: number;
  status: 'healthy' | 'warning' | 'blocked';
  lastCheckedAt: string;
}

export interface ShortlinkStats {
  totalLinksCount: number;
  rawClicksTotal: number;
  crawlerFilteredTotal: number;
  cleanClicksTotal: number;
  redirectsSuccessfulTotal: number;
  redirectSuccessRate: number;
  platformDistribution: {
    facebookClicks: number;
    youtubeClicks: number;
  };
  domainFailoversCompleted: number;
}

export interface AnomalyRecordEntity {
  id: string;
  deviceId: string;
  accountId: string;
  platform: PlatformType;
  type: AnomalyType;
  severity: 'high' | 'medium' | 'low';
  detectedAt: string;
  details: string;
  resolutionStatus: 'auto_healed' | 'pending_hitl' | 'resolved';
  resolutionAction?: string;
}

export interface ColdSpareReplacementOrder {
  orderId: string;
  deviceId: string;
  failedAccountId: string;
  newAccountId: string;
  platform: PlatformType;
  triggeredAt: string;
  steps: {
    name: string;
    status: 'completed' | 'in_progress' | 'pending';
    timestamp?: string;
  }[];
  isComplete: boolean;
}

export interface Hitl2FaEvent {
  id: string;
  deviceId: string;
  accountId: string;
  platform: PlatformType;
  requestedAt: string;
  codeReceived?: string;
  status: 'waiting_operator' | 'verified' | 'expired';
}

export interface AbExperimentEntity {
  experimentId: string;
  name: string;
  hypothesis: string;
  status: 'running' | 'promoted' | 'rolled_back';
  startDate: string;
  observationDays: number;
  baselineGroup: {
    accountCount: number;
    avgCompletionRate: number;
    avgEngagementRate: number;
    compositeScore: number;
  };
  experimentGroup: {
    accountCount: number;
    avgCompletionRate: number;
    avgEngagementRate: number;
    compositeScore: number;
  };
  scoreLiftPercent: number;
  dualTrackSource: {
    officialApiPercentage: number;
    thirdPartyFallbackPercentage: number;
  };
  conclusion: string;
}

export interface DualTrackStats {
  officialApiShare: number;
  thirdPartyFallbackShare: number;
  primaryDataSources: string[];
  fallbackDataSources: string[];
  evaluationModel: string;
  formulaPrivate: string;
  formulaFallback: string;
}

export interface ThreeMonthSummary {
  period: string;
  totalDevices: number;
  activeAccounts: number;
  fbAccounts: number;
  ytAccounts: number;
  insReservedSlots: number;
  totalPlannedPosts: number;
  effectivePostsRealized: number;
  realizationRate: number;
  exclusiveClipsCount: number;
  duplicateLeakageCount: number;
  totalViewsAggregate: number;
  totalClicksRaw: number;
  totalClicksClean: number;
  totalRedirects: number;
  autoPilotAccountShare: number;
  totalAnomaliesHandled: number;
  coldSpareReplacementsCompleted: number;
  abExperimentsPromoted: number;
  abExperimentsRolledBack: number;
}

export interface DatabaseSchema {
  summary: ThreeMonthSummary;
  devices: DeviceEntity[];
  accounts: AccountEntity[];
  coldSparePool: AccountEntity[];
  clips: ClipAssetEntity[];
  clipVaultStats: ClipVaultStats;
  rules: StrategyRuleEntity[];
  reviews: StrategyReviewItem[];
  strategyStats: StrategyStats;
  shortlinks: ShortlinkEntity[];
  domainPool: DomainHealthEntity[];
  shortlinkStats: ShortlinkStats;
  anomalies: AnomalyRecordEntity[];
  replacementOrders: ColdSpareReplacementOrder[];
  hitl2FaEvents: Hitl2FaEvent[];
  experiments: AbExperimentEntity[];
  dualTrackStats: DualTrackStats;
}

export interface SystemNotification {
  id: string;
  message: string;
  type: 'success' | 'info' | 'warning' | 'error';
  timestamp: string;
}

