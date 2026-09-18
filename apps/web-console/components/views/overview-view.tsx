'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useDatabase } from '@/lib/db';
import { Button } from '@/components/ui/button';
import {
  Smartphone,
  Lock,
  Link2,
  GitCompare,
  AlertTriangle,
  CheckCircle2,
  Sliders,
  ShieldAlert,
  ArrowRight,
  Download,
  KeyRound
} from 'lucide-react';

export function OverviewView({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const db = useDatabase();
  const { summary, clipVaultStats, shortlinkStats, pendingReviewCount, pending2FaCount, warningDeviceCount } = db;

  return (
    <div className="space-y-6">
      {/* Top Banner: 3-month Milestone Announcement */}
      <div className="bg-slate-900 text-white rounded-lg p-6 border border-slate-800 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-mono font-medium text-emerald-400 uppercase tracking-wider">
              System Benchmark · v2.0-20260918
            </span>
            <Badge variant="outline" className="text-xs border-slate-700 text-slate-300">
              海外真实物理部署
            </Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white mb-1">
            SocialGrowth Web 运营平台 · 前 3 个月成果总览
          </h1>
          <p className="text-sm text-slate-400 max-w-3xl leading-relaxed">
            已完成首批 3~5 台真机最小闭环验证、第 2 个月平滑爬坡及第 3 个月末 20 台纯真机规模化部署。全面落地 1:1 账号强绑定、切片素材排他独占锁、双轨数据采集降级及小样本 A/B 策略实验闭环。
          </p>
        </div>

        <div className="flex flex-wrap gap-2 text-xs font-mono">
          <div className="bg-slate-800 px-3 py-2 rounded border border-slate-700">
            <span className="text-slate-400 block text-[11px]">真机底座</span>
            <span className="font-semibold text-emerald-400">100% Samsung S23</span>
          </div>
          <div className="bg-slate-800 px-3 py-2 rounded border border-slate-700">
            <span className="text-slate-400 block text-[11px]">虚拟化运行态</span>
            <span className="font-semibold text-rose-400">0 实例 (纯物理真机)</span>
          </div>
          <div className="bg-slate-800 px-3 py-2 rounded border border-slate-700">
            <span className="text-slate-400 block text-[11px]">排他独占拦截</span>
            <span className="font-semibold text-amber-400">100% 独占防重</span>
          </div>
        </div>
      </div>

      {/* Operator Action Center (今日运营待办与紧急行动中枢) */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-200 pb-2.5">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping" />
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              今日运营作业驾驶舱 · 待办与阻塞项中枢 (Operator Action Center)
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => db.exportCurrentDatabaseJson()}
              className="h-7 text-xs bg-white flex items-center gap-1.5 border-slate-300"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>导出当前数据库快照 (JSON)</span>
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Action 1: Pending Reviews */}
          <div className={`p-3 rounded-lg border flex flex-col justify-between gap-2 ${pendingReviewCount > 0 ? 'bg-indigo-50/70 border-indigo-200' : 'bg-white border-slate-200'}`}>
            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-indigo-600" />
                  <span>待审策略任务</span>
                </span>
                <Badge variant={pendingReviewCount > 0 ? 'default' : 'outline'} className={pendingReviewCount > 0 ? 'bg-indigo-600 text-white text-[10px]' : 'text-slate-500 text-[10px]'}>
                  {pendingReviewCount} 项待办
                </Badge>
              </div>
              <p className="text-[11px] text-slate-600">
                {pendingReviewCount > 0
                  ? `存在 ${pendingReviewCount} 个未开启自主托管的账号排期需单人确认。`
                  : '今日所有排期任务均已审核通过下发。'}
              </p>
            </div>
            {pendingReviewCount > 0 ? (
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" className="h-6 text-[11px] px-2 border-indigo-300 text-indigo-700 bg-white" onClick={() => onNavigate('strategy')}>
                  查看详情
                </Button>
                <Button size="sm" className="h-6 text-[11px] px-2 bg-indigo-600 hover:bg-indigo-700 text-white" onClick={() => db.approveAllReviews()}>
                  一键批量通过
                </Button>
              </div>
            ) : (
              <div className="text-[10px] text-emerald-600 font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> 队列畅通无积压
              </div>
            )}
          </div>

          {/* Action 2: HITL 2FA Verification */}
          <div className={`p-3 rounded-lg border flex flex-col justify-between gap-2 ${pending2FaCount > 0 ? 'bg-rose-50/70 border-rose-200' : 'bg-white border-slate-200'}`}>
            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-rose-600" />
                  <span>HITL 2FA 协同接管</span>
                </span>
                <Badge variant={pending2FaCount > 0 ? 'destructive' : 'outline'} className="text-[10px]">
                  {pending2FaCount} 起待录入
                </Badge>
              </div>
              <p className="text-[11px] text-slate-600">
                {pending2FaCount > 0
                  ? '检测到真机在登录/换号过程中触发双重验证，需人工输入动态码。'
                  : '所有真机登录会话与 2FA 凭证有效，无阻断事件。'}
              </p>
            </div>
            {pending2FaCount > 0 ? (
              <Button size="sm" className="h-6 text-[11px] px-2 bg-rose-600 hover:bg-rose-700 text-white w-fit" onClick={() => onNavigate('risk')}>
                立即录入验证码 <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
            ) : (
              <div className="text-[10px] text-emerald-600 font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> 凭证认证正常
              </div>
            )}
          </div>

          {/* Action 3: Warning Devices */}
          <div className={`p-3 rounded-lg border flex flex-col justify-between gap-2 ${warningDeviceCount > 0 ? 'bg-amber-50/70 border-amber-200' : 'bg-white border-slate-200'}`}>
            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                  <span>硬件与巡检告警</span>
                </span>
                <Badge variant="outline" className={warningDeviceCount > 0 ? 'border-amber-300 text-amber-700 bg-amber-100 text-[10px]' : 'text-slate-500 text-[10px]'}>
                  {warningDeviceCount} 台待巡检
                </Badge>
              </div>
              <p className="text-[11px] text-slate-600">
                {warningDeviceCount > 0
                  ? `设备 dev-007、dev-014 网络延迟或温控偏离基线，需重点排查。`
                  : '全部 20 台真机硬件指标均处于绿区标准。'}
              </p>
            </div>
            <Button size="sm" variant="outline" className="h-6 text-[11px] px-2 border-slate-300 text-slate-700 bg-white w-fit" onClick={() => onNavigate('artemis')}>
              进入 Artemis 群控巡检 <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          </div>
        </div>
      </div>

      {/* Core KPI Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-slate-200 shadow-xs cursor-pointer hover:border-blue-400 transition-colors" onClick={() => onNavigate('matrix')}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-medium uppercase tracking-wider">真机与账号矩阵</span>
              <Smartphone className="w-4 h-4 text-blue-600" />
            </div>
            <CardTitle className="text-3xl font-bold text-slate-900 mt-1">
              20 <span className="text-sm font-normal text-slate-500">台</span> / 40 <span className="text-sm font-normal text-slate-500">号</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-600 space-y-1">
            <div className="flex justify-between">
              <span>Facebook Pages:</span>
              <span className="font-semibold text-slate-900">20 个 (1:1 独立绑定)</span>
            </div>
            <div className="flex justify-between">
              <span>YouTube 独立频道:</span>
              <span className="font-semibold text-slate-900">20 个 (1:1 独立绑定)</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Instagram 槽位:</span>
              <span>20 个 (储备置灰待接入)</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-xs cursor-pointer hover:border-amber-400 transition-colors" onClick={() => onNavigate('clips')}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-medium uppercase tracking-wider">切片发布与独占锁</span>
              <Lock className="w-4 h-4 text-amber-600" />
            </div>
            <CardTitle className="text-3xl font-bold text-slate-900 mt-1">
              3,078 <span className="text-sm font-normal text-slate-500">条有效发布</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-600 space-y-1">
            <div className="flex justify-between">
              <span>计划发布实现率:</span>
              <span className="font-semibold text-emerald-600">90.0% (3,420次计划)</span>
            </div>
            <div className="flex justify-between">
              <span>独占锁拦截搬运:</span>
              <span className="font-semibold text-amber-600">{clipVaultStats.duplicateAttemptInterceptions} 次重复拦截</span>
            </div>
            <div className="flex justify-between">
              <span>跨账号内容重复率:</span>
              <span className="font-semibold text-slate-900">0.0% (绝对排他)</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-xs cursor-pointer hover:border-cyan-400 transition-colors" onClick={() => onNavigate('shortlinks')}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-medium uppercase tracking-wider">导流短链与点击流</span>
              <Link2 className="w-4 h-4 text-cyan-600" />
            </div>
            <CardTitle className="text-3xl font-bold text-slate-900 mt-1">
              84,980 <span className="text-sm font-normal text-slate-500">次跳转</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-600 space-y-1">
            <div className="flex justify-between">
              <span>原始总点击 (Raw):</span>
              <span className="font-semibold text-slate-900">{shortlinkStats.rawClicksTotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>机器爬虫过滤:</span>
              <span className="text-slate-500">-{shortlinkStats.crawlerFilteredTotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>302 跳转有效率:</span>
              <span className="font-semibold text-emerald-600">98.6%</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-xs cursor-pointer hover:border-purple-400 transition-colors" onClick={() => onNavigate('experiments')}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-medium uppercase tracking-wider">策略实验与双轨数据</span>
              <GitCompare className="w-4 h-4 text-purple-600" />
            </div>
            <CardTitle className="text-3xl font-bold text-slate-900 mt-1">
              +18.2% <span className="text-sm font-normal text-slate-500">实验晋级</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-600 space-y-1">
            <div className="flex justify-between">
              <span>官方 API 采集:</span>
              <span className="font-semibold text-slate-900">82.4%</span>
            </div>
            <div className="flex justify-between">
              <span>第三方服务保底:</span>
              <span className="font-semibold text-slate-900">17.6% (无缝降级)</span>
            </div>
            <div className="flex justify-between">
              <span>安全回退 (Rollback):</span>
              <span className="font-semibold text-emerald-600">1 次实盘生效</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 7 Core Modules Navigation & Status Cards */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
          <span>7 大核心交付模块成熟态运行大屏</span>
          <span className="text-xs text-slate-500 font-normal">（点击任意模块卡片可直达工作台）</span>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Module 1 */}
          <Card className="border-slate-200 hover:shadow-md transition-shadow cursor-pointer" onClick={() => onNavigate('matrix')}>
            <CardHeader className="pb-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-blue-600 uppercase tracking-wider">模块 1</span>
                <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">
                  20台/40号 就绪
                </Badge>
              </div>
              <CardTitle className="text-base font-semibold text-slate-900 mt-1">
                账号矩阵与真机拓扑
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                1:1 设备专属强绑定，单台 Samsung S23 严格承载 1 FB + 1 YT，彻底杜绝同机切换多账号；5个冷备账号池就绪。
              </CardDescription>
            </CardHeader>
          </Card>

          {/* Module 2 */}
          <Card className="border-slate-200 hover:shadow-md transition-shadow cursor-pointer" onClick={() => onNavigate('clips')}>
            <CardHeader className="pb-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-amber-600 uppercase tracking-wider">模块 2</span>
                <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">
                  排他独占锁 100%
                </Badge>
              </div>
              <CardTitle className="text-base font-semibold text-slate-900 mt-1">
                切片素材库与排他锁
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                漫剧切片加注 Exclusive Lock，单切片单号唯一绑定分发，142次跨号重复调用拦截，从源头根除搬运与降权。
              </CardDescription>
            </CardHeader>
          </Card>

          {/* Module 3 */}
          <Card className="border-slate-200 hover:shadow-md transition-shadow cursor-pointer" onClick={() => onNavigate('strategy')}>
            <CardHeader className="pb-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider">模块 3</span>
                <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 text-xs">
                  75% 自主托管
                </Badge>
              </div>
              <CardTitle className="text-base font-semibold text-slate-900 mt-1">
                策略工作台与规则引擎
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                32条经验规则沉淀（约束 vs 建议），成熟账号开启自主托管无人值守发布，新号/高风险号保留单人审核流。
              </CardDescription>
            </CardHeader>
          </Card>

          {/* Module 4 */}
          <Card className="border-slate-200 hover:shadow-md transition-shadow cursor-pointer" onClick={() => onNavigate('shortlinks')}>
            <CardHeader className="pb-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-cyan-600 uppercase tracking-wider">模块 4</span>
                <Badge variant="outline" className="bg-cyan-50 text-cyan-700 border-cyan-200 text-xs">
                  3层点击过滤
                </Badge>
              </div>
              <CardTitle className="text-base font-semibold text-slate-900 mt-1">
                导流短链与防封域名池
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                自建短链 302 服务，原始访问→爬虫过滤→有效跳转三层分离；FB 帖文级单条归因，YT 频道级归因，动态防封熔断。
              </CardDescription>
            </CardHeader>
          </Card>

          {/* Module 5 */}
          <Card className="border-slate-200 hover:shadow-md transition-shadow cursor-pointer" onClick={() => onNavigate('risk')}>
            <CardHeader className="pb-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-rose-600 uppercase tracking-wider">模块 5</span>
                <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 text-xs">
                  2次换号SOP闭环
                </Badge>
              </div>
              <CardTitle className="text-base font-semibold text-slate-900 mt-1">
                账号风控与冷备换号中心
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                4类异常自动识别与任务熔断，标准化冷备置换 SOP（App缓存重置 + 凭证重绑），HITL 2FA 人机协同接管完成。
              </CardDescription>
            </CardHeader>
          </Card>

          {/* Module 6 */}
          <Card className="border-slate-200 hover:shadow-md transition-shadow cursor-pointer" onClick={() => onNavigate('artemis')}>
            <CardHeader className="pb-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider">模块 6</span>
                <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">
                  纯真机 20/20 在线
                </Badge>
              </div>
              <CardTitle className="text-base font-semibold text-slate-900 mt-1">
                Artemis 真机调度与执行底座
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                Google Artemis 原生 App UI 自动化执行（100% 纯物理真机），坐标自愈日志（Self-healing Logs）实时回显与 10min 超时自愈。
              </CardDescription>
            </CardHeader>
          </Card>

          {/* Module 7 */}
          <Card className="border-slate-200 hover:shadow-md transition-shadow cursor-pointer md:col-span-2 lg:col-span-3" onClick={() => onNavigate('experiments')}>
            <CardHeader className="pb-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-purple-600 uppercase tracking-wider">模块 7</span>
                <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200 text-xs">
                  量化 A/B 闭环 & 一键回退可用
                </Badge>
              </div>
              <CardTitle className="text-base font-semibold text-slate-900 mt-1">
                数据采集与 A/B 策略优化闭环
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                社媒官方 API + 第三方数据服务双轨采集；采用小样本综合绩效加权评分算法（Composite Score），实现 1 组实验晋级与 1 次安全回退实盘生效。
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>

      {/* Core Rules & Compliance Banner */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
        <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
          CLAUDE.md 核心架构五大铁律执行合规审计
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
          <div className="p-2.5 bg-white rounded border border-slate-200">
            <strong className="block text-slate-900 mb-1">1. 底座锁定</strong>
            <span className="text-slate-500">100% 纯物理真机，彻底杜绝任何虚拟化设备。</span>
          </div>
          <div className="p-2.5 bg-white rounded border border-slate-200">
            <strong className="block text-slate-900 mb-1">2. 平台收敛</strong>
            <span className="text-slate-500">聚焦 FB + YT 双平台；INS 作为战略储备槽位。</span>
          </div>
          <div className="p-2.5 bg-white rounded border border-slate-200">
            <strong className="block text-slate-900 mb-1">3. 1:1 设备隔离</strong>
            <span className="text-slate-500">单机同一时期仅绑 1 FB + 1 YT，严禁同 App 换号。</span>
          </div>
          <div className="p-2.5 bg-white rounded border border-slate-200">
            <strong className="block text-slate-900 mb-1">4. 切片独占锁</strong>
            <span className="text-slate-500">人工确认后锁定单账号，绝不跨号重复分发。</span>
          </div>
          <div className="p-2.5 bg-white rounded border border-slate-200">
            <strong className="block text-slate-900 mb-1">5. 双轨数据兜底</strong>
            <span className="text-slate-500">官方 API 优先，第三方服务保底，缺失指标自动降级。</span>
          </div>
        </div>
      </div>
    </div>
  );
}
