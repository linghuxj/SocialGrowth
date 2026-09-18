export interface ShortLinkMetadata {
  linkId: string;
  code: string; // 唯一短码
  destinationUrl: string; // 甲方提供的目标入口或指定页面
  platform: 'facebook' | 'instagram' | 'youtube';
  accountId: string;
  sliceId?: string;
  strategyVersion?: string;
  batchId?: string;
  createdAt: string;
}

export interface AccessLogEvent {
  eventId: string;
  code: string;
  timestamp: string;
  ip: string;
  userAgent: string;
  referrer?: string;
  isBotOrCrawler: boolean;
  isValidClick: boolean;
  redirectStatus: number; // 通常为 302
}

export interface AttributionAggregation {
  code: string;
  rawVisits: number; // 原始访问量
  validClicks: number; // 按规则过滤后的有效点击量
  redirectSuccesses: number; // 成功跳转次数
}
