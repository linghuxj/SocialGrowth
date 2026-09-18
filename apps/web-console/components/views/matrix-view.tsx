'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { useDatabase, AccountEntity, DeviceEntity } from '@/lib/db';
import {
  Smartphone,
  Shield,
  Wifi,
  Battery,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Search,
  Sliders,
  X,
  SlidersHorizontal,
  ExternalLink
} from 'lucide-react';

export function MatrixView() {
  const { devices, accounts, coldSparePool, toggleAccountAutoPilot, rebindColdSpareAccount } = useDatabase();
  const [filterPlatform, setFilterPlatform] = useState<'all' | 'facebook' | 'youtube'>('all');
  const [filterHealth, setFilterHealth] = useState<'all' | 'healthy' | 'warning'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Selected account for details modal
  const [selectedAccount, setSelectedAccount] = useState<AccountEntity | null>(null);

  // Selected spare for rebind modal
  const [selectedSpare, setSelectedSpare] = useState<AccountEntity | null>(null);
  const [targetDeviceId, setTargetDeviceId] = useState<string>('dev-007');

  const filteredDevices = useMemo(() => {
    return devices.filter(device => {
      // Health filter
      if (filterHealth !== 'all' && device.health !== filterHealth) return false;

      const fbAcc = accounts.find(a => a.id === device.assignedFbAccountId);
      const ytAcc = accounts.find(a => a.id === device.assignedYtAccountId);

      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchDev = device.id.toLowerCase().includes(q) || device.serial.toLowerCase().includes(q);
        const matchFb = fbAcc && (fbAcc.name.toLowerCase().includes(q) || fbAcc.handle.toLowerCase().includes(q));
        const matchYt = ytAcc && (ytAcc.name.toLowerCase().includes(q) || ytAcc.handle.toLowerCase().includes(q));
        if (!matchDev && !matchFb && !matchYt) return false;
      }

      return true;
    });
  }, [devices, accounts, filterHealth, searchQuery]);

  const handleConfirmRebind = () => {
    if (!selectedSpare) return;
    const targetDev = devices.find(d => d.id === targetDeviceId);
    const failedAccId = selectedSpare.platform === 'facebook'
      ? targetDev?.assignedFbAccountId || 'fb-acc-007'
      : targetDev?.assignedYtAccountId || 'yt-acc-007';
    rebindColdSpareAccount(targetDeviceId, selectedSpare.id, failedAccId);
    setSelectedSpare(null);
  };

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <span>模块 1：账号矩阵与纯真机设备映射拓扑</span>
            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs">
              {devices.length} 台真机 / {accounts.length} 个账号
            </Badge>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            严格落实 1:1 设备专属强绑定，单台 Samsung Galaxy S23 仅登录 1 个 Facebook Page 与 1 个 YouTube 频道，物理隔离杜绝多账号串号关联。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Search bar */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="搜索设备ID/账号/句柄..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="h-8 pl-8 pr-3 text-xs rounded-md border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 w-48 lg:w-60"
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

          {/* Platform Filters */}
          <div className="flex gap-1 bg-slate-100 p-0.5 rounded-md border border-slate-200">
            <Button
              variant={filterPlatform === 'all' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setFilterPlatform('all')}
              className="text-xs h-7 px-2.5"
            >
              全部
            </Button>
            <Button
              variant={filterPlatform === 'facebook' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setFilterPlatform('facebook')}
              className="text-xs h-7 px-2.5"
            >
              FB
            </Button>
            <Button
              variant={filterPlatform === 'youtube' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setFilterPlatform('youtube')}
              className="text-xs h-7 px-2.5"
            >
              YT
            </Button>
          </div>

          {/* Health Filter */}
          <div className="flex gap-1 bg-slate-100 p-0.5 rounded-md border border-slate-200 text-xs">
            <button
              type="button"
              onClick={() => setFilterHealth(filterHealth === 'warning' ? 'all' : 'warning')}
              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                filterHealth === 'warning'
                  ? 'bg-amber-600 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              待巡检
            </button>
          </div>
        </div>
      </div>

      {/* Top 3 Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-slate-200 shadow-xs">
          <CardHeader className="pb-2">
            <span className="text-xs text-slate-500 font-medium">在跑纯真机池</span>
            <CardTitle className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <span>{devices.length} / {devices.length} 台在线</span>
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">
            全部为海外物理节点 Samsung Galaxy S23，0 个虚拟化设备（100% 纯物理真机底座）。
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-xs">
          <CardHeader className="pb-2">
            <span className="text-xs text-slate-500 font-medium">在管矩阵账号</span>
            <CardTitle className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <span>{accounts.length} 个活跃</span>
              <Shield className="w-5 h-5 text-blue-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">
            20 个 FB Page + 20 个 YT Channel，38 个状态正常，2 个处于巡检观察。
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-xs">
          <CardHeader className="pb-2">
            <span className="text-xs text-slate-500 font-medium">冷备账号池 (Cold-spare)</span>
            <CardTitle className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <span>{coldSparePool.length} 个就绪备用</span>
              <RefreshCw className="w-5 h-5 text-amber-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">
            解耦独立维护，支持封号时一键调用流水线替换，不影响设备硬件。
          </CardContent>
        </Card>
      </div>

      {/* 20 Devices & 1:1 Account Mapping Table */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <span>真机设备与双平台账号 1:1 映射拓扑表（展示 {filteredDevices.length} 台）</span>
            <span className="text-xs text-slate-400 font-mono">1 Device = 1 FB Page + 1 YT Channel</span>
          </h3>
          <span className="text-xs text-slate-500">提示：点击任意账号可打开运营详情与策略配置抽屉</span>
        </div>

        <div className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-xs">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead className="text-xs font-semibold text-slate-700 w-32">真机设备标识</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700 w-36">硬件与节点状态</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700">绑定的 Facebook 账号 (1:1)</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700">绑定的 YouTube 账号 (1:1)</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700 w-32">Instagram 状态</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700 w-28">执行中任务</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredDevices.map(device => {
                const fbAcc = accounts.find(a => a.id === device.assignedFbAccountId);
                const ytAcc = accounts.find(a => a.id === device.assignedYtAccountId);

                if (filterPlatform === 'facebook' && !fbAcc) return null;
                if (filterPlatform === 'youtube' && !ytAcc) return null;

                return (
                  <TableRow key={device.id} className="hover:bg-slate-50/80">
                    <TableCell className="font-mono text-xs font-bold text-slate-900">
                      <div className="flex items-center gap-1.5">
                        <Smartphone className="w-3.5 h-3.5 text-slate-400" />
                        <span>{device.id}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 block font-normal">{device.serial}</span>
                    </TableCell>

                    <TableCell className="text-xs">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 ${
                            device.health === 'healthy'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-amber-50 text-amber-700 border-amber-200 font-bold'
                          }`}
                        >
                          {device.health === 'healthy' ? '健康' : '待巡检'}
                        </Badge>
                        <span className="text-slate-500 font-mono text-[11px]">{device.temperatureC}°C</span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono">
                        <span className="flex items-center gap-1"><Battery className="w-3 h-3" /> {device.batteryLevel}%</span>
                        <span className="flex items-center gap-1"><Wifi className="w-3 h-3" /> {device.networkLatencyMs}ms</span>
                      </div>
                    </TableCell>

                    {/* Facebook Binding */}
                    <TableCell className="text-xs">
                      {fbAcc ? (
                        <div
                          className="cursor-pointer group p-1 rounded hover:bg-blue-50/50 transition-colors"
                          onClick={() => setSelectedAccount(fbAcc)}
                          title="点击打开账号策略详情"
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0" />
                            <strong className="text-slate-900 group-hover:text-blue-700">{fbAcc.name}</strong>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500 font-mono">
                            <span>{fbAcc.handle}</span>
                            <span>·</span>
                            <span>{fbAcc.followers.toLocaleString()} 关注</span>
                            <span>·</span>
                            <span className={fbAcc.autoPilotEnabled ? 'text-indigo-600 font-semibold' : 'text-slate-400'}>
                              {fbAcc.autoPilotEnabled ? '自主托管' : '人工审核'}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-400">未绑定</span>
                      )}
                    </TableCell>

                    {/* YouTube Binding */}
                    <TableCell className="text-xs">
                      {ytAcc ? (
                        <div
                          className="cursor-pointer group p-1 rounded hover:bg-red-50/50 transition-colors"
                          onClick={() => setSelectedAccount(ytAcc)}
                          title="点击打开账号策略详情"
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-red-600 shrink-0" />
                            <strong className="text-slate-900 group-hover:text-red-700">{ytAcc.name}</strong>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500 font-mono">
                            <span>{ytAcc.handle}</span>
                            <span>·</span>
                            <span>{ytAcc.followers.toLocaleString()} 订阅</span>
                            <span>·</span>
                            <span className={ytAcc.autoPilotEnabled ? 'text-indigo-600 font-semibold' : 'text-slate-400'}>
                              {ytAcc.autoPilotEnabled ? '自主托管' : '人工审核'}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-400">未绑定</span>
                      )}
                    </TableCell>

                    {/* Instagram Reserved */}
                    <TableCell className="text-xs">
                      <Badge variant="outline" className="text-[10px] text-slate-400 border-slate-200 bg-slate-50">
                        储备槽位 (未接入)
                      </Badge>
                    </TableCell>

                    {/* Current Task */}
                    <TableCell className="text-xs font-mono">
                      {device.currentTask ? (
                        <div className="text-[11px]">
                          <span className="font-semibold text-emerald-600 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            {device.currentTask.action}
                          </span>
                          <span className="text-slate-400 block text-[10px]">{device.currentTask.elapsedSeconds}s 已耗时</span>
                        </div>
                      ) : (
                        <span className="text-slate-400 text-[11px]">空闲待命中</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Cold Spare Pool Table & Rebind Entry */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-900 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>冷备账号池（5个就绪账号 · 与设备硬件完全解耦）</span>
            <Badge variant="secondary" className="text-[10px]">随时可用</Badge>
          </div>
          <span className="text-xs text-slate-500">点击任意备用账号可快速指派绑定至指定真机</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {coldSparePool.map(spare => (
            <div
              key={spare.id}
              onClick={() => setSelectedSpare(spare)}
              className="p-3 bg-white border border-slate-200 rounded-lg text-xs space-y-1.5 hover:border-amber-400 cursor-pointer transition-all shadow-xs"
            >
              <div className="flex justify-between items-center">
                <span className="font-mono font-bold text-slate-800">{spare.id}</span>
                <span className={`w-2 h-2 rounded-full ${spare.platform === 'facebook' ? 'bg-blue-600' : 'bg-red-600'}`} />
              </div>
              <strong className="block text-slate-900 truncate">{spare.name}</strong>
              <span className="text-slate-500 block truncate font-mono text-[11px]">{spare.handle}</span>
              <div className="pt-1 border-t border-slate-100 flex justify-between items-center text-[10px]">
                <span className="text-emerald-600 font-medium">冷启动就绪</span>
                <span className="text-blue-600 underline">指派换号 &gt;</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modal 1: Account Operational Detail & Config Dialog */}
      {selectedAccount && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-lg max-w-lg w-full p-5 border border-slate-200 shadow-xl space-y-4">
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={selectedAccount.platform === 'facebook' ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-700'}>
                    {selectedAccount.platform === 'facebook' ? 'Facebook Page' : 'YouTube Channel'}
                  </Badge>
                  <strong className="text-base text-slate-900">{selectedAccount.name}</strong>
                </div>
                <span className="text-xs text-slate-500 font-mono mt-0.5 block">{selectedAccount.handle}</span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAccount(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-slate-50 rounded border border-slate-200">
                <span className="text-slate-400 block text-[10px]">1:1 绑定物理真机</span>
                <strong className="text-slate-800 font-mono text-sm">{selectedAccount.boundDeviceId}</strong>
              </div>
              <div className="p-3 bg-slate-50 rounded border border-slate-200">
                <span className="text-slate-400 block text-[10px]">粉丝/订阅量</span>
                <strong className="text-slate-800 font-mono text-sm">{selectedAccount.followers.toLocaleString()}</strong>
              </div>
              <div className="p-3 bg-slate-50 rounded border border-slate-200">
                <span className="text-slate-400 block text-[10px]">累计发布切片</span>
                <strong className="text-slate-800 font-mono text-sm">{selectedAccount.publishedCount} 条</strong>
              </div>
              <div className="p-3 bg-slate-50 rounded border border-slate-200">
                <span className="text-slate-400 block text-[10px]">累计产生播放</span>
                <strong className="text-slate-800 font-mono text-sm">{selectedAccount.totalViews.toLocaleString()}</strong>
              </div>
            </div>

            {/* Auto Pilot Switch */}
            <div className="p-3 rounded-lg border border-slate-200 bg-indigo-50/50 flex justify-between items-center">
              <div>
                <span className="text-xs font-bold text-indigo-950 block">策略下发模式 (Auto-Pilot)</span>
                <span className="text-[11px] text-indigo-800">
                  {selectedAccount.autoPilotEnabled
                    ? '当前处于【自主托管无人值守】，AI 策略校验规则通过后直接自动下发真机。'
                    : '当前处于【人工审核流】，策略需运营人员单人审核后方可下发真机。'}
                </span>
              </div>
              <Button
                size="sm"
                variant={selectedAccount.autoPilotEnabled ? 'default' : 'outline'}
                onClick={() => {
                  toggleAccountAutoPilot(selectedAccount.id);
                  setSelectedAccount(prev => prev ? { ...prev, autoPilotEnabled: !prev.autoPilotEnabled } : null);
                }}
                className="h-8 text-xs shrink-0 ml-3"
              >
                {selectedAccount.autoPilotEnabled ? '切为人工审核' : '开启自主托管'}
              </Button>
            </div>

            <div className="flex justify-end pt-2">
              <Button size="sm" variant="outline" onClick={() => setSelectedAccount(null)} className="h-8 text-xs">
                关闭
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Cold-spare Rebind Dialog */}
      {selectedSpare && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-lg max-w-md w-full p-5 border border-slate-200 shadow-xl space-y-4">
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div>
                <strong className="text-base text-slate-900">冷备换号流水线一键指派</strong>
                <p className="text-xs text-slate-500">将备用账号绑定至目标真机，执行自动环境重置与凭证重绑。</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSpare(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-50 rounded border border-slate-200 space-y-1">
                <span className="text-slate-400 block text-[10px]">待激活冷备账号</span>
                <strong className="text-slate-800 text-sm font-mono">{selectedSpare.id} · {selectedSpare.name}</strong>
                <span className="text-[11px] text-slate-500 font-mono block">平台: {selectedSpare.platform === 'facebook' ? 'Facebook' : 'YouTube'}</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  选择目标真机设备 (1:1 物理绑定)
                </label>
                <select
                  value={targetDeviceId}
                  onChange={e => setTargetDeviceId(e.target.value)}
                  className="w-full h-8 px-2 rounded border border-slate-300 bg-white text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {devices.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.id} ({d.model}) - 当前绑定: {selectedSpare.platform === 'facebook' ? d.assignedFbAccountId : d.assignedYtAccountId}
                    </option>
                  ))}
                </select>
              </div>

              <div className="p-2.5 bg-amber-50 rounded border border-amber-200 text-amber-800 text-[11px] leading-relaxed">
                <strong>SOP 提醒</strong>：点击确认后，系统将自动触发：1. 暂停原账号排期；2. 真机执行 pm clear 重置 App 缓存；3. 读取安全凭证登录新号；4. 写入 1:1 映射拓扑。
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button size="sm" variant="outline" onClick={() => setSelectedSpare(null)} className="h-8 text-xs">
                取消
              </Button>
              <Button size="sm" className="h-8 text-xs bg-amber-600 hover:bg-amber-700 text-white" onClick={handleConfirmRebind}>
                确认执行换号 SOP
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
