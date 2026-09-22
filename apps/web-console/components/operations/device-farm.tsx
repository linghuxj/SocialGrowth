'use client';
/* oxlint-disable next/no-img-element */
import React, { useEffect, useState, useTransition } from 'react';
import {
  Smartphone,
  AlertTriangle,
  Radio,
  RefreshCw,
  Camera,
  ShieldAlert,
  WifiOff,
  Wifi,
  Cable,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { runtimeRequest } from '@/lib/operations-context';
import { HumanAssistance } from './human-assistance';
import { AgentSupervision } from './agent-supervision';
import { useRuntimeStatus } from './runtime';

export interface DeviceStepInfo {
  deviceId: string;
  serial: string;
  model?: string;
  workerId: string;
  sessionId?: string;
  step: number;
  totalSteps?: number;
  type: 'post' | 'preflight' | 'verify_identity' | 'idle' | 'recovery';
  status: 'running' | 'idle' | 'blocked' | 'completed' | 'failed' | 'offline';
  action?: string;
  actionDesc?: string;
  imageKey?: string;
  timestamp: number;
  platform?: 'facebook' | 'youtube' | 'unknown';
  platformIdentity?: string;
  isPhysical?: boolean;
  adbStatus?: string;
}

export function DeviceFarmMonitor() {
  const [devices, setDevices] = useState<Record<string, DeviceStepInfo>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'running' | 'idle' | 'blocked' | 'offline'>('all');
  const [connected, setConnected] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [, startTransition] = useTransition();
  const { status: runtimeStatus, reload: reloadRuntime } = useRuntimeStatus();
  const waitingChallenges = (runtimeStatus.assistance ?? []).filter((c) => c.status === 'waiting');
  const waitingRequests = (runtimeStatus.supervision?.requests ?? []).filter((r) => r.status === 'waiting');
  const hasIntervention = waitingChallenges.length > 0 || waitingRequests.length > 0;

  const fetchRealDevices = async (capture = false) => {
    try {
      setRefreshing(true);
      const res = await runtimeRequest<{ ok: boolean; devices: DeviceStepInfo[] }>(
        `/devices/states${capture ? '?capture=1' : ''}`,
      );
      if (res.ok && Array.isArray(res.devices)) {
        startTransition(() => {
          const map: Record<string, DeviceStepInfo> = {};
          for (const d of res.devices) {
            map[d.serial || d.deviceId] = d;
          }
          setDevices(map);
        });
      }
    } catch {
      // Retain current state if offline
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    // Initial fetch with automatic screenshot capture of connected devices
    void fetchRealDevices(true);

    let es: EventSource | null = null;

    try {
      es = new EventSource('/api/runtime/events/stream');
      es.onopen = () => setConnected(true);
      es.onerror = () => setConnected(false);

      es.addEventListener('init', (evt) => {
        try {
          const list: DeviceStepInfo[] = JSON.parse(evt.data);
          if (Array.isArray(list) && list.length > 0) {
            setDevices((prev) => {
              const updated = { ...prev };
              for (const d of list) {
                const key = d.serial || d.deviceId;
                updated[key] = { ...updated[key], ...d };
              }
              return updated;
            });
          }
        } catch {}
      });

      es.addEventListener('step', (evt) => {
        try {
          const event: DeviceStepInfo = JSON.parse(evt.data);
          setDevices((prev) => {
            const key = event.serial || event.deviceId;
            return {
              ...prev,
              [key]: {
                ...prev[key],
                ...event,
              },
            };
          });
        } catch {}
      });
    } catch {
      // EventSource fallback handled by timer below
    }

    // 常驻 3 秒自动刷新机制 (兜底定时轮询真实状态与截屏)
    let pollTimer: NodeJS.Timeout | null = null;
    if (autoRefresh) {
      pollTimer = setInterval(() => {
        void fetchRealDevices(false);
      }, 3000);
    }

    return () => {
      if (es) es.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [autoRefresh]);

  const handleRefreshSingle = async (serial: string): Promise<void> => {
    try {
      const res = await runtimeRequest<{ ok: boolean; deviceId: string; imageKey: string; event: DeviceStepInfo }>(
        '/devices/refresh',
        { serial },
      );
      if (res.ok && res.event) {
        setDevices((prev) => ({
          ...prev,
          [serial]: {
            ...prev[serial],
            ...res.event,
            imageKey: res.imageKey,
          },
        }));
      }
    } catch (e) {
      alert(`刷新真机截屏失败：${e instanceof Error ? e.message : 'ADB 通信异常'}`);
    }
  };

  const deviceList = Object.values(devices).filter((d) => {
    if (filter === 'all') return true;
    return d.status === filter;
  });

  const totalCount = Object.keys(devices).length;
  const runningCount = Object.values(devices).filter((d) => d.status === 'running').length;
  const idleCount = Object.values(devices).filter((d) => d.status === 'idle').length;
  const blockedCount = Object.values(devices).filter((d) => d.status === 'blocked').length;
  const offlineCount = Object.values(devices).filter((d) => d.status === 'offline').length;

  return (
    <div className="space-y-6">
      {/* Top Header & Metrics Bar */}
      <div className="bg-slate-900/80 backdrop-blur border border-slate-800 rounded-2xl p-5 text-white shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 bg-indigo-500/20 text-indigo-400 rounded-lg">
                <Radio className={`w-5 h-5 ${connected ? 'animate-pulse text-emerald-400' : 'text-slate-400'}`} />
              </span>
              <div>
                <h2 className="text-xl font-bold tracking-tight">真机群控监控大屏 (Device Farm)</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  真实物理设备连接 · Worker 01 调度中枢 · MinIO WebP 实时截屏流
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Filter Pills */}
            <div className="bg-slate-800/80 p-1 rounded-xl border border-slate-700/50 flex gap-1 text-xs">
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1.5 rounded-lg font-medium transition ${
                  filter === 'all' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                全部真实设备 ({totalCount})
              </button>
              <button
                onClick={() => setFilter('running')}
                className={`px-3 py-1.5 rounded-lg font-medium transition ${
                  filter === 'running' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                运行中 ({runningCount})
              </button>
              <button
                onClick={() => setFilter('idle')}
                className={`px-3 py-1.5 rounded-lg font-medium transition ${
                  filter === 'idle' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                就绪待命 ({idleCount})
              </button>
              <button
                onClick={() => setFilter('blocked')}
                className={`px-3 py-1.5 rounded-lg font-medium transition ${
                  filter === 'blocked' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                阻断/需介入 ({blockedCount})
              </button>
              {offlineCount > 0 && (
                <button
                  onClick={() => setFilter('offline')}
                  className={`px-3 py-1.5 rounded-lg font-medium transition ${
                    filter === 'offline' ? 'bg-amber-700 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  离线 ({offlineCount})
                </button>
              )}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`text-xs gap-1.5 transition ${
                autoRefresh
                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700/60 hover:bg-emerald-900/60'
                  : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
              {autoRefresh ? '3s 自动刷新中' : '自动刷新已暂停'}
            </Button>

            <Button
              variant="outline"
              size="sm"
              disabled={refreshing}
              onClick={() => void fetchRealDevices(true)}
              className="bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 text-xs gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-emerald-400' : ''}`} />
              重新扫描真机与屏幕
            </Button>
          </div>
        </div>

        {/* Status Indicators Ribbon */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-800/80 text-xs">
          <div className="flex items-center gap-2 text-slate-300">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
            <span>物理真机已连接：<strong className="text-white font-semibold">{totalCount}</strong> 台</span>
          </div>
          <div className="flex items-center gap-2 text-slate-300">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-400" />
            <span>就绪待命中：<strong className="text-white font-semibold">{idleCount}</strong> 台</span>
          </div>
          <div className="flex items-center gap-2 text-slate-300">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
            <span>需人工介入：<strong className="text-rose-400 font-semibold">{blockedCount}</strong> 台</span>
          </div>
          <div className="flex items-center gap-2 text-slate-300">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            <span>底座架构：<strong className="text-white font-semibold">Google Artemis + MinIO</strong></span>
          </div>
        </div>
      </div>

      {/* Loading or Empty State */}
      {loading ? (
        <div className="flex flex-col items-center justify-center p-12 bg-slate-900/40 border border-slate-800 rounded-3xl text-center space-y-3">
          <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
          <p className="text-sm text-slate-300 font-medium">正在通过 ADB 探测已连接的物理真机...</p>
          <p className="text-xs text-slate-500">核对 USB 拓扑、1:1 账号绑定关系与当前屏幕快照</p>
        </div>
      ) : deviceList.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 bg-slate-900/40 border border-slate-800 rounded-3xl text-center space-y-3">
          <Cable className="w-12 h-12 text-slate-600" />
          <p className="text-base text-slate-200 font-semibold">未检测到已连接的物理真机</p>
          <p className="text-xs text-slate-400 max-w-md leading-relaxed">
            请将真实 Android 手机通过 USB 连接至本机，并在手机上开启【USB 调试】模式；
            运行 <code className="text-indigo-400 font-mono">adb devices</code> 确认设备状态为 <code className="text-emerald-400 font-mono">device</code>。
          </p>
          <Button
            size="sm"
            onClick={() => void fetchRealDevices(true)}
            className="mt-2 bg-indigo-600 hover:bg-indigo-500 text-xs"
          >
            再次检测连接
          </Button>
        </div>
      ) : (
        <>
          {hasIntervention && (
            <div
              id="intervention-panel"
              className="mb-8 p-6 rounded-3xl bg-slate-900/90 border-2 border-amber-500/60 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between border-b border-amber-500/30 pb-3">
                <div className="flex items-center gap-2 text-amber-300 font-bold text-sm">
                  <ShieldAlert className="w-5 h-5 text-amber-400 animate-bounce" />
                  <span>【实时人工协作待办】Artemis 任务已在物理真机上安全暂停，等待 Web 人工介入输入</span>
                </div>
                <span className="text-xs text-amber-400/80 font-mono">5 分钟内有效 · 凭据仅临时传递不入库</span>
              </div>
              {waitingChallenges.length > 0 && (
                <HumanAssistance challenges={waitingChallenges} reload={reloadRuntime} />
              )}
              {waitingRequests.length > 0 && (
                <AgentSupervision value={runtimeStatus.supervision} reload={reloadRuntime} />
              )}
            </div>
          )}

          {/* Real Device Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6">
            {deviceList.map((device) => (
              <RealPhoneCard
                key={device.serial || device.deviceId}
                device={device}
                onRefreshScreenshot={() => handleRefreshSingle(device.serial || device.deviceId)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function getPlatformBadge(platform?: string) {
  const p = (platform || '').toLowerCase();
  if (p.includes('facebook') || p === 'fb') {
    return {
      label: 'FB',
      className: 'bg-blue-950/90 text-blue-300 border-blue-700/60 font-bold',
    };
  }
  if (p.includes('youtube') || p === 'yt') {
    return {
      label: 'YT',
      className: 'bg-red-950/90 text-red-300 border-red-700/60 font-bold',
    };
  }
  if (p.includes('instagram') || p === 'ins') {
    return {
      label: 'INS',
      className: 'bg-pink-950/90 text-pink-300 border-pink-700/60 font-bold',
    };
  }
  return {
    label: '未绑定',
    className: 'bg-slate-800 text-slate-400 border-slate-700/50',
  };
}

function RealPhoneCard({
  device,
  onRefreshScreenshot,
}: {
  device: DeviceStepInfo;
  onRefreshScreenshot: () => Promise<void>;
}) {
  const [capturing, setCapturing] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  const isRunning = device.status === 'running';
  const isBlocked = device.status === 'blocked';
  const isOffline = device.status === 'offline';
  const isIdle = device.status === 'idle';

  const imageUrl = device.imageKey
    ? `/api/runtime/screenshots/${device.imageKey}`
    : undefined;

  const handleCapture = async () => {
    setCapturing(true);
    setImgLoaded(false);
    setImgError(false);
    try {
      await onRefreshScreenshot();
    } finally {
      setCapturing(false);
    }
  };

  const platformBadge = getPlatformBadge(device.platform);

  return (
    <div
      className={`relative flex flex-col items-center p-4 rounded-3xl transition-all duration-300 border ${
        isBlocked
          ? 'bg-rose-950/20 border-rose-600/50 shadow-rose-950/30 shadow-lg'
          : isRunning
          ? 'bg-slate-900/80 border-emerald-500/40 shadow-emerald-950/20 shadow-md'
          : isOffline
          ? 'bg-slate-900/30 border-slate-800/60 opacity-70'
          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
      }`}
    >
      {/* Device Header Bar */}
      <div className="w-full flex items-center justify-between gap-2 mb-3 px-1">
        <div className="flex items-center gap-2">
          <div
            className={`p-1.5 rounded-lg ${
              isBlocked
                ? 'bg-rose-500/20 text-rose-400'
                : isRunning
                ? 'bg-emerald-500/20 text-emerald-400'
                : isOffline
                ? 'bg-slate-800 text-slate-500'
                : 'bg-indigo-500/20 text-indigo-400'
            }`}
          >
            <Smartphone className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-slate-100 uppercase tracking-wide">
              {device.deviceId}
            </h3>
            <p className="text-[11px] text-slate-400 font-mono">
              {device.model || 'Samsung Galaxy S23'} · {device.serial}
            </p>
          </div>
        </div>

        {/* Platform & Status Badge */}
        <div className="flex items-center gap-1.5">
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${platformBadge.className}`}
          >
            {platformBadge.label}
          </span>
          <span
            className={`text-[11px] font-semibold px-2 py-0.5 rounded-md flex items-center gap-1 ${
              isRunning
                ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/50'
                : isBlocked
                ? 'bg-rose-950 text-rose-300 border border-rose-700/60 animate-pulse'
                : isOffline
                ? 'bg-slate-800 text-slate-500 border border-slate-700'
                : 'bg-slate-800/80 text-emerald-400 border border-slate-700/50'
            }`}
          >
            {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />}
            {isBlocked && <AlertTriangle className="w-3 h-3 text-rose-400" />}
            {isOffline && <WifiOff className="w-3 h-3 text-slate-500" />}
            {isIdle && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
            {isRunning ? `Step ${device.step}` : isBlocked ? '需人工处理' : isOffline ? '离线' : '就绪待命'}
          </span>
        </div>
      </div>

      {/* Realistic Phone Frame Outer Bezel - 内部图片保持完整展示 */}
      <div className="relative w-[220px] h-[450px] rounded-[38px] p-2 bg-gradient-to-b from-slate-700 via-slate-800 to-slate-900 shadow-2xl border border-slate-600/50 flex flex-col items-center">
        {/* Micro Camera Hole on Bezel */}
        <div className="absolute top-1.5 w-full flex justify-center items-center gap-1.5 z-20 pointer-events-none">
          <div className="w-1.5 h-1.5 rounded-full bg-slate-950 border border-slate-800/80 shadow-inner" />
        </div>

        {/* Screen Bezel (Inner OLED Screen) - 纯净屏幕，没有任何遮盖层 */}
        <div className="relative w-full h-full rounded-[30px] overflow-hidden bg-black flex items-center justify-center border border-slate-900/90 shadow-inner">
          {imageUrl && !imgError ? (
            <img
              src={imageUrl}
              alt={`Real screenshot from ${device.serial}`}
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgError(true)}
              className={`w-full h-full object-contain select-none transition-opacity duration-300 ${
                imgLoaded ? 'opacity-100' : 'opacity-20'
              }`}
            />
          ) : isBlocked ? (
            <div className="flex flex-col items-center justify-center p-4 text-center space-y-3 bg-rose-950/40">
              <ShieldAlert className="w-10 h-10 text-rose-400 animate-bounce" />
              <div className="space-y-1">
                <p className="text-xs text-rose-300 font-bold">人工介入待办</p>
                <p className="text-[10px] text-rose-200/80 leading-relaxed">
                  {device.actionDesc || '应用出现登录挑战或安全验证'}
                </p>
              </div>
              <a
                href="#/receipts"
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-[11px] font-semibold transition shadow"
              >
                前往处理
              </a>
            </div>
          ) : isOffline ? (
            <div className="flex flex-col items-center justify-center p-4 text-center space-y-2 opacity-50">
              <WifiOff className="w-10 h-10 text-slate-500" />
              <p className="text-xs text-slate-400 font-medium">设备未连接</p>
              <p className="text-[10px] text-slate-600 font-mono">检查 USB 线缆</p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-4 text-center space-y-2">
              <Smartphone className="w-10 h-10 text-emerald-500/80" />
              <p className="text-xs text-slate-300 font-medium">物理真机已在线</p>
              <p className="text-[10px] text-slate-500 font-mono">{device.serial}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCapture}
                disabled={capturing}
                className="h-7 px-2.5 text-[10px] bg-slate-800/80 border-slate-700 hover:bg-slate-700 text-slate-300 gap-1 mt-1"
              >
                <Camera className={`w-3 h-3 ${capturing ? 'animate-spin text-emerald-400' : ''}`} />
                {capturing ? '截屏中...' : '抓取实时屏幕'}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Device Metadata & Execution Details Below Phone (信号、步骤及额外显示均在下方) */}
      <div className="w-full mt-3.5 space-y-2.5 text-xs">
        {/* Signal & Connection Bar */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800/70 rounded-xl border border-slate-700/50 text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${isOffline ? 'bg-slate-500' : 'bg-emerald-400 animate-pulse'}`} />
            <span className="font-medium text-slate-200">
              {isOffline ? 'ADB 离线' : '物理真机在线'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-slate-400 font-mono text-[10px]">
            <div className="flex items-center gap-1">
              <Wifi className="w-3 h-3 text-emerald-400" />
              <span>5G</span>
              <span className="text-slate-500">· 100%</span>
            </div>
            <span className="text-slate-600">|</span>
            <span>{new Date(device.timestamp).toLocaleTimeString()}</span>
          </div>
        </div>

        {/* Step & Action Description */}
        <div className="p-2.5 bg-slate-950/80 border border-slate-800 rounded-xl space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-emerald-400 flex items-center gap-1">
              {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />}
              {isRunning
                ? `Step ${device.step}${device.totalSteps ? ` / ${device.totalSteps}` : ''}`
                : isBlocked
                ? '需人工介入'
                : isIdle
                ? '真机就绪待命'
                : '已离线'}
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800/90 text-slate-300 border border-slate-700/50">
              {device.action || 'standby'}
            </span>
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed min-h-[30px] line-clamp-2">
            {device.actionDesc || '物理真机已在线就绪，等待排期派发'}
          </p>
        </div>

        {/* Platform Account Binding */}
        <div className="flex items-center justify-between px-1 text-[11px] text-slate-400">
          <span>专属账号:</span>
          <span className="font-mono text-slate-200 truncate max-w-[140px]" title={device.platformIdentity}>
            {device.platformIdentity || '未绑定专属账号'}
          </span>
        </div>

        {/* Refresh Screenshot Action Button */}
        <Button
          size="sm"
          variant="outline"
          disabled={capturing || isOffline}
          onClick={handleCapture}
          className="w-full h-8 text-xs bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200 gap-1.5 rounded-xl shadow transition"
        >
          <Camera className={`w-3.5 h-3.5 ${capturing ? 'animate-spin text-emerald-400' : 'text-slate-300'}`} />
          {capturing ? '正在抓取真机屏幕...' : '刷新真机截屏'}
        </Button>
      </div>
    </div>
  );
}
