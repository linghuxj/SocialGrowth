'use client';

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
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
  SystemNotification,
  PlatformType
} from './types';

interface DatabaseContextValue {
  // Collections
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
  summary: ThreeMonthSummary;

  // Pending and Alert Counters
  pendingReviewCount: number;
  pending2FaCount: number;
  warningDeviceCount: number;
  pendingAnomalyCount: number;

  // Mutation Actions
  approveReview: (id: string) => void;
  rejectReview: (id: string, reason?: string) => void;
  approveAllReviews: () => void;
  updateReviewCopywriting: (id: string, newText: string) => void;
  addStrategyRule: (rule: StrategyRuleEntity) => void;
  assignClipExclusiveLock: (clipId: string, targetAccountId: string) => void;
  createShortlink: (data: {
    slug: string;
    fullShortUrl: string;
    destinationUrl: string;
    platform: PlatformType;
    accountId: string;
  }) => void;
  toggleDomainStatus: (domain: string, action: 'quarantine' | 'restore' | 'set_primary') => void;
  submit2FaVerification: (eventId: string, code: string) => void;
  resolveAnomalyEvent: (anomalyId: string, resolutionAction: string) => void;
  toggleAccountAutoPilot: (accountId: string) => void;
  rebindColdSpareAccount: (deviceId: string, spareAccountId: string, failedAccountId: string) => void;
  triggerArtemisSelfHeal: (deviceId: string) => void;
  triggerArtemisPing: (deviceId: string) => void;
  exportCurrentDatabaseJson: () => string;

  // Toast / System Notifications
  notification: SystemNotification | null;
  notify: (message: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
  clearNotification: () => void;
}

const DatabaseContext = createContext<DatabaseContextValue | null>(null);

const initialData = databaseJson as unknown as DatabaseSchema;

export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<DatabaseSchema>(initialData);
  const [notification, setNotification] = useState<SystemNotification | null>(null);

  const notify = useCallback((message: string, type: 'success' | 'info' | 'warning' | 'error' = 'info') => {
    const id = `notif-${Date.now()}`;
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    setNotification({ id, message, type, timestamp });
  }, []);

  const clearNotification = useCallback(() => {
    setNotification(null);
  }, []);

  // Operational Mutations
  const approveReview = useCallback((id: string) => {
    setData(prev => {
      const target = prev.reviews.find(r => r.id === id);
      if (!target) return prev;
      const updatedReviews = prev.reviews.map(r =>
        r.id === id ? { ...r, status: 'approved' as const } : r
      );
      return {
        ...prev,
        reviews: updatedReviews,
        strategyStats: {
          ...prev.strategyStats,
          approvedTodayCount: prev.strategyStats.approvedTodayCount + 1,
          pendingReviewCount: Math.max(0, prev.strategyStats.pendingReviewCount - 1)
        }
      };
    });
    notify(`策略审核项 ${id} 已审核通过，任务下发至真机排期调度队列。`, 'success');
  }, [notify]);

  const rejectReview = useCallback((id: string, reason?: string) => {
    setData(prev => ({
      ...prev,
      reviews: prev.reviews.map(r =>
        r.id === id
          ? {
              ...r,
              status: 'rejected' as const,
              aiReasoning: reason ? `驳回说明: ${reason} (原逻辑: ${r.aiReasoning})` : r.aiReasoning
            }
          : r
      ),
      strategyStats: {
        ...prev.strategyStats,
        pendingReviewCount: Math.max(0, prev.strategyStats.pendingReviewCount - 1)
      }
    }));
    notify(`策略审核项 ${id} 已驳回并要求重拟。`, 'warning');
  }, [notify]);

  const approveAllReviews = useCallback(() => {
    let approvedCount = 0;
    setData(prev => {
      const updatedReviews = prev.reviews.map(r => {
        if (r.status === 'pending') {
          approvedCount++;
          return { ...r, status: 'approved' as const };
        }
        return r;
      });
      return {
        ...prev,
        reviews: updatedReviews,
        strategyStats: {
          ...prev.strategyStats,
          approvedTodayCount: prev.strategyStats.approvedTodayCount + approvedCount,
          pendingReviewCount: 0
        }
      };
    });
    notify(`已一键批量通过全部待审策略任务 (${approvedCount} 项)，已下发至真机。`, 'success');
  }, [notify]);

