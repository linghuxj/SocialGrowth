'use client';

import React, { useState } from 'react';
import { DatabaseProvider, useDatabase } from '@/lib/db';
import { OverviewView } from '@/components/views/overview-view';
import { MatrixView } from '@/components/views/matrix-view';
import { ClipsView } from '@/components/views/clips-view';
import { StrategyView } from '@/components/views/strategy-view';
import { ShortlinksView } from '@/components/views/shortlinks-view';
import { RiskView } from '@/components/views/risk-view';
import { ArtemisView } from '@/components/views/artemis-view';
import { ExperimentsView } from '@/components/views/experiments-view';
import { DatabaseView } from '@/components/views/database-view';
import { ResearchView } from '@/components/views/research-view';
import { FirstLoopView } from '@/components/views/first-loop-view';
import { FirstLoopProvider } from '@/lib/first-loop/context';
import {
  LayoutDashboard,
  Smartphone,
  Lock,
  Sliders,
  Link2,
  ShieldAlert,
  Cpu,
  GitCompare,
  FileText,
  CheckCircle2,
  Menu,
  X,
  Database,
  Download,
  AlertTriangle,
  Info,
  Check,
  Workflow
} from 'lucide-react';

export type NavTab =
  | 'overview'
  | 'first-loop'
  | 'matrix'
  | 'clips'
  | 'strategy'
  | 'shortlinks'
  | 'risk'
  | 'artemis'
  | 'experiments'
  | 'database'
  | 'research';

