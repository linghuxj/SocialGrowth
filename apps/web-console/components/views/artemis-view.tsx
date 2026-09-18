'use client';

import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useDatabase } from '@/lib/db';
import {
  Smartphone,
  Terminal,
  ShieldCheck,
  Search,
  RotateCcw,
  Activity,
  Wifi,
  Thermometer,
  BatteryCharging,
  Send,
  CheckCircle2
} from 'lucide-react';

export function ArtemisView() {
  const { devices, triggerArtemisPing, triggerArtemisSelfHeal } = useDatabase();

  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(devices[0]?.id || 'dev-s23-001');
  const [deviceSearch, setDeviceSearch] = useState('');
  const [healthFilter, setHealthFilter] = useState<'all' | 'healthy' | 'warning'>('all');

  const selectedDevice = devices.find(d => d.id === selectedDeviceId) || devices[0];

  // Filtered devices
  const filteredDevices = devices.filter(d => {
    const matchesSearch =
      d.id.toLowerCase().includes(deviceSearch.toLowerCase()) ||
      d.serial.toLowerCase().includes(deviceSearch.toLowerCase()) ||
      d.assignedFbAccountId.toLowerCase().includes(deviceSearch.toLowerCase()) ||
      d.assignedYtAccountId.toLowerCase().includes(deviceSearch.toLowerCase());

    const matchesHealth = healthFilter === 'all' || d.health === healthFilter;
    return matchesSearch && matchesHealth;
  });

  const healthyCount = devices.filter(d => d.health === 'healthy').length;

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <span>模块 6：Google Artemis 纯物理真机执行底座与群控看板</span>
            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs font-mono">
              {healthyCount} / {devices.length} Samsung S23 在线
            </Badge>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            采用 Google Artemis 调度纯 Android 物理真机（杜绝云手机/虚拟化），驱动目标官方 App 原生 UI 执行发布动作，回传动作截屏与自愈回执。
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs bg-slate-900 text-emerald-400 border-slate-800 font-mono">
            Watchdog 10min 超时保护: 运行中
          </Badge>
        </div>
      </div>

      {/* Real-time Telemetry & Live Stream Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Devices Grid Selector */}
        <div className="lg:col-span-1 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              物理真机设备池 ({devices.length} 台)
            </h3>
            <span className="text-xs text-slate-500 font-mono">100% 物理真机</span>
          </div>

          {/* Device Search & Filter */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="搜索设备ID/序列号/账号..."
                value={deviceSearch}
                onChange={e => setDeviceSearch(e.target.value)}
                className="w-full pl-8 pr-2.5 py-1 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setHealthFilter('all')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  healthFilter === 'all'
                    ? 'bg-slate-800 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                全部 ({devices.length})
              </button>
              <button
                type="button"
                onClick={() => setHealthFilter('healthy')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  healthFilter === 'healthy'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                健康 ({healthyCount})
              </button>
              <button
                type="button"
                onClick={() => setHealthFilter('warning')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  healthFilter === 'warning'
                    ? 'bg-amber-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                待关注 ({devices.length - healthyCount})
              </button>
            </div>
          </div>

          {/* Device Scroll Area */}
          <div className="grid grid-cols-2 gap-2 max-h-[560px] overflow-y-auto pr-1">
            {filteredDevices.map(d => (
              <button
                type="button"
                key={d.id}
                onClick={() => setSelectedDeviceId(d.id)}
                className={`w-full text-left p-2.5 rounded-lg border text-xs cursor-pointer transition-all ${
                  selectedDevice.id === d.id
                    ? 'border-blue-600 bg-blue-50/50 shadow-xs ring-1 ring-blue-500'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex justify-between items-center mb-1">
                  <span className="font-mono font-bold text-slate-900">{d.id}</span>
                  <span
                    className={`w-2 h-2 rounded-full ${
                      d.health === 'healthy' ? 'bg-emerald-500' : 'bg-amber-500 animate-ping'
                    }`}
                  />
                </div>
                <span className="text-[10px] text-slate-500 block truncate font-mono">
                  {d.model}
                </span>
                <div className="flex justify-between items-center text-[10px] text-slate-400 font-mono mt-1 pt-1 border-t border-slate-100">
                  <span>{d.batteryLevel}% 电量</span>
                  <span>{d.temperatureC}°C</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right: Selected Device Live Execution Evidence Stream */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="border-slate-200 shadow-xs">
            <CardHeader className="pb-3 border-b border-slate-100">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-blue-600" />
                    <CardTitle className="text-base font-bold text-slate-900 font-mono">
                      {selectedDevice.id} · {selectedDevice.model}
                    </CardTitle>
                    <Badge
                      variant="outline"
                      className={`text-xs ${
                        selectedDevice.health === 'healthy'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-amber-50 text-amber-700 border-amber-200'
                      }`}
                    >
                      {selectedDevice.health === 'healthy' ? '健康在运行' : '待自愈关注'}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs text-slate-500 mt-0.5">
                    序列号: {selectedDevice.serial} · 部署地区: {selectedDevice.location} · 局域网延迟: {selectedDevice.networkLatencyMs}ms
                  </CardDescription>
                </div>

                {/* Operations Control Actions */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => triggerArtemisPing(selectedDevice.id)}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded font-medium transition-colors"
                  >
                    <Activity className="w-3.5 h-3.5 text-blue-600" />
                    巡检 Ping
                  </button>

                  <button
                    type="button"
                    onClick={() => triggerArtemisSelfHeal(selectedDevice.id)}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded font-medium transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-amber-600" />
                    看门狗超时自愈
                  </button>
                </div>
              </div>

              {/* 1:1 Binding Indicator */}
              <div className="mt-3 pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between text-xs font-mono">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 text-[11px]">1:1 物理专属强绑定:</span>
                  <span className="font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                    FB: {selectedDevice.assignedFbAccountId}
                  </span>
                  <span className="font-semibold text-red-700 bg-red-50 px-1.5 py-0.5 rounded border border-red-200">
                    YT: {selectedDevice.assignedYtAccountId}
                  </span>
                </div>
                <span className="text-slate-400 text-[11px]">
                  硬件隔离级别: 独立 USB Hub 端口与海外真实专线
                </span>
              </div>
            </CardHeader>

            <CardContent className="pt-4 space-y-4">
              {/* Live UI Action Flow Stream */}
              <div className="bg-slate-950 text-slate-100 rounded-lg p-4 font-mono text-xs space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2 text-[11px]">
                  <span className="text-emerald-400 flex items-center gap-1.5 font-semibold">
                    <Terminal className="w-3.5 h-3.5" />
                    Artemis UI 原生自动化执行流证据 (Samsung S23 App Stream · {selectedDevice.id})
                  </span>
                  <span className="text-slate-500">Task-Pipeline Active</span>
                </div>

                {/* Step execution breakdown */}
                <div className="space-y-1.5 text-[11px]">
                  <div className="flex items-center gap-2 text-slate-300">
                    <span className="text-emerald-400">14:35:10 [EXEC]</span>
                    <span>adb shell monkey -p com.facebook.katana -c android.intent.category.LAUNCHER 1</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-300">
                    <span className="text-emerald-400">14:35:14 [ACTION]</span>
                    <span>Artemis UI Driver: 查找并点击 &quot;Reels&quot; 创建入口控件 (NodeID: fb_reels_tab_create)</span>
                  </div>
                  <div className="flex items-center gap-2 text-amber-300 bg-amber-950/30 p-1.5 rounded border border-amber-900/50">
                    <span className="text-amber-400 font-bold">[SELF-HEALING]</span>
                    <span>控件坐标偏移 +12px (Meta 动态 AB 布局变动) · 智能自愈引擎自动修正点击坐标 (x: 842, y: 198) 命中成功</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-300">
                    <span className="text-emerald-400">14:35:28 [MEDIA]</span>
                    <span>从本地受保护存储拉取独占切片 clip-destiny-001 (MD5: e7f2a1b9c...) 注入系统相册</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-300">
                    <span className="text-emerald-400">14:35:42 [INPUT]</span>
                    <span>粘贴经审核文案（含单条独占短链 https://sg8.link/d-tyc03）并点击公开发布</span>
                  </div>
                  <div className="flex items-center gap-2 text-emerald-400 font-bold">
                    <span>14:36:01 [VERIFIED]</span>
                    <span>发布完成回执捕获，已生成执行截屏 evidence_{selectedDevice.id}_143601.png 并写入 S3 审计库</span>
                  </div>
                </div>

                {/* 10-Minute Hard Watchdog Status */}
                <div className="border-t border-slate-800 pt-2 flex flex-col sm:flex-row justify-between items-start sm:items-center text-[10px] text-slate-400 gap-1">
                  <span className="flex items-center gap-1 text-slate-300">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    10 分钟看门狗硬监控：当前耗时 51 秒 / 600 秒上限 (状态正常)
                  </span>
                  <span className="text-slate-500">超时自愈流水线: am force-stop + input keyevent HOME</span>
                </div>
              </div>

              {/* Hardware Telemetry Specs */}
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="p-2.5 bg-slate-50 rounded border border-slate-200">
                  <div className="flex items-center justify-between text-slate-400 text-[10px] mb-1">
                    <span>CPU 与环境温度</span>
                    <Thermometer className="w-3.5 h-3.5 text-slate-400" />
                  </div>
                  <strong className="text-slate-900 text-sm font-mono">{selectedDevice.temperatureC}°C</strong>
                  <span className="text-emerald-600 block text-[10px] mt-0.5">温控巡检正常</span>
                </div>

                <div className="p-2.5 bg-slate-50 rounded border border-slate-200">
                  <div className="flex items-center justify-between text-slate-400 text-[10px] mb-1">
                    <span>电池健康与充电</span>
                    <BatteryCharging className="w-3.5 h-3.5 text-slate-400" />
                  </div>
                  <strong className="text-slate-900 text-sm font-mono">{selectedDevice.batteryLevel}%</strong>
                  <span className="text-slate-500 block text-[10px] mt-0.5">智能慢充保护中</span>
                </div>

                <div className="p-2.5 bg-slate-50 rounded border border-slate-200">
                  <div className="flex items-center justify-between text-slate-400 text-[10px] mb-1">
                    <span>真机海外网络延迟</span>
                    <Wifi className="w-3.5 h-3.5 text-slate-400" />
                  </div>
                  <strong className="text-slate-900 text-sm font-mono">{selectedDevice.networkLatencyMs} ms</strong>
                  <span className="text-emerald-600 block text-[10px] mt-0.5">独立海外物理网关</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

