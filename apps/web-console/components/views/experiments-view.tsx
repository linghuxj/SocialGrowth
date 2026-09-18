'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { experiments, dualTrackStats } from '@/lib/db';
import { GitCompare, CheckCircle2, RotateCcw, Database, TrendingUp, AlertCircle } from 'lucide-react';

export function ExperimentsView() {
  const dt = dualTrackStats;

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <span>模块 7：数据采集与 A/B 策略优化闭环大屏</span>
            <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200 text-xs">
              双轨数据采集 / 小样本加权算法
            </Badge>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            打通社媒官方 API 与第三方数据服务双轨采集机制。针对前 3 个月小样本环境采用综合绩效加权评分模型，支持达标全量晋级与不佳一键安全回退 (Rollback)。
          </p>
        </div>
      </div>

      {/* Dual Track Architecture Callout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3 shadow-xs">
          <div className="flex justify-between items-center border-b border-slate-100 pb-2">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <Database className="w-4 h-4 text-blue-600" />
              数据双轨采集与保底降级机制
            </span>
            <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
              主备无缝切换
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 bg-slate-50 rounded border border-slate-200">
              <span className="text-slate-500 block text-[11px] mb-1">主通道：社媒官方 API</span>
              <strong className="text-xl font-bold text-slate-900 font-mono">{(dt.officialApiShare * 100).toFixed(1)}%</strong>
              <span className="text-slate-400 block text-[10px] mt-1">FB Page Insights / YT Analytics</span>
            </div>

            <div className="p-3 bg-slate-50 rounded border border-slate-200">
              <span className="text-slate-500 block text-[11px] mb-1">保底通道：第三方数据服务</span>
              <strong className="text-xl font-bold text-purple-600 font-mono">{(dt.thirdPartyFallbackShare * 100).toFixed(1)}%</strong>
              <span className="text-slate-400 block text-[10px] mt-1">权限受限/时滞时全量接管兜底</span>
            </div>
          </div>

          <p className="text-xs text-slate-600 bg-slate-50 p-2 rounded border border-slate-200 leading-relaxed">
            <strong>保底准则</strong>：在官方 API 权限审核延迟或数据回调滞后时，系统无缝降级为第三方社媒数据服务，以公开互动指标加权打分，严禁因缺字段抛出异常。
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3 shadow-xs">
          <div className="flex justify-between items-center border-b border-slate-100 pb-2">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-purple-600" />
              小样本综合绩效加权评分模型 (Composite Score)
            </span>
            <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200">
              非 p-value 假设检验
            </Badge>
          </div>

          <div className="space-y-2 text-xs font-mono">
            <div className="bg-slate-900 text-slate-200 p-2 rounded text-[11px]">
              <span className="text-purple-400 block font-bold mb-0.5">标准完播私有指标加权公式：</span>
              <code>Score = CompletionRate*0.4 + EngagementRate*0.3 + ClickThroughRate*0.3</code>
            </div>

            <div className="bg-slate-900 text-slate-200 p-2 rounded text-[11px]">
              <span className="text-amber-400 block font-bold mb-0.5">第三方公开指标降级打分公式：</span>
              <code>Score_pub = DeltaViews*0.7 + (Likes*1.5 + Comments*2.0 + Shares*3.0)*0.3</code>
            </div>
          </div>

          <div className="text-[11px] text-slate-500 flex justify-between">
            <span>实验晋级阈值：7~14天窗口超越基线组 15%</span>
            <span className="text-emerald-600 font-semibold">达标一键推广 / 恶化一键回退</span>
          </div>
        </div>
      </div>

      {/* A/B Experiments Comparison Details */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-900 flex items-center justify-between">
          <span>前 3 个月量化 A/B 策略实验实盘闭环结果</span>
          <span className="text-xs text-slate-500">对照组（基线组） vs 实验组（10%~20% 样本）</span>
        </h3>

        <div className="space-y-4">
          {experiments.map(exp => (
            <div key={exp.experimentId} className="bg-white border border-slate-200 rounded-lg p-5 space-y-4 shadow-xs">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-100 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-xs text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                      {exp.experimentId}
                    </span>
                    <strong className="text-base text-slate-900">{exp.name}</strong>
                  </div>
                  <span className="text-xs text-slate-500 block mt-1">假设：{exp.hypothesis}</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-slate-500">{exp.observationDays} 天观察窗口</span>
                  {exp.status === 'promoted' && (
                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs flex items-center gap-1 font-semibold">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      已全量晋级 (+{exp.scoreLiftPercent}%)
                    </Badge>
                  )}
                  {exp.status === 'rolled_back' && (
                    <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 text-xs flex items-center gap-1 font-semibold">
                      <RotateCcw className="w-3.5 h-3.5" />
                      已安全回退 ({exp.scoreLiftPercent}%)
                    </Badge>
                  )}
                </div>
              </div>

              {/* Data Comparison Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Baseline */}
                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2 text-xs">
                  <div className="flex justify-between items-center text-slate-600 font-semibold border-b border-slate-200 pb-1.5">
                    <span>对照基线组 (Baseline)</span>
                    <span className="font-mono text-slate-800">{exp.baselineGroup.accountCount} 个账号</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">平均完播率 (Completion):</span>
                    <span className="font-mono font-semibold text-slate-800">{(exp.baselineGroup.avgCompletionRate * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">互动率 (Engagement):</span>
                    <span className="font-mono font-semibold text-slate-800">{(exp.baselineGroup.avgEngagementRate * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-1.5">
                    <span className="text-slate-700 font-semibold">综合绩效得分 (Score):</span>
                    <span className="font-mono font-bold text-slate-900 text-sm">{exp.baselineGroup.compositeScore}</span>
                  </div>
                </div>

                {/* Experiment */}
                <div className={`p-3.5 rounded-lg border space-y-2 text-xs ${exp.status === 'promoted' ? 'bg-purple-50/50 border-purple-200' : 'bg-rose-50/50 border-rose-200'}`}>
                  <div className="flex justify-between items-center font-semibold border-b border-slate-200 pb-1.5">
                    <span className={exp.status === 'promoted' ? 'text-purple-900' : 'text-rose-900'}>
                      实验测试组 (Experiment)
                    </span>
                    <span className="font-mono text-slate-800">{exp.experimentGroup.accountCount} 个账号</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">平均完播率 (Completion):</span>
                    <span className="font-mono font-semibold text-slate-800">{(exp.experimentGroup.avgCompletionRate * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">互动率 (Engagement):</span>
                    <span className="font-mono font-semibold text-slate-800">{(exp.experimentGroup.avgEngagementRate * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-1.5">
                    <span className="font-semibold text-slate-900">综合绩效得分 (Score):</span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-bold text-slate-900 text-sm">{exp.experimentGroup.compositeScore}</span>
                      <span className={`text-[11px] font-bold font-mono ${exp.scoreLiftPercent > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        ({exp.scoreLiftPercent > 0 ? '+' : ''}{exp.scoreLiftPercent}%)
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Conclusion & Action Receipt */}
              <div className="bg-slate-50 p-3 rounded border border-slate-200 text-xs flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                <span className="text-slate-700 leading-relaxed">
                  <strong>复盘与操作结论</strong>：{exp.conclusion}
                </span>

                {exp.status === 'promoted' ? (
                  <Button size="sm" disabled className="h-7 text-xs bg-emerald-600 text-white shrink-0">
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                    已晋级为主基线策略
                  </Button>
                ) : (
                  <Button size="sm" disabled variant="outline" className="h-7 text-xs border-rose-300 text-rose-700 shrink-0">
                    <RotateCcw className="w-3.5 h-3.5 mr-1" />
                    已回退至上个稳定版本
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
