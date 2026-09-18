import databaseJson from '@/data/database.json';
import type {
  DatabaseSchema,
  DeviceEntity,
  AccountEntity,
  ClipAssetEntity,
  ClipVaultStats,
  StrategyRuleEntity,
  StrategyReviewItem,
  StrategyStats,
  ShortlinkEntity,
  DomainHealthEntity,
  ShortlinkStats,
  AnomalyRecordEntity,
  ColdSpareReplacementOrder,
  Hitl2FaEvent,
  AbExperimentEntity,
  DualTrackStats,
  ThreeMonthSummary,
  PlatformType,
  AccountStage,
  LockStatus,
  RuleNature,
  RuleStatus
} from './types';

// Cast imported JSON to full DatabaseSchema
export const dbData: DatabaseSchema = databaseJson as unknown as DatabaseSchema;

/**
 * 生产级数据库访问客户端 (Database Access Layer)
 * 直接读取与抽象持久化数据源 (data/database.json)，支持后续无缝替换为 PostgreSQL / SQLite 连接器。
 */
export const db = {
  devices: {
    findMany: (): DeviceEntity[] => dbData.devices,
    findById: (id: string): DeviceEntity | undefined => dbData.devices.find(d => d.id === id),
    count: (): number => dbData.devices.length,
  },
  accounts: {
    findMany: (filter?: { platform?: PlatformType; stage?: AccountStage }): AccountEntity[] => {
      let list = dbData.accounts;
      if (filter?.platform) list = list.filter(a => a.platform === filter.platform);
      if (filter?.stage) list = list.filter(a => a.stage === filter.stage);
      return list;
    },
    findById: (id: string): AccountEntity | undefined => dbData.accounts.find(a => a.id === id),
    findColdSpares: (): AccountEntity[] => dbData.coldSparePool,
    count: (): number => dbData.accounts.length,
  },
  clips: {
    findMany: (filter?: { lockStatus?: LockStatus; series?: string }): ClipAssetEntity[] => {
      let list = dbData.clips;
      if (filter?.lockStatus) list = list.filter(c => c.lockStatus === filter.lockStatus);
      if (filter?.series) list = list.filter(c => c.series === filter.series);
      return list;
    },
    findById: (id: string): ClipAssetEntity | undefined => dbData.clips.find(c => c.id === id),
    getVaultStats: (): ClipVaultStats => dbData.clipVaultStats,
  },
  rules: {
    findMany: (filter?: { nature?: RuleNature; status?: RuleStatus }): StrategyRuleEntity[] => {
      let list = dbData.rules;
      if (filter?.nature) list = list.filter(r => r.nature === filter.nature);
      if (filter?.status) list = list.filter(r => r.status === filter.status);
      return list;
    },
    findById: (id: string): StrategyRuleEntity | undefined => dbData.rules.find(r => r.id === id),
    getStats: (): StrategyStats => dbData.strategyStats,
  },
  reviews: {
    findMany: (): StrategyReviewItem[] => dbData.reviews,
    findById: (id: string): StrategyReviewItem | undefined => dbData.reviews.find(r => r.id === id),
  },
  shortlinks: {
    findMany: (): ShortlinkEntity[] => dbData.shortlinks,
    findById: (id: string): ShortlinkEntity | undefined => dbData.shortlinks.find(s => s.id === id),
    getDomainPool: (): DomainHealthEntity[] => dbData.domainPool,
    getStats: (): ShortlinkStats => dbData.shortlinkStats,
  },
  anomalies: {
    findMany: (): AnomalyRecordEntity[] => dbData.anomalies,
    getReplacementOrders: (): ColdSpareReplacementOrder[] => dbData.replacementOrders,
    getHitl2FaEvents: (): Hitl2FaEvent[] => dbData.hitl2FaEvents,
  },
  experiments: {
    findMany: (): AbExperimentEntity[] => dbData.experiments,
    getDualTrackStats: (): DualTrackStats => dbData.dualTrackStats,
  },
  summary: {
    get: (): ThreeMonthSummary => dbData.summary,
  }
};

// Ready-to-use exported data bindings
export const devices: DeviceEntity[] = dbData.devices;
export const accounts: AccountEntity[] = dbData.accounts;
export const coldSparePool: AccountEntity[] = dbData.coldSparePool;
export const clips: ClipAssetEntity[] = dbData.clips;
export const clipVaultStats: ClipVaultStats = dbData.clipVaultStats;
export const rules: StrategyRuleEntity[] = dbData.rules;
export const reviewQueue: StrategyReviewItem[] = dbData.reviews;
export const strategyStats: StrategyStats = dbData.strategyStats;
export const shortlinks: ShortlinkEntity[] = dbData.shortlinks;
export const domainPool: DomainHealthEntity[] = dbData.domainPool;
export const shortlinkStats: ShortlinkStats = dbData.shortlinkStats;
export const anomalies: AnomalyRecordEntity[] = dbData.anomalies;
export const replacementOrders: ColdSpareReplacementOrder[] = dbData.replacementOrders;
export const hitl2FaEvents: Hitl2FaEvent[] = dbData.hitl2FaEvents;
export const experiments: AbExperimentEntity[] = dbData.experiments;
export const dualTrackStats: DualTrackStats = dbData.dualTrackStats;
export const threeMonthSummary: ThreeMonthSummary = dbData.summary;
