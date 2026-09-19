'use client';

import React, { useState } from 'react';
import {
  Activity,
  Archive,
  Boxes,
  ClipboardCheck,
  Download,
  FileClock,
  FolderKanban,
  Menu,
  Settings2,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  FirstLoopView,
  type OperationsSection,
} from '@/components/views/first-loop-view';
import { FirstLoopProvider, useFirstLoop } from '@/lib/first-loop/context';

const NAV: Array<{
  id: OperationsSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'overview', label: '运营总览', icon: Activity },
  { id: 'projects', label: '项目与授权', icon: FolderKanban },
  { id: 'content', label: '内容库存', icon: Boxes },
  { id: 'strategy', label: '入口与策略', icon: Settings2 },
  { id: 'execution', label: '批准与排期', icon: ShieldCheck },
  { id: 'review', label: '观察与复盘', icon: ClipboardCheck },
  { id: 'audit', label: '审计日志', icon: FileClock },
];

function ConsoleContent() {
  const { state, activeProjectId, selectProject } = useFirstLoop();
  const [section, setSection] = useState<OperationsSection>('overview');
  const [menuOpen, setMenuOpen] = useState(false);
  const activeProject = state.projects.find(
    (item) => item.id === activeProjectId,
  );
  const activeApprovals = state.executionApprovals.filter(
    (item) => item.status === 'active',
  ).length;
  const unresolvedAttempts = state.publicationAttempts.filter(
    (item) => item.publishStatus === 'unknown',
  ).length;

  const exportSnapshot = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `socialgrowth-first-loop-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950 text-white">
        <div className="mx-auto flex min-h-14 max-w-[1600px] items-center justify-between gap-3 px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label="打开导航"
              className="rounded-md p-2 text-slate-300 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-blue-400 lg:hidden"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </button>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-600 text-xs font-bold">
              SG
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">
                SocialGrowth 运营工作台
              </h1>
              <p className="truncate text-[11px] text-slate-400">
                首批业务闭环 · 本地受控数据
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-xs xl:flex">
            <span className="rounded border border-amber-700/70 bg-amber-950/50 px-2 py-1 text-amber-200">
              外部发布连接未配置
            </span>
            <span className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-300">
              有效批准 {activeApprovals}
            </span>
            <span className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-300">
              待核回执 {unresolvedAttempts}
            </span>
          </div>
          <button
            type="button"
            onClick={exportSnapshot}
            className="inline-flex h-8 items-center gap-2 rounded-md bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-blue-300"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">导出审计快照</span>
          </button>
        </div>
      </header>
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5 p-3 lg:flex-row lg:p-6">
        <aside
          className={`${menuOpen ? 'block' : 'hidden'} w-full shrink-0 self-start rounded-lg border border-slate-200 bg-white p-3 shadow-sm lg:sticky lg:top-20 lg:block lg:w-64`}
        >
          <label className="mb-3 block text-xs font-medium text-slate-700">
            当前项目
            <select
              aria-label="当前项目"
              className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              value={activeProjectId}
              onChange={(event) => selectProject(event.target.value)}
            >
              <option value="">全部项目 / 尚未选择</option>
              {state.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} · {project.status}
                </option>
              ))}
            </select>
          </label>
          <nav aria-label="运营工作台导航" className="space-y-1">
            {NAV.map((item) => {
              const Icon = item.icon;
              const selected = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSection(item.id);
                    setMenuOpen(false);
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-blue-500 ${selected ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>
          <div className="mt-5 border-t border-slate-200 pt-4 text-[11px] leading-5 text-slate-500">
            <div className="flex items-center gap-1.5 font-medium text-slate-700">
              <Archive className="h-3.5 w-3.5" />
              演示模块已下线
            </div>
            <p className="mt-1">
              页面只展示当前闭环状态；设备在线、平台发布和真实成效需由外部回执证明。
            </p>
          </div>
        </aside>
        <main className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:p-7">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-4">
            <div>
              <h2 className="text-lg font-semibold">
                {NAV.find((item) => item.id === section)?.label}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {activeProject
                  ? `当前范围：${activeProject.name}`
                  : '请选择项目，或先创建项目草稿。'}
              </p>
            </div>
            <span className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800">
              受控工作区 · 非生产回执
            </span>
          </div>
          <FirstLoopView section={section} />
        </main>
      </div>
    </div>
  );
}

export default function ConsolePage() {
  return (
    <FirstLoopProvider>
      <ConsoleContent />
    </FirstLoopProvider>
  );
}