  const updateReviewCopywriting = useCallback((id: string, newText: string) => {
    setData(prev => ({
      ...prev,
      reviews: prev.reviews.map(r =>
        r.id === id ? { ...r, copywriting: newText } : r
      )
    }));
    notify(`审核项 ${id} 文案已在线校准更新。`, 'info');
  }, [notify]);

  const addStrategyRule = useCallback((rule: StrategyRuleEntity) => {
    setData(prev => ({
      ...prev,
      rules: [rule, ...prev.rules],
      strategyStats: {
        ...prev.strategyStats,
        totalRulesCount: prev.strategyStats.totalRulesCount + 1,
        constraintRulesCount: rule.nature === 'constraint' ? prev.strategyStats.constraintRulesCount + 1 : prev.strategyStats.constraintRulesCount,
        heuristicRulesCount: rule.nature === 'heuristic' ? prev.strategyStats.heuristicRulesCount + 1 : prev.strategyStats.heuristicRulesCount
      }
    }));
    notify(`新运营规则 ${rule.id} 已录入经验规则库并生效。`, 'success');
  }, [notify]);

  const assignClipExclusiveLock = useCallback((clipId: string, targetAccountId: string) => {
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    setData(prev => ({
      ...prev,
      clips: prev.clips.map(c =>
        c.id === clipId
          ? {
              ...c,
              lockStatus: 'assigned_locked' as const,
              exclusiveAccountId: targetAccountId,
              lockedAt: now
            }
          : c
      ),
      clipVaultStats: {
        ...prev.clipVaultStats,
        assignedLockedCount: prev.clipVaultStats.assignedLockedCount + 1,
        unallocatedCount: Math.max(0, prev.clipVaultStats.unallocatedCount - 1)
      }
    }));
    notify(`素材切片 ${clipId} 已加注排他独占锁，唯一绑定目标账号 ${targetAccountId}。`, 'success');
  }, [notify]);

  const createShortlink = useCallback((linkData: {
    slug: string;
    fullShortUrl: string;
    destinationUrl: string;
    platform: PlatformType;
    accountId: string;
  }) => {
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const newLink: ShortlinkEntity = {
      id: `link-${Date.now().toString().slice(-4)}`,
      slug: linkData.slug,
      fullShortUrl: linkData.fullShortUrl,
      destinationUrl: linkData.destinationUrl,
      platform: linkData.platform,
      accountId: linkData.accountId,
      rawClicks: 0,
      filteredClicks: 0,
      successfulRedirects: 0,
      status: 'active',
      createdAt: now
    };
    setData(prev => ({
      ...prev,
      shortlinks: [newLink, ...prev.shortlinks],
      shortlinkStats: {
        ...prev.shortlinkStats,
        totalLinksCount: prev.shortlinkStats.totalLinksCount + 1
      }
    }));
    notify(`新导流短链 ${newLink.fullShortUrl} 创建就绪，已关联账号 ${newLink.accountId}。`, 'success');
  }, [notify]);

  const toggleDomainStatus = useCallback((domain: string, action: 'quarantine' | 'restore' | 'set_primary') => {
    setData(prev => ({
      ...prev,
      domainPool: prev.domainPool.map(d => {
        if (d.domain !== domain) {
          if (action === 'set_primary' && d.role === 'primary') {
            return { ...d, role: 'standby' as const };
          }
          return d;
        }
        if (action === 'quarantine') {
          return { ...d, role: 'quarantined' as const, status: 'blocked' as const };
        }
        if (action === 'restore') {
          return { ...d, role: 'standby' as const, status: 'healthy' as const };
        }
        if (action === 'set_primary') {
          return { ...d, role: 'primary' as const, status: 'healthy' as const };
        }
        return d;
      })
    }));
    notify(`域名 ${domain} 拓扑角色已调整为: ${action}。`, 'info');
  }, [notify]);

  const submit2FaVerification = useCallback((eventId: string, code: string) => {
    setData(prev => ({
      ...prev,
      hitl2FaEvents: prev.hitl2FaEvents.map(e =>
        e.id === eventId
          ? { ...e, codeReceived: code, status: 'verified' as const }
          : e
      )
    }));
    notify(`2FA 动态码 [${code}] 已注入目标真机，协同接管验证成功！`, 'success');
  }, [notify]);

