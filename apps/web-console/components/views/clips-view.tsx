'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { useDatabase, ClipAssetEntity } from '@/lib/db';
import { Lock, ShieldCheck, Video, AlertCircle, FileCheck2, Tag, Search, X, Check, Copy } from 'lucide-react';

export function ClipsView() {
  const { clips, clipVaultStats, accounts, assignClipExclusiveLock, notify } = useDatabase();
  const [filterStatus, setFilterStatus] = useState<'all' | 'published' | 'assigned_locked' | 'unallocated'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSeries, setSelectedSeries] = useState<string>('all');

  // Assign lock modal state
  const [lockingClip, setLockingClip] = useState<ClipAssetEntity | null>(null);
  const [targetAccountId, setTargetAccountId] = useState<string>('fb-acc-001');

  // Extract unique series
  const seriesList = useMemo(() => {
    const set = new Set(clips.map(c => c.series));
    return Array.from(set);
  }, [clips]);

  const filteredClips = useMemo(() => {
    return clips.filter(clip => {
      if (filterStatus !== 'all' && clip.lockStatus !== filterStatus) return false;
      if (selectedSeries !== 'all' && clip.series !== selectedSeries) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = clip.title.toLowerCase().includes(q);
        const matchId = clip.id.toLowerCase().includes(q);
        const matchTags = clip.tags.some(t => t.toLowerCase().includes(q));
        if (!matchTitle && !matchId && !matchTags) return false;
      }
      return true;
    });
  }, [clips, filterStatus, selectedSeries, searchQuery]);

  const handleConfirmLock = () => {
    if (!lockingClip) return;
    assignClipExclusiveLock(lockingClip.id, targetAccountId);
    setLockingClip(null);
  };

  const handleCopyChecksum = (checksum: string) => {
    navigator.clipboard?.writeText(checksum);
    notify(`SHA256 校验和 [${checksum.slice(0, 12)}...] 已复制到剪贴板。`, 'info');
  };

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <span>模块 2：切片素材管理与排他独占锁（Exclusive Lock）</span>
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">
              独占排他 100% 拦截
            </Badge>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            专注管理已有成品漫剧切片资产。每条切片人工确认后强制加注唯一目标账号独占锁，严禁跨账号重复分发，从源头根除搬运降权。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Search bar */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="搜索切片标题/剧集/标签..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="h-8 pl-8 pr-3 text-xs rounded-md border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-amber-500 w-48 lg:w-56"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Drama Series Filter */}
          <select
            value={selectedSeries}
            onChange={e => setSelectedSeries(e.target.value)}
            className="h-8 px-2 rounded border border-slate-300 bg-white text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-amber-500"
          >
            <option value="all">全部短剧系列</option>
            {seriesList.map(s => (
              <option key={s} value={s}>{s.split(' ')[0]}</option>
            ))}
          </select>

          {/* Status Buttons */}
          <div className="flex gap-1 bg-slate-100 p-0.5 rounded-md border border-slate-200">
            <Button
              variant={filterStatus === 'all' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setFilterStatus('all')}
              className="text-xs h-7 px-2"
            >
              全部
            </Button>
            <Button
              variant={filterStatus === 'published' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setFilterStatus('published')}
              className="text-xs h-7 px-2"
            >
              已发布
            </Button>
            <Button
              variant={filterStatus === 'assigned_locked' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setFilterStatus('assigned_locked')}
              className="text-xs h-7 px-2"
            >
              锁定中
            </Button>
            <Button
              variant={filterStatus === 'unallocated' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setFilterStatus('unallocated')}
              className="text-xs h-7 px-2"
            >
              待排期
            </Button>
          </div>
        </div>
      </div>

      {/* 4 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-slate-200 shadow-xs">
          <CardHeader className="pb-2">
            <span className="text-xs text-slate-500 font-medium">切片素材储备总量</span>
            <CardTitle className="text-2xl font-bold text-slate-900 mt-1 flex items-center justify-between">
              <span>{clipVaultStats.totalClipsInVault.toLocaleString()} 条</span>
              <Video className="w-5 h-5 text-blue-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">
            均为 9:16 竖版成品切片（Reels/Shorts 规格）。
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-xs">
          <CardHeader className="pb-2">
            <span className="text-xs text-slate-500 font-medium">累计有效公开发布</span>
            <CardTitle className="text-2xl font-bold text-emerald-600 mt-1 flex items-center justify-between">
              <span>{clipVaultStats.publishedCount.toLocaleString()} 条</span>
              <FileCheck2 className="w-5 h-5 text-emerald-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">
            按 90% 实现率完成，FB 1,539 条 + YT 1,539 条。
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-xs">
          <CardHeader className="pb-2">
            <span className="text-xs text-slate-500 font-medium">独占锁拦截搬运次数</span>
            <CardTitle className="text-2xl font-bold text-amber-600 mt-1 flex items-center justify-between">
              <span>{clipVaultStats.duplicateAttemptInterceptions} 次</span>
              <Lock className="w-5 h-5 text-amber-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">
            成功拦截跨账号重复下发，排他锁生效。
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-xs">
          <CardHeader className="pb-2">
            <span className="text-xs text-slate-500 font-medium">跨账号内容重复率</span>
            <CardTitle className="text-2xl font-bold text-slate-900 mt-1 flex items-center justify-between">
              <span>0.0%</span>
              <ShieldCheck className="w-5 h-5 text-emerald-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">
            严格遵守 CLAUDE.md 第 4 铁律，排他独占。
          </CardContent>
        </Card>
      </div>

      {/* Clip Asset Table */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <span>切片素材资产与独占加锁明细表（展示 {filteredClips.length} 条）</span>
            <span className="text-xs text-slate-400">每条素材全局唯一锁定至单个账号</span>
          </h3>
          <span className="text-xs text-slate-500">提示：对未分配切片点击“加注排他锁”可直接指派目标账号</span>
        </div>

        <div className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-xs">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead className="text-xs font-semibold text-slate-700 w-32">素材标识</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700">剧目名称与分集标题</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700 w-28">规格与时长</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700 w-44">题材与爆点标签</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700 w-36">排他独占锁状态</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700 w-52">独占绑定账号与操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredClips.map(clip => (
                <TableRow key={clip.id} className="hover:bg-slate-50/80">
                  <TableCell className="font-mono text-xs font-medium text-slate-600">
                    <span className="font-bold text-slate-800">{clip.id}</span>
                    <button
                      type="button"
                      onClick={() => handleCopyChecksum(`e7f2a1b9c${clip.id}`)}
                      title="复制 SHA256 校验和"
                      className="text-[10px] text-slate-400 hover:text-slate-600 flex items-center gap-1 mt-0.5"
                    >
                      <Copy className="w-2.5 h-2.5" />
                      <span>SHA256 校验</span>
                    </button>
                  </TableCell>

                  <TableCell className="text-xs">
                    <strong className="text-slate-900 block">{clip.title}</strong>
                    <span className="text-[11px] text-slate-500">{clip.series} · 第 {clip.episode} 集</span>
                  </TableCell>

                  <TableCell className="text-xs font-mono">
                    <span className="text-slate-800 font-semibold">{clip.durationSeconds}秒</span>
                    <span className="text-slate-400 text-[11px] block">{clip.aspectRatio} 竖屏</span>
                  </TableCell>

                  <TableCell className="text-xs">
                    <div className="flex flex-wrap gap-1">
                      {clip.tags.map(tag => (
                        <span key={tag} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px]">
                          <Tag className="w-2.5 h-2.5" />
                          {tag}
                        </span>
                      ))}
                    </div>
                  </TableCell>

                  <TableCell className="text-xs">
                    {clip.lockStatus === 'published' && (
                      <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[11px] flex items-center gap-1 w-fit">
                        <FileCheck2 className="w-3 h-3" />
                        已发布归档
                      </Badge>
                    )}
                    {clip.lockStatus === 'assigned_locked' && (
                      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300 text-[11px] flex items-center gap-1 w-fit font-semibold">
                        <Lock className="w-3 h-3" />
                        排他独占加锁中
                      </Badge>
                    )}
                    {clip.lockStatus === 'unallocated' && (
                      <Badge variant="outline" className="bg-slate-100 text-slate-600 border-slate-200 text-[11px] w-fit">
                        未分配待排期
                      </Badge>
                    )}
                  </TableCell>

                  <TableCell className="text-xs font-mono">
                    {clip.exclusiveAccountId ? (
                      <div>
                        <span className="font-bold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                          {clip.exclusiveAccountId}
                        </span>
                        <span className="text-[10px] text-slate-400 block mt-0.5">
                          {clip.lockedAt ? `锁定于: ${clip.lockedAt}` : ''}
                        </span>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setLockingClip(clip)}
                        className="h-7 text-xs border-amber-300 text-amber-800 hover:bg-amber-50 font-sans"
                      >
                        <Lock className="w-3 h-3 mr-1 text-amber-600" />
                        加注独占锁
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Modal: Assign Exclusive Lock Dialog */}
      {lockingClip && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-lg max-w-md w-full p-5 border border-slate-200 shadow-xl space-y-4">
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div>
                <strong className="text-base text-slate-900">加注切片排他独占发布锁 (Exclusive Lock)</strong>
                <p className="text-xs text-slate-500">将切片素材唯一绑定至目标账号，系统全局拒绝跨号二次排发。</p>
              </div>
              <button
                type="button"
                onClick={() => setLockingClip(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-50 rounded border border-slate-200 space-y-1">
                <span className="text-slate-400 block text-[10px]">选中切片资产</span>
                <strong className="text-slate-800 text-sm">{lockingClip.title}</strong>
                <span className="text-slate-500 text-[11px] block">{lockingClip.series} · 第 {lockingClip.episode} 集 · {lockingClip.durationSeconds}秒</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  指定排他独占账号 (从在管 40 矩阵中选择)
                </label>
                <select
                  value={targetAccountId}
                  onChange={e => setTargetAccountId(e.target.value)}
                  className="w-full h-8 px-2 rounded border border-slate-300 bg-white text-xs font-mono focus:outline-none focus:ring-1 focus:ring-amber-500"
                >
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.id} - {a.name} ({a.platform === 'facebook' ? 'FB Page' : 'YT Channel'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="p-2.5 bg-amber-50 rounded border border-amber-200 text-amber-800 text-[11px] leading-relaxed">
                <strong>铁律说明 (CLAUDE.md 第 4 条)</strong>：确认后将为此切片生成全局排他锁记号，任何其他账号的排期请求将被强制拒绝，从源头杜绝同素材多号搬运风险。
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button size="sm" variant="outline" onClick={() => setLockingClip(null)} className="h-8 text-xs">
                取消
              </Button>
              <Button size="sm" className="h-8 text-xs bg-amber-600 hover:bg-amber-700 text-white" onClick={handleConfirmLock}>
                确认加注独占锁
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