function ConsoleContent() {
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const {
    reviews,
    hitl2FaEvents,
    devices,
    clips,
    notification,
    clearNotification,
    exportCurrentDatabaseJson
  } = useDatabase();

  // Dynamic Badges & Action Counters
  const pendingReviewsCount = reviews.filter(r => r.status === 'pending').length;
  const waiting2FaCount = hitl2FaEvents.filter(e => e.status === 'waiting_operator').length;
  const warningDevicesCount = devices.filter(d => d.health === 'warning').length;
  const lockedClipsCount = clips.filter(c => c.lockStatus === 'assigned_locked' || c.lockedAt).length;

  const navItems: {
    id: NavTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string;
    badgeColor?: string;
    alertDot?: boolean;
  }[] = [
    { id: 'overview', label: '3个月成果总览', icon: LayoutDashboard },
    { id: 'first-loop', label: '首条业务闭环', icon: Workflow, badge: 'PG-01~10' },
    {
      id: 'matrix',
      label: '1. 账号与真机拓扑',
      icon: Smartphone,
      badge: `${devices.length}台/40号`
    },
    {
      id: 'clips',
      label: '2. 切片素材独占锁',
      icon: Lock,
      badge: `${clips.length}条`
    },
    {
      id: 'strategy',
      label: '3. 策略与规则引擎',
      icon: Sliders,
      badge: pendingReviewsCount > 0 ? `${pendingReviewsCount}条演示待审` : '旧演示',
      alertDot: pendingReviewsCount > 0
    },
    {
      id: 'shortlinks',
      label: '4. 导流短链与防封',
      icon: Link2,
      badge: '待真实入口验收'
    },
    {
      id: 'risk',
      label: '5. 风控与冷备换号',
      icon: ShieldAlert,
      badge: waiting2FaCount > 0 ? `${waiting2FaCount}条演示待办` : '旧演示',
      alertDot: waiting2FaCount > 0
    },
    {
      id: 'artemis',
      label: '6. Artemis真机群控',
      icon: Cpu,
      badge: `${devices.length}条演示记录`,
      alertDot: warningDevicesCount > 0
    },
    {
      id: 'experiments',
      label: '7. A/B策略优化屏',
      icon: GitCompare,
      badge: '受控数据'
    },
    {
      id: 'database',
      label: '8. 数据库与持久化',
      icon: Database,
      badge: '本地演示'
    },
    {
      id: 'research',
      label: '归档：政策与测算',
      icon: FileText
    }
  ];

  const handleDownloadSnapshot = () => {
    const jsonStr = exportCurrentDatabaseJson();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `database_snapshot_${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col text-slate-900 font-sans">
      {/* Global Topbar Header */}
      <header className="bg-slate-950 text-white border-b border-slate-800 px-4 lg:px-6 py-2.5 sticky top-0 z-40 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="lg:hidden p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-white"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-blue-600 flex items-center justify-center font-bold text-white text-xs font-mono">
              SG
            </div>
            <div>
              <span className="font-bold text-sm tracking-tight text-white block leading-tight">
                SocialGrowth Web 运营平台
              </span>
              <span className="text-[10px] text-slate-400 font-mono block leading-none">
                首批业务闭环 · 受控工作台（外部接入证据单列）
              </span>
            </div>
          </div>
        </div>

        {/* Global Live System Telemetry Bar */}
        <div className="hidden xl:flex items-center gap-2.5 text-xs font-mono">
          <div className="flex items-center gap-1.5 bg-slate-900 px-2.5 py-1 rounded border border-slate-800">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-slate-400 text-[11px]">旧设备演示记录:</span>
            <strong className="text-amber-400">{devices.length} 条，未核验在线</strong>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-900 px-2.5 py-1 rounded border border-slate-800">
            <span className="text-slate-400 text-[11px]">旧演示排他锁:</span>
            <strong className="text-amber-400">{lockedClipsCount} 条独占锁定</strong>
          </div>

          {/* Action Notification Badges */}
          {pendingReviewsCount > 0 && (
            <button
              type="button"
              onClick={() => setActiveTab('strategy')}
              className="flex items-center gap-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 px-2 py-1 rounded text-xs transition-colors"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span>待审策略: {pendingReviewsCount} 条</span>
            </button>
          )}

          {waiting2FaCount > 0 && (
            <button
              type="button"
              onClick={() => setActiveTab('risk')}
              className="flex items-center gap-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 px-2 py-1 rounded text-xs transition-colors animate-pulse"
            >
              <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
              <span>2FA 拦截: {waiting2FaCount} 台</span>
            </button>
          )}
        </div>

        {/* Header Right Action Area */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadSnapshot}
            title="导出当前已修改的数据库快照为 database.json"
            className="flex items-center gap-1.5 px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white font-medium rounded shadow-xs transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">导出最新 database.json</span>
            <span className="sm:hidden font-mono">导出快照</span>
          </button>
        </div>
      </header>

      {/* Floating Real-time Toast Notifications */}
      {notification && (
        <div className="fixed top-14 right-4 z-50 max-w-sm pointer-events-none">
          <div
            className={`pointer-events-auto p-3.5 rounded-lg shadow-xl border text-xs flex items-start gap-2.5 transition-all bg-white ${
              notification.type === 'success'
                ? 'border-emerald-400 text-slate-800 ring-1 ring-emerald-200'
                : notification.type === 'error'
                ? 'border-rose-400 text-slate-800 ring-1 ring-rose-200'
                : notification.type === 'warning'
                ? 'border-amber-400 text-slate-800 ring-1 ring-amber-200'
                : 'border-blue-400 text-slate-800 ring-1 ring-blue-200'
            }`}
          >
            {notification.type === 'success' && <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />}
            {notification.type === 'error' && <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />}
            {notification.type === 'warning' && <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />}
            {notification.type === 'info' && <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />}

            <div className="flex-1">
              <span className="font-semibold block">{notification.message}</span>
              <span className="text-[10px] text-slate-400 font-mono">{notification.timestamp}</span>
            </div>

            <button
              type="button"
              onClick={clearNotification}
              className="text-slate-400 hover:text-slate-600 shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Main Layout Container */}
      <div className="flex-1 flex flex-col lg:flex-row max-w-[1600px] w-full mx-auto p-3 lg:p-6 gap-6">
        {/* Left Sidebar Navigation */}
        <aside
          className={`${
            mobileMenuOpen ? 'block' : 'hidden'
          } lg:block w-full lg:w-64 shrink-0 bg-white border border-slate-200 rounded-lg p-3 shadow-xs self-start sticky top-18`}
        >
          <div className="px-2 py-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            运营工作台导航
          </div>

          <nav className="space-y-1">
            {navItems.map(item => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-600 text-white font-semibold shadow-xs'
                      : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-500'}`} />
                    <span className="truncate">{item.label}</span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {item.alertDot && (
                      <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                    )}
                    {item.badge && (
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                          isActive
                            ? 'bg-blue-700 text-blue-100'
                            : 'bg-slate-100 text-slate-600 border border-slate-200'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </nav>

          {/* Bottom Compliance Reminder */}
          <div className="mt-6 pt-4 border-t border-slate-100 text-[11px] text-slate-400 px-2 space-y-1 font-mono">
            <div className="flex items-center gap-1 text-slate-600 font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              <span>CLAUDE.md 合规准则</span>
            </div>
            <p className="text-[10px] text-slate-500 leading-normal">
              目标为纯真机与账号精确绑定；当前受控实现、生产接入与真实平台证据分别验收
            </p>
          </div>
        </aside>

        {/* Central Dynamic View Workspace */}
        <main className="flex-1 min-w-0 bg-white border border-slate-200 rounded-lg p-5 lg:p-7 shadow-xs">
          {activeTab === 'overview' && <OverviewView onNavigate={tab => setActiveTab(tab as NavTab)} />}
          {activeTab === 'first-loop' && <FirstLoopView />}
          {activeTab === 'matrix' && <MatrixView />}
          {activeTab === 'clips' && <ClipsView />}
          {activeTab === 'strategy' && <StrategyView />}
          {activeTab === 'shortlinks' && <ShortlinksView />}
          {activeTab === 'risk' && <RiskView />}
          {activeTab === 'artemis' && <ArtemisView />}
          {activeTab === 'experiments' && <ExperimentsView />}
          {activeTab === 'database' && <DatabaseView />}
          {activeTab === 'research' && <ResearchView />}
        </main>
      </div>
    </div>
  );
}

export default function ConsolePage() {
  return (
    <DatabaseProvider>
      <FirstLoopProvider>
        <ConsoleContent />
      </FirstLoopProvider>
    </DatabaseProvider>
  );
}