  const resolveAnomalyEvent = useCallback((anomalyId: string, resolutionAction: string) => {
    setData(prev => ({
      ...prev,
      anomalies: prev.anomalies.map(a =>
        a.id === anomalyId
          ? { ...a, resolutionStatus: 'resolved' as const, resolutionAction }
          : a
      )
    }));
    notify(`风控事件 ${anomalyId} 已处置完毕并归档沉淀。`, 'success');
  }, [notify]);

  const toggleAccountAutoPilot = useCallback((accountId: string) => {
    setData(prev => {
      const target = prev.accounts.find(a => a.id === accountId);
      const nextState = !target?.autoPilotEnabled;
      return {
        ...prev,
        accounts: prev.accounts.map(a =>
          a.id === accountId ? { ...a, autoPilotEnabled: nextState } : a
        ),
        strategyStats: {
          ...prev.strategyStats,
          autoPilotAccountsCount: nextState
            ? prev.strategyStats.autoPilotAccountsCount + 1
            : prev.strategyStats.autoPilotAccountsCount - 1,
          manualReviewAccountsCount: nextState
            ? prev.strategyStats.manualReviewAccountsCount - 1
            : prev.strategyStats.manualReviewAccountsCount + 1
        }
      };
    });
    notify(`账号 ${accountId} 自主托管 (Auto-Pilot) 模式已切换。`, 'info');
  }, [notify]);

  const rebindColdSpareAccount = useCallback((deviceId: string, spareAccountId: string, failedAccountId: string) => {
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    setData(prev => {
      const spare = prev.coldSparePool.find(s => s.id === spareAccountId);
      if (!spare) return prev;

      // Update accounts and device binding
      const updatedAccounts = prev.accounts.map(a => {
        if (a.id === failedAccountId) {
          return { ...a, stage: 'replaced' as const, boundDeviceId: 'unassigned' };
        }
        return a;
      });

      // Insert new active account
      const activatedAccount: AccountEntity = {
        ...spare,
        stage: 'active_operation',
        boundDeviceId: deviceId,
        isColdSpare: false
      };

      const updatedDevices = prev.devices.map(d => {
        if (d.id === deviceId) {
          return spare.platform === 'facebook'
            ? { ...d, assignedFbAccountId: activatedAccount.id, health: 'healthy' as const }
            : { ...d, assignedYtAccountId: activatedAccount.id, health: 'healthy' as const };
        }
        return d;
      });

      const updatedSparePool = prev.coldSparePool.filter(s => s.id !== spareAccountId);

      const newOrder: ColdSpareReplacementOrder = {
        orderId: `SOP-${Date.now().toString().slice(-6)}`,
        deviceId,
        failedAccountId,
        newAccountId: activatedAccount.id,
        platform: spare.platform,
        triggeredAt: now,
        steps: [
          { name: '自动熔断：暂停该平台排期', status: 'completed', timestamp: '00:01' },
          { name: `冷备提取：锁定 ${spareAccountId}`, status: 'completed', timestamp: '00:03' },
          { name: '环境重置：执行 pm clear 清理缓存', status: 'completed', timestamp: '00:45' },
          { name: '登录新号：注入安全凭证', status: 'completed', timestamp: '01:20' },
          { name: '拓扑绑定：1:1 映射重构并重启排期', status: 'completed', timestamp: '01:50' }
        ],
        isComplete: true
      };

      return {
        ...prev,
        devices: updatedDevices,
        accounts: [...updatedAccounts, activatedAccount],
        coldSparePool: updatedSparePool,
        replacementOrders: [newOrder, ...prev.replacementOrders],
        summary: {
          ...prev.summary,
          coldSpareReplacementsCompleted: prev.summary.coldSpareReplacementsCompleted + 1
        }
      };
    });
    notify(`设备 ${deviceId} 冷备换号置换成功！新号 ${spareAccountId} 已专属绑定上线。`, 'success');
  }, [notify]);

