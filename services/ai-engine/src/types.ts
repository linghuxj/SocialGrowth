export type PlatformType = 'facebook' | 'instagram' | 'youtube';

export interface AccountProfile {
  accountId: string;
  platform: PlatformType;
  region: string;
  language: string;
  targetAudience: string[];
  verticals: string[];
}

export interface SliceMetadata {
  sliceId: string;
  dramaTitle: string;
  episode: number;
  durationSec: number;
  genres: string[]; // e.g. ["甜宠", "逆袭", "悬疑"]
  audienceTags: string[];
  language: string;
  highlightHook: string; // 核心爆点描述
}

export interface MatchScoreResult {
  sliceId: string;
  accountId: string;
  score: number; // 0 ~ 100
  factors: {
    genreMatch: number;
    audienceMatch: number;
    languageMatch: number;
  };
  recommended: boolean;
}

export type RuleNature = 'constraint' | 'suggestion';
export type RuleValidationStatus = 'unverified' | 'verifying' | 'verified_effective' | 'verified_ineffective';

export interface ExperienceRule {
  ruleId: string;
  version: number;
  rawText: string;
  structuredCondition: string;
  structuredAction: string;
  platforms: PlatformType[];
  targetStage: 'cold_start' | 'ongoing' | 'all';
  nature: RuleNature;
  status: RuleValidationStatus;
  conflictDetected: boolean;
  conflictDescription?: string;
  createdAt: string;
}

export interface GeneratedStrategy {
  strategyId: string;
  version: string;
  accountId: string;
  sliceId: string;
  postingCadence: string;
  captionTemplate: string;
  linkPlacementStrategy: string;
  interactionGuidance: string;
  referencedRuleVersions: string[];
  testHypothesis: string;
  requiresReview: boolean; // 是否需单人工作台审核（未托管或新起号）
}
