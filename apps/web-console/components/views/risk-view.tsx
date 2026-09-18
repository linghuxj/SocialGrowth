'use client';

import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { useDatabase } from '@/lib/db';
import {
  ShieldAlert,
  RefreshCw,
  KeyRound,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Search,
  Filter,
  Check,
  Send,
  X,
  FileCheck
} from 'lucide-react';

export function RiskView() {
  const {
    anomalies,
    replacementOrders,
    hitl2FaEvents,
    submit2FaVerification,
    resolveAnomalyEvent
  } = useDatabase();

  // Search & Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'resolved'>('all');

  // Interactive 2FA Modal state
  const [active2FaEventId, setActive2FaEventId] = useState<string | null>(null);
  const [twoFaCode, setTwoFaCode] = useState('');

  // Anomaly Resolution Modal state
  const [activeAnomalyId, setActiveAnomalyId] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');

  const active2FaEvent = hitl2FaEvents.find(e => e.id === active2FaEventId);
  const activeAnomaly = anomalies.find(a => a.id === activeAnomalyId);

  // Statistics
  const waiting2FaEvents = hitl2FaEvents.filter(e => e.status === 'waiting_operator');
  const resolved2FaCount = hitl2FaEvents.filter(e => e.status === 'verified').length;
  const closedAnomaliesCount = anomalies.filter(a => a.resolutionStatus === 'resolved' || a.resolutionAction).length;
  const pendingAnomaliesCount = anomalies.length - closedAnomaliesCount;

  // Filtered Anomalies
  const filteredAnomalies = anomalies.filter(anom => {
    const matchesSearch =
      anom.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      anom.deviceId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      anom.accountId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      anom.details.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesType = typeFilter === 'all' || anom.type === typeFilter;
    const isResolved = anom.resolutionStatus === 'resolved' || (anom.resolutionAction && anom.resolutionAction.length > 0);
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'resolved' && isResolved) ||
      (statusFilter === 'pending' && !isResolved);

    return matchesSearch && matchesType && matchesStatus;
  });

  const handle2FaSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!active2FaEventId || !twoFaCode.trim()) return;
    submit2FaVerification(active2FaEventId, twoFaCode.trim());
    setActive2FaEventId(null);
    setTwoFaCode('');
  };

  const handleAnomalyResolve = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAnomalyId || !resolutionNote.trim()) return;
    resolveAnomalyEvent(activeAnomalyId, resolutionNote.trim());
    setActiveAnomalyId(null);
    setResolutionNote('');
  };

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <span>模块 5：账号风控预警与冷备换号中心 (Cold-spare SOP)</span>
            <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 text-xs">
              4 类异常全生命周期追溯
            </Badge>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            建立明确异常分类（封禁受限、算法推荐限制、未知流量偏离、任务执行失败），保留真实异常证据链，支持冷备账号安全置换 SOP 与人机 2FA 接管。
          </p>
        </div>
      </div>

      {/* Urgent HITL 2FA Alert Banner */}
      {waiting2FaEvents.length > 0 && (
        <div className="p-4 bg-amber-500/10 border-2 border-amber-500/40 rounded-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500 text-slate-950 rounded-md font-bold shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <strong className="text-amber-900 font-bold text-sm">
                  【待办阻断】检测到 {waiting2FaEvents.length} 台真机在登录/发帖过程中拦截到 2FA 验证
                </strong>
                <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300 text-[10px]">
                  等待人工验码
                </Badge>
              </div>
              <p className="text-xs text-amber-800 mt-0.5">
                受影响设备: {waiting2FaEvents.map(e => `${e.deviceId} (${e.accountId})`).join('、')}。
                请运营人员使用绑定手机/Authenticator 查看 6 位动态验证码并录入系统。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setActive2FaEventId(waiting2FaEvents[0].id);
              setTwoFaCode('');
            }}
            className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs rounded shadow-xs transition-colors shrink-0"
          >
            立即录入 2FA 动态码
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-slate-200 shadow-xs">
          <CardHeader className="pb-2">
            <span className="text-xs text-slate-500 font-medium">累计识别风控异常</span>
            <CardTitle className="text-2xl font-bold text-slate-900 mt-1 flex items-center justify-between">
              <span>{anomalies.length} 起事件</span>
              <ShieldAlert className="w-5 h-5 text-rose-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">
            {closedAnomaliesCount} 起已闭环处置，{pendingAnomaliesCount} 起处于排查处置中。
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-xs">
          <CardHeader className="pb-2">
            <span className="text-xs text-slate-500 font-medium">冷备置换 SOP 闭环</span>
            <CardTitle className="text-2xl font-bold text-emerald-600 mt-1 flex items-center justify-between">
              <span>{replacementOrders.length} 次成功换号</span>
              <RefreshCw className="w-5 h-5 text-emerald-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">
            清空端侧 App 缓存后安全重绑，设备硬件零损耗。
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-xs">
          <CardHeader className="pb-2">
            <span className="text-xs text-slate-500 font-medium">HITL 2FA 协同接管</span>
            <CardTitle className="text-2xl font-bold text-blue-600 mt-1 flex items-center justify-between">
              <span>{resolved2FaCount} 次成功恢复</span>
              <KeyRound className="w-5 h-5 text-blue-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">
            {waiting2FaEvents.length > 0 ? (
              <span className="text-amber-600 font-medium">{waiting2FaEvents.length} 起工单待录入验码</span>
            ) : (
              <span>真机拦截 2FA 时自动推送工单，操作员已全部验码恢复</span>
            )}
          </CardContent>
        </Card>
      </div>

      {/* HITL 2FA Records Section */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900 flex items-center justify-between">
          <span>人机协同 2FA 验证接管流 (HITL 2FA Verification Logs)</span>
          <span className="text-xs text-slate-500 font-mono">
            {hitl2FaEvents.length} 条记录 · {waiting2FaEvents.length} 待验码
          </span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {hitl2FaEvents.map(event => (
            <div
              key={event.id}
              className={`p-3.5 rounded-lg border text-xs space-y-2 transition-all ${
                event.status === 'waiting_operator'
                  ? 'bg-amber-50/70 border-amber-300 ring-1 ring-amber-400'
                  : 'bg-white border-slate-200'
              }`}
            >
              <div className="flex justify-between items-center">
                <span className="font-mono font-bold text-slate-800">{event.id}</span>
                {event.status === 'waiting_operator' ? (
                  <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300 text-[10px]">
                    待录入验证码
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
                    已验码恢复
                  </Badge>
                )}
              </div>

              <div className="space-y-1 text-slate-600">
                <div className="flex justify-between">
                  <span className="text-slate-400">设备/账号:</span>
                  <span className="font-mono font-medium text-slate-900">{event.deviceId} · {event.accountId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">拦截类型:</span>
                  <span className="font-medium text-slate-700">
                    {event.platform === 'facebook' ? 'Meta 2FA 动态码' : 'Google Authenticator'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">拦截时间:</span>
                  <span className="font-mono text-[10px] text-slate-500">{event.requestedAt}</span>
                </div>
                {event.status === 'verified' && event.codeReceived && (
                  <div className="flex justify-between border-t border-slate-100 pt-1 text-[11px]">
                    <span className="text-slate-400">已填验证码:</span>
                    <span className="font-mono font-bold text-emerald-600 tracking-wider">
                      {event.codeReceived}
                    </span>
                  </div>
                )}
              </div>

              {event.status === 'waiting_operator' && (
                <button
                  type="button"
                  onClick={() => {
                    setActive2FaEventId(event.id);
                    setTwoFaCode('');
                  }}
                  className="w-full mt-2 py-1 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded text-xs transition-colors"
                >
                  录入 6 位验证码
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Cold Spare Replacement SOP Flow Demonstration */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900 flex items-center justify-between">
          <span>标准化冷备换号流水线 (Cold-spare Rebind SOP 实战记录)</span>
          <span className="text-xs text-slate-500 font-mono">从异常熔断至新号上线发布全流程</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {replacementOrders.map(order => (
            <div key={order.orderId} className="bg-white border border-slate-200 rounded-lg p-4 space-y-3 shadow-xs">
              <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                <div>
                  <span className="font-mono font-bold text-xs text-slate-800">{order.orderId}</span>
                  <span className="text-xs text-slate-500 block">
                    设备: {order.deviceId} · {order.platform === 'facebook' ? 'Facebook' : 'YouTube'}
                  </span>
                </div>
                <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">
                  SOP 执行完毕 (耗时 5分)
                </Badge>
              </div>

              <div className="space-y-2 text-xs">
                {order.steps.map((step, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                    <div className="flex-1 flex justify-between items-baseline">
                      <span className="text-slate-800">{step.name}</span>
                      <span className="text-slate-400 font-mono text-[10px]">{step.timestamp}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-slate-50 p-2.5 rounded text-[11px] text-slate-600 border border-slate-200 flex justify-between">
                <span>旧受限账号: <strong className="text-rose-600">{order.failedAccountId}</strong></span>
                <span>新激活冷备: <strong className="text-emerald-600">{order.newAccountId}</strong></span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Anomaly Records Table */}
      <div className="space-y-3">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              异常事件全量追溯台账（{anomalies.length} 起真实记录）
            </h3>
            <p className="text-xs text-slate-500">
              不将偶发波动推论为系统限流，必须证据闭环处置与经验归档
            </p>
          </div>

          {/* Table Filters */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="relative w-48">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="搜索设备/账号/事件..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-2.5 py-1 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="border border-slate-200 rounded-md px-2 py-1 text-xs bg-white text-slate-700"
            >
              <option value="all">全部分类</option>
              <option value="account_restriction">平台功能限制</option>
              <option value="task_timeout">看门狗执行超时</option>
              <option value="traffic_drop">流量偏离待分析</option>
              <option value="algorithmic_throttle">通知暂停限制</option>
            </select>

            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as any)}
              className="border border-slate-200 rounded-md px-2 py-1 text-xs bg-white text-slate-700"
            >
              <option value="all">全部状态</option>
              <option value="pending">待处置</option>
              <option value="resolved">已闭环</option>
            </select>
          </div>
        </div>

        <div className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-xs">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead className="text-xs font-semibold text-slate-700 w-28">事件编号</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700 w-32">受影响设备/账号</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700 w-28">异常分类</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700">异常详细诊断与依据</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700 w-64">处置结果与经验沉淀</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700 text-right w-24">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAnomalies.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-6 text-slate-400 text-xs">
                    未查找到符合条件的异常事件
                  </TableCell>
                </TableRow>
              ) : (
                filteredAnomalies.map(anom => {
                  const isResolved = anom.resolutionStatus === 'resolved' || (anom.resolutionAction && anom.resolutionAction.length > 0);
                  return (
                    <TableRow key={anom.id} className="hover:bg-slate-50/80">
                      <TableCell className="font-mono text-xs">
                        <strong className="text-slate-900 block">{anom.id}</strong>
                        <span className="text-[10px] text-slate-400">{anom.detectedAt}</span>
                      </TableCell>

                      <TableCell className="text-xs font-mono">
                        <span className="font-bold text-slate-800 block">{anom.deviceId}</span>
                        <span className="text-slate-500 text-[11px]">{anom.accountId}</span>
                      </TableCell>

                      <TableCell className="text-xs">
                        {anom.type === 'account_restriction' && (
                          <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 text-[10px]">
                            平台功能限制
                          </Badge>
                        )}
                        {anom.type === 'task_timeout' && (
                          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]">
                            看门狗执行超时
                          </Badge>
                        )}
                        {anom.type === 'traffic_drop' && (
                          <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-200 text-[10px]">
                            流量偏离待分析
                          </Badge>
                        )}
                        {anom.type === 'algorithmic_throttle' && (
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-[10px]">
                            通知暂停限制
                          </Badge>
                        )}
                      </TableCell>

                      <TableCell className="text-xs text-slate-700">
                        {anom.details}
                      </TableCell>

                      <TableCell className="text-xs">
                        {anom.resolutionAction ? (
                          <span className="text-emerald-700 font-medium block">
                            {anom.resolutionAction}
                          </span>
                        ) : (
                          <span className="text-amber-600 font-medium flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            待运营排查与录入处置方案
                          </span>
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveAnomalyId(anom.id);
                            setResolutionNote(anom.resolutionAction || '');
                          }}
                          className="px-2.5 py-1 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 border border-blue-200 rounded font-medium transition-colors"
                        >
                          {isResolved ? '编辑处置' : '处置归档'}
                        </button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* 2FA Verification Modal */}
      {active2FaEvent && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-5 shadow-xl border border-slate-200 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-blue-600" />
                <h3 className="font-bold text-sm text-slate-900">
                  录入 2FA 动态验证码 · HITL 接管
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActive2FaEventId(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-slate-50 p-3 rounded text-xs space-y-1 border border-slate-200 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-500">工单号:</span>
                <span className="font-bold text-slate-800">{active2FaEvent.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">目标真机:</span>
                <span className="text-slate-800">{active2FaEvent.deviceId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">拦截账号:</span>
                <span className="text-slate-800">{active2FaEvent.accountId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">挑战方式:</span>
                <span className="text-slate-800">
                  {active2FaEvent.platform === 'facebook' ? 'Meta 2FA 动态码' : 'Google Authenticator'}
                </span>
              </div>
            </div>

            <form onSubmit={handle2FaSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  请输入 6 位动态验证码 (SMS / Google Authenticator)
                </label>
                <input
                  type="text"
                  maxLength={6}
                  autoFocus
                  placeholder="例如: 849201"
                  value={twoFaCode}
                  onChange={e => setTwoFaCode(e.target.value.replace(/\D/g, ''))}
                  className="w-full text-center text-2xl font-mono tracking-widest py-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  提交后，Artemis 群控引擎将通过 ADB input text 将验证码注入真机并提交。
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setActive2FaEventId(null)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={twoFaCode.length < 6}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded shadow-xs"
                >
                  注入验证码并恢复任务
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Anomaly Resolution Modal */}
      {activeAnomaly && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-lg w-full p-5 shadow-xl border border-slate-200 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-emerald-600" />
                <h3 className="font-bold text-sm text-slate-900">
                  异常排查闭环处置 · 经验归档
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveAnomalyId(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-slate-50 p-3 rounded text-xs space-y-1.5 border border-slate-200">
              <div className="flex justify-between font-mono">
                <span className="text-slate-500">异常编号:</span>
                <span className="font-bold text-slate-800">{activeAnomaly.id}</span>
              </div>
              <div className="flex justify-between font-mono">
                <span className="text-slate-500">设备与账号:</span>
                <span className="text-slate-800">{activeAnomaly.deviceId} ({activeAnomaly.accountId})</span>
              </div>
              <div>
                <span className="text-slate-500 block mb-0.5">异常现象与日志依据:</span>
                <span className="text-slate-800 font-medium block">{activeAnomaly.details}</span>
              </div>
            </div>

            <form onSubmit={handleAnomalyResolve} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  处置措施与复盘结论 (将沉淀为团队经验库)
                </label>
                <textarea
                  rows={4}
                  autoFocus
                  required
                  placeholder="例如: 已完成冷备账号置换，执行清除缓存操作；后续将单日发布频次由 3 条下调至 2 条并持续监测 48 小时..."
                  value={resolutionNote}
                  onChange={e => setResolutionNote(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setActiveAnomalyId(null)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded shadow-xs"
                >
                  保存处置结论并闭环
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

