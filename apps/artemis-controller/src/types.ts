/**
 * SocialGrowth Google Artemis 设备执行控制端类型定义
 */

export type PlatformType = 'facebook' | 'instagram' | 'youtube';

export type DeviceType = 'physical' | 'emulator';

export type DeviceStatus = 'idle' | 'busy' | 'offline' | 'error';

export interface DeviceInfo {
  deviceId: string;
  deviceType: DeviceType;
  model: string; // e.g., "Samsung Galaxy S23"
  platformBound: PlatformType[];
  boundAccounts: string[]; // 绑定的社媒账号 ID 清单
  status: DeviceStatus;
  batteryLevel?: number;
  lastHeartbeat: string;
}

export type TaskStatus = 'pending' | 'dispatched' | 'running' | 'completed' | 'failed' | 'paused';

export interface AutomationStep {
  stepIndex: number;
  action: 'open_app' | 'navigate' | 'click' | 'input_text' | 'select_media' | 'scroll' | 'wait';
  targetSelector?: string;
  coordinates?: { x: number; y: number };
  value?: string;
  timeoutMs?: number;
}

export interface PublishTaskDirective {
  taskId: string;
  strategyVersion: string;
  batchId: string;
  platform: PlatformType;
  accountId: string;
  targetAppPackage: string; // e.g. "com.facebook.katana", "com.instagram.android", "com.google.android.youtube"
  mediaAssetPath: string;
  captionText: string;
  shortLinkUrl: string;
  steps: AutomationStep[];
  deadline: string;
}

export interface ExecutionReceipt {
  taskId: string;
  deviceId: string;
  status: 'completed' | 'failed';
  startedAt: string;
  finishedAt: string;
  publishedUrl?: string;
  publishedPostId?: string;
  failureReason?: string;
  screenshotPaths: string[];
  selfHealingLogs: string[];
  logcatSnippet?: string;
}
