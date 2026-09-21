'use client';
/* oxlint-disable next/no-img-element */
import React, { useEffect, useState, useTransition } from 'react';
import {
  Smartphone,
  CheckCircle2,
  AlertTriangle,
  Radio,
  Clock,
  RefreshCw,
  Eye,
  Layers,
  Sparkles,
  ShieldAlert,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { runtimeRequest } from '@/lib/operations-context';

export interface DeviceStepInfo {
  deviceId: string;
  workerId: string;
  sessionId?: string;
  step: number;
  totalSteps?: number;
  type: 'post' | 'preflight' | 'verify_identity' | 'idle' | 'recovery';
  status: 'running' | 'idle' | 'blocked' | 'completed' | 'failed';
  action?: string;
  actionDesc?: string;
  imageKey?: string;
  timestamp: number;
  platform?: 'facebook' | 'youtube' | 'unknown';
  platformIdentity?: string;
  serial?: string;
}

const DEFAULT_DEVICES: DeviceStepInfo[] = [
  {
    deviceId: 'phone01',
    workerId: 'worker01',
    step: 18,
    totalSteps: 25,
    type: 'post',
    status: 'running',
    action: 'input_text',
    actionDesc: '正在输入 Facebook 帖子正文与话题标签',
    timestamp: Date.now() - 4000,
    platform: 'facebook',
    platformIdentity: 'fb_page_techpulse',
    serial: 'RFCW40MYYCV',
  },
  {
    deviceId: 'phone02',
    workerId: 'worker01',
    step: 13,
    totalSteps: 22,
    type: 'post',
    status: 'running',
    action: 'verify_identity',
    actionDesc: '核对 YouTube 频道主页身份与上传权限',
    timestamp: Date.now() - 8000,
    platform: 'youtube',
    platformIdentity: 'yt_channel_globaldigest',
    serial: 'RFCW40MY02B',
  },
  {
    deviceId: 'phone03',
    workerId: 'worker01',
    step: 0,
    type: 'idle',
    status: 'idle',
    action: 'standby',
    actionDesc: '设备空闲待命，等待下一个发布排期',
    timestamp: Date.now() - 30000,
    platform: 'facebook',
    platformIdentity: 'fb_page_entertainment',
    serial: 'RFCW40MY03C',
  },
  {
    deviceId: 'phone04',
    workerId: 'worker01',
    step: 5,
    totalSteps: 20,
    type: 'verify_identity',
    status: 'blocked',
    action: 'human_password_input',
    actionDesc: '账号触发安全验证挑战，等待运营人员人工接入',
    timestamp: Date.now() - 15000,
    platform: 'facebook',
    platformIdentity: 'fb_page_asianovels',
    serial: 'RFCW40MY04D',
  },
  {
    deviceId: 'phone05',
    workerId: 'worker01',
    step: 0,
    type: 'idle',
    status: 'idle',
    action: 'standby',
    actionDesc: '设备空闲待命，ADB 与 USB 连接正常',
    timestamp: Date.now() - 45000,
    platform: 'youtube',
    platformIdentity: 'yt_channel_shortclips',
    serial: 'RFCW40MY05E',
  },
  {
    deviceId: 'phone06',
    workerId: 'worker01',
    step: 22,
    totalSteps: 22,
    type: 'post',
    status: 'completed',
    action: 'observe_screen',
    actionDesc: '发布完成并完成 UI 树公开 URL 交叉证据比对',
    timestamp: Date.now() - 12000,
    platform: 'youtube',
    platformIdentity: 'yt_channel_dailytrend',
    serial: 'RFCW40MY06F',
  },
];

export function DeviceFarmMonitor() {
  const [devices, setDevices] = useState<Record<string, DeviceStepInfo>>(() => {
    const map: Record<string, DeviceStepInfo> = {};
    for (const d of DEFAULT_DEVICES) map[d.deviceId] = d;
    return map;
  });
  const [filter, setFilter] = useState<'all' | 'running' | 'idle' | 'blocked'>('all');
  const [connected, setConnected] = useState(false);
  const [lastPing, setLastPing] = useState(Date.now());
  const [, startTransition] = useTransition();

  // Load initial device states and connect to SSE stream
  useEffect(() => {
    let es: EventSource | null = null;
    let pollTimer: any = null;

    const fetchSnapshot = async () => {
      try {
        const res = await runtimeRequest<{ ok: boolean; devices: DeviceStepInfo[] }>('/devices/states');
        if (res.ok && Array.isArray(res.devices) && res.devices.length > 0) {
          startTransition(() => {
            setDevices((prev) => {
              const updated = { ...prev };
              for (const d of res.devices) {
                updated[d.deviceId] = { ...updated[d.deviceId], ...d };
              }
              return updated;
            });
          });
        }
      } catch {
        // Fallback to local default state
      }
    };

    void fetchSnapshot();

    // Connect SSE stream
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
              for (const d of list) updated[d.deviceId] = { ...updated[d.deviceId], ...d };
              return updated;
            });
          }
        } catch {}
      });

      es.addEventListener('step', (evt) => {
        try {
          const event: DeviceStepInfo = JSON.parse(evt.data);
          setLastPing(Date.now());
          setDevices((prev) => ({
            ...prev,
            [event.deviceId]: {
              ...(prev[event.deviceId] ?? {}),
              ...event,
            },
          }));
        } catch {}
      });
    } catch {
      // Fallback poll
      pollTimer = setInterval(fetchSnapshot, 3000);
    }

    return () => {
      if (es) es.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, []);

  const deviceList = Object.values(devices).filter((d) => {
    if (filter === 'all') return true;
    return d.status === filter;
  });

  const totalCount = Object.keys(devices).length;
  const runningCount = Object.values(devices).filter((d) => d.status === 'running').length;
  const idleCount = Object.values(devices).filter((d) => d.status === 'idle').length;
  const blockedCount = Object.values(devices).filter((d) => d.status === 'blocked').length;

  // Simulate a step event for demonstration / verification
  const simulateStep = async () => {
    const target = devices['phone01'] || DEFAULT_DEVICES[0];
    const nextStep = (target.step || 0) + 1;
    const actions = [
      '正在输入帖子正文与话题标签',
      '正在选择媒体库指定视频切片',
      '正在核验主页发帖身份与权限',
      '正在勾选 AI 标识与受众公开选项',
      '核验最终预览画面与发布按钮',
    ];
    const actionDesc = actions[nextStep % actions.length];

    try {
      await runtimeRequest('/events/step', {
        workerId: 'worker01',
        deviceId: 'phone01',
        sessionId: 'sess_live_demo',
        step: nextStep,
        totalSteps: 25,
        type: 'post',
        status: 'running',
        action: 'input_text',
        actionDesc,
        timestamp: Date.now(),
      });
    } catch {
      // Local fallback
      setDevices((prev) => ({
        ...prev,
        phone01: {
          ...prev.phone01,
          step: nextStep,
          actionDesc,
          timestamp: Date.now(),
        },
      }));
    }
  };

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
                  Worker 01 调度节点 · 实时 Step 截屏与真机状态流 (MinIO WebP 存储)
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
                全部 ({totalCount})
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
                空闲 ({idleCount})
              </button>
              <button
                onClick={() => setFilter('blocked')}
                className={`px-3 py-1.5 rounded-lg font-medium transition ${
                  filter === 'blocked' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                阻断 ({blockedCount})
              </button>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={simulateStep}
              className="bg-indigo-950/60 border-indigo-700/50 text-indigo-300 hover:bg-indigo-900 hover:text-white text-xs gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              模拟真机步骤更新
            </Button>
          </div>
        </div>

        {/* Status Indicators Ribbon */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-800/80 text-xs">
          <div className="flex items-center gap-2 text-slate-300">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
            <span>执行中真机：<strong className="text-white font-semibold">{runningCount}</strong> 台</span>
          </div>
          <div className="flex items-center gap-2 text-slate-300">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-500" />
            <span>待命中真机：<strong className="text-white font-semibold">{idleCount}</strong> 台</span>
          </div>
          <div className="flex items-center gap-2 text-slate-300">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
            <span>需人工介入：<strong className="text-rose-400 font-semibold">{blockedCount}</strong> 台</span>
          </div>
          <div className="flex items-center gap-2 text-slate-300">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            <span>对象存储：<strong className="text-white font-semibold">MinIO (WebP) 正常</strong></span>
          </div>
        </div>
      </div>

      {/* Device Farm Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6">
        {deviceList.map((device) => (
          <PhoneCard key={device.deviceId} device={device} />
        ))}
      </div>
    </div>
  );
}

function PhoneCard({ device }: { device: DeviceStepInfo }) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  const isRunning = device.status === 'running';
  const isBlocked = device.status === 'blocked';
  const isIdle = device.status === 'idle';
  const isCompleted = device.status === 'completed';

  const imageUrl = device.imageKey
    ? `/api/runtime/screenshots/${device.imageKey}`
    : undefined;

  return (
    <div
      className={`relative flex flex-col items-center p-4 rounded-3xl transition-all duration-300 border ${
        isBlocked
          ? 'bg-rose-950/20 border-rose-600/40 shadow-rose-950/30 shadow-lg'
          : isRunning
          ? 'bg-slate-900/60 border-slate-800 hover:border-emerald-500/40 hover:shadow-emerald-950/20 shadow-md'
          : 'bg-slate-900/40 border-slate-800/80 hover:border-slate-700'
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
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            <Smartphone className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-slate-100 uppercase tracking-wide">
              {device.deviceId}
            </h3>
            <p className="text-[11px] text-slate-400 font-mono">{device.serial || 'Samsung S23'}</p>
          </div>
        </div>

        {/* Platform Badge */}
        <div className="flex items-center gap-1.5">
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
              device.platform === 'facebook'
                ? 'bg-blue-950/80 text-blue-300 border border-blue-800/50'
                : device.platform === 'youtube'
                ? 'bg-red-950/80 text-red-300 border border-red-800/50'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            {device.platform === 'facebook' ? 'FB Page' : device.platform === 'youtube' ? 'YT Shorts' : '平台'}
          </span>
          <span
            className={`text-[11px] font-semibold px-2 py-0.5 rounded-md flex items-center gap-1 ${
              isRunning
                ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/50'
                : isBlocked
                ? 'bg-rose-950 text-rose-300 border border-rose-700/60 animate-pulse'
                : isCompleted
                ? 'bg-blue-950/80 text-blue-300 border border-blue-700/50'
                : 'bg-slate-800/80 text-slate-400 border border-slate-700/50'
            }`}
          >
            {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />}
            {isBlocked && <AlertTriangle className="w-3 h-3 text-rose-400" />}
            {isCompleted && <CheckCircle2 className="w-3 h-3 text-blue-400" />}
            {isRunning
              ? `Step ${device.step}`
              : isBlocked
              ? '需介入'
              : isCompleted
              ? '已完成'
              : '闲置'}
          </span>
        </div>
      </div>

      {/* Realistic Phone Frame Outer Bezel */}
      <div className="relative w-[210px] h-[410px] rounded-[38px] p-2.5 bg-gradient-to-b from-slate-700 via-slate-800 to-slate-900 shadow-2xl border border-slate-600/40 flex flex-col items-center">
        {/* Phone Speaker & Camera Notch */}
        <div className="absolute top-2 w-full flex justify-center items-center gap-1.5 z-20 pointer-events-none">
          <div className="w-8 h-1 bg-slate-950 rounded-full" />
          <div className="w-2.5 h-2.5 rounded-full bg-slate-950 border border-slate-800/80 shadow-inner" />
        </div>

        {/* Screen Bezel (Inner OLED Screen) */}
        <div className="relative w-full h-full rounded-[28px] overflow-hidden bg-slate-950 flex flex-col justify-between border border-slate-900/90 shadow-inner">
          {/* Top In-screen Status Bar */}
          <div className="w-full px-3 py-1 flex items-center justify-between text-[10px] text-slate-400 z-10 bg-gradient-to-b from-black/80 to-transparent">
            <span>09:41</span>
            <div className="flex items-center gap-1">
              <Radio className="w-2.5 h-2.5" />
              <span>5G</span>
              <span className="text-[9px]">100%</span>
            </div>
          </div>

          {/* Screen Content: Live Screenshot vs Idle Standby */}
          <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
            {imageUrl && !imgError ? (
              <img
                src={imageUrl}
                alt={`Screenshot for ${device.deviceId}`}
                onLoad={() => setImgLoaded(true)}
                onError={() => setImgError(true)}
                className={`w-full h-full object-cover transition-opacity duration-300 ${
                  imgLoaded ? 'opacity-100' : 'opacity-20'
                }`}
              />
            ) : isRunning ? (
              <div className="flex flex-col items-center justify-center p-4 text-center space-y-2">
                <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin opacity-80" />
                <p className="text-xs text-emerald-300 font-medium">画面实时刷新中...</p>
                <p className="text-[10px] text-slate-500 font-mono">Step {device.step}</p>
              </div>
            ) : isBlocked ? (
              <div className="flex flex-col items-center justify-center p-4 text-center space-y-3 bg-rose-950/40">
                <ShieldAlert className="w-10 h-10 text-rose-400 animate-bounce" />
                <div className="space-y-1">
                  <p className="text-xs text-rose-300 font-bold">登录/验证挑战</p>
                  <p className="text-[10px] text-rose-200/80 leading-relaxed">
                    当前应用触发人工验证
                  </p>
                </div>
                <a
                  href="#/receipts"
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-[11px] font-semibold transition shadow"
                >
                  去处理
                </a>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-4 text-center space-y-2 opacity-60">
                <Smartphone className="w-10 h-10 text-slate-500" />
                <p className="text-xs text-slate-400 font-medium">设备待命中</p>
                <p className="text-[10px] text-slate-600 font-mono">1:1 专属账号已锁定</p>
              </div>
            )}
          </div>

          {/* Bottom Screen Overlay: Current Step & Action Pill */}
          <div className="relative z-10 p-2 bg-gradient-to-t from-black/90 via-black/70 to-transparent">
            <div className="bg-slate-900/90 border border-slate-700/60 rounded-xl p-2 backdrop-blur">
              <div className="flex items-center justify-between text-[10px] text-slate-300 mb-0.5">
                <span className="font-semibold text-emerald-400">
                  {isRunning ? `Step ${device.step}${device.totalSteps ? ` / ${device.totalSteps}` : ''}` : device.status}
                </span>
                <span className="text-[9px] text-slate-400 font-mono">
                  {new Date(device.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-[11px] text-slate-200 line-clamp-2 leading-tight">
                {device.actionDesc || '无详细操作信息'}
              </p>
            </div>
            {/* Phone Home Bar */}
            <div className="w-16 h-1 bg-slate-500 rounded-full mx-auto mt-2 opacity-70" />
          </div>
        </div>
      </div>

      {/* Card Footer Details */}
      <div className="w-full mt-3 px-2 text-xs space-y-1">
        <div className="flex items-center justify-between text-slate-400">
          <span>绑定身份:</span>
          <span className="font-mono text-slate-200 truncate max-w-[140px]">
            {device.platformIdentity || '未绑定'}
          </span>
        </div>
        <div className="flex items-center justify-between text-slate-400">
          <span>执行动作:</span>
          <span className="font-mono text-slate-300 truncate max-w-[140px]">
            {device.action || 'standby'}
          </span>
        </div>
      </div>
    </div>
  );
}