  const triggerArtemisPing = useCallback((deviceId: string) => {
    setData(prev => ({
      ...prev,
      devices: prev.devices.map(d =>
        d.id === deviceId ? { ...d, health: 'healthy' as const, networkLatencyMs: Math.max(35, d.networkLatencyMs - 5) } : d
      )
    }));
    notify(`Artemis 真机 ${deviceId} 物理巡检心跳回执正常 (RTT: 42ms，ADB TCP: OK)。`, 'success');
  }, [notify]);

  const triggerArtemisSelfHeal = useCallback((deviceId: string) => {
    setData(prev => ({
      ...prev,
      devices: prev.devices.map(d =>
        d.id === deviceId
          ? {
              ...d,
              health: 'healthy' as const,
              currentTask: undefined
            }
          : d
      )
    }));
    notify(`真机 ${deviceId} 看门狗超时自愈执行完毕：am force-stop + input keyevent HOME 已生效。`, 'success');
  }, [notify]);

  const exportCurrentDatabaseJson = useCallback((): string => {
    const jsonStr = JSON.stringify(data, null, 2);
    // Create download blob in browser
    if (typeof window !== 'undefined') {
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `database_export_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    notify('当前最新数据库全量快照 (database.json) 已成功导出！', 'success');
    return jsonStr;
  }, [data, notify]);

  // Derived metrics
  const pendingReviewCount = useMemo(
    () => data.reviews.filter(r => r.status === 'pending').length,
    [data.reviews]
  );

  const pending2FaCount = useMemo(
    () => data.hitl2FaEvents.filter(e => e.status === 'waiting_operator').length,
    [data.hitl2FaEvents]
  );

  const warningDeviceCount = useMemo(
    () => data.devices.filter(d => d.health === 'warning' || d.health === 'critical').length,
    [data.devices]
  );

  const pendingAnomalyCount = useMemo(
    () => data.anomalies.filter(a => a.resolutionStatus !== 'resolved').length,
    [data.anomalies]
  );

  const contextValue = useMemo(
    () => ({
      devices: data.devices,
      accounts: data.accounts,
      coldSparePool: data.coldSparePool,
      clips: data.clips,
      clipVaultStats: data.clipVaultStats,
      rules: data.rules,
      reviews: data.reviews,
      strategyStats: data.strategyStats,
      shortlinks: data.shortlinks,
      domainPool: data.domainPool,
      shortlinkStats: data.shortlinkStats,
      anomalies: data.anomalies,
      replacementOrders: data.replacementOrders,
      hitl2FaEvents: data.hitl2FaEvents,
      experiments: data.experiments,
      dualTrackStats: data.dualTrackStats,
      summary: data.summary,
      pendingReviewCount,
      pending2FaCount,
      warningDeviceCount,
      pendingAnomalyCount,
      approveReview,
      rejectReview,
      approveAllReviews,
      updateReviewCopywriting,
      addStrategyRule,
      assignClipExclusiveLock,
      createShortlink,
      toggleDomainStatus,
      submit2FaVerification,
      resolveAnomalyEvent,
      toggleAccountAutoPilot,
      rebindColdSpareAccount,
      triggerArtemisSelfHeal,
      triggerArtemisPing,
      exportCurrentDatabaseJson,
      notification,
      notify,
      clearNotification
    }),
    [
      data,
      pendingReviewCount,
      pending2FaCount,
      warningDeviceCount,
      pendingAnomalyCount,
      approveReview,
      rejectReview,
      approveAllReviews,
      updateReviewCopywriting,
      addStrategyRule,
      assignClipExclusiveLock,
      createShortlink,
      toggleDomainStatus,
      submit2FaVerification,
      resolveAnomalyEvent,
      toggleAccountAutoPilot,
      rebindColdSpareAccount,
      triggerArtemisSelfHeal,
      triggerArtemisPing,
      exportCurrentDatabaseJson,
      notification,
      notify,
      clearNotification
    ]
  );

  return (
    <DatabaseContext.Provider value={contextValue}>
      {children}
    </DatabaseContext.Provider>
  );
}

export function useDatabase(): DatabaseContextValue {
  const ctx = useContext(DatabaseContext);
  if (!ctx) {
    throw new Error('useDatabase must be used within a DatabaseProvider');
  }
  return ctx;
}
