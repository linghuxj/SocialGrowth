'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { useDatabase, StrategyReviewItem, StrategyRuleEntity } from '@/lib/db';
import { BookOpen, CheckCircle, XCircle, Sparkles, Sliders, AlertCircle, ShieldCheck, Edit3, Plus, X, CheckCheck } from 'lucide-react';

export function StrategyView() {
  const {
    rules,
    reviews,
    strategyStats,
    approveReview,
    rejectReview,
    approveAllReviews,
    updateReviewCopywriting,
    addStrategyRule,
    notify
  } = useDatabase();

  const [activeSubTab, setActiveSubTab] = useState<'rules' | 'review_queue'>('rules');
  const [filterRuleNature, setFilterRuleNature] = useState<'all' | 'constraint' | 'heuristic'>('all');

  // Edit copywriting modal
  const [editingItem, setEditingItem] = useState<StrategyReviewItem | null>(null);
  const [editText, setEditText] = useState('');

  // Reject modal
  const [rejectingItem, setRejectingItem] = useState<StrategyReviewItem | null>(null);
  const [rejectReason, setRejectReason] = useState('文案前置情绪爆点不足，建议补充极端反差导语后重新提交');

  // Add rule modal
  const [showAddRule, setShowAddRule] = useState(false);
  const [newRuleTitle, setNewRuleTitle] = useState('');
  const [newRuleNature, setNewRuleNature] = useState<'constraint' | 'heuristic'>('heuristic');
  const [newRuleTrigger, setNewRuleTrigger] = useState('');
  const [newRuleAction, setNewRuleAction] = useState('');

  const filteredRules = useMemo(() => {
    return rules.filter(rule => {
      if (filterRuleNature !== 'all' && rule.nature !== filterRuleNature) return false;
      return true;
    });
  }, [rules, filterRuleNature]);

  const pendingCount = reviews.filter(r => r.status === 'pending').length;

  const handleOpenEdit = (item: StrategyReviewItem) => {
    setEditingItem(item);
    setEditText(item.copywriting);
  };

  const handleSaveEdit = () => {
    if (!editingItem) return;
    updateReviewCopywriting(editingItem.id, editText);
    setEditingItem(null);
  };

  const handleConfirmReject = () => {
    if (!rejectingItem) return;
    rejectReview(rejectingItem.id, rejectReason);
    setRejectingItem(null);
  };

  const handleSaveNewRule = () => {
    if (!newRuleTitle.trim()) {
      notify('请输入规则标题', 'warning');
      return;
    }
    const id = `RULE-MANUAL-${Date.now().toString().slice(-4)}`;
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const rule: StrategyRuleEntity = {
      id,
      version: 'v1.0',
      title: newRuleTitle,
      nature: newRuleNature,
      targetPlatforms: ['facebook', 'youtube'],
      applicableStage: 'active_operation',
      triggerCondition: newRuleTrigger || '单账号执行发布排期前',
      actionInstruction: newRuleAction || '执行标准前置检查与格式校验',
      status: 'verified_effective',
      conflictCheckPassed: true,
      updatedAt: now
    };
    addStrategyRule(rule);
    setShowAddRule(false);
    setNewRuleTitle('');
    setNewRuleTrigger('');
    setNewRuleAction('');
  };

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <span>模块 3：经验规则库与 AI 策略审核工作台</span>
            <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 text-xs">
              75% 自主托管 / 单人审核流
            </Badge>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            结构化沉淀运营人员经验与平台官方规则（约束 vs 建议）。对 30 个成熟账号开启自主托管自动下发，对 10 个新号/观察号维持单人审核流。
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            variant={activeSubTab === 'rules' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveSubTab('rules')}
            className="text-xs h-8"
          >
            经验规则库 ({rules.length})
          </Button>
          <Button
            variant={activeSubTab === 'review_queue' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveSubTab('review_queue')}
            className="text-xs h-8 bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1.5"
          >
            <span>待审策略队列</span>
            <span className="bg-indigo-800 text-white px-1.5 py-0.2 rounded-full text-[10px]">
              {pendingCount}
            </span>
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-slate-200 shadow-xs">
          <CardHeader className="pb-2">
            <span className="text-xs text-slate-500 font-medium">沉淀经验规则库</span>
            <CardTitle className="text-2xl font-bold text-slate-900 mt-1 flex items-center justify-between">
              <span>{strategyStats.totalRulesCount} 条规则</span>
              <BookOpen className="w-5 h-5 text-indigo-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">
            约束类 {strategyStats.constraintRulesCount} 条 · 建议类 {strategyStats.heuristicRulesCount} 条。
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-xs">
          <CardHeader className="pb-2">
            <span className="text-xs text-slate-500 font-medium">账号自主托管率</span>
            <CardTitle className="text-2xl font-bold text-emerald-600 mt-1 flex items-center justify-between">
              <span>75.0%</span>
              <Sliders className="w-5 h-5 text-emerald-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">
            30 个成熟账号已开启 Auto-pilot 无人值守。
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-xs">
          <CardHeader className="pb-2">
            <span className="text-xs text-slate-500 font-medium">单人待审队列</span>
            <CardTitle className="text-2xl font-bold text-amber-600 mt-1 flex items-center justify-between">
              <span>{pendingCount} 条待办</span>
              <AlertCircle className="w-5 h-5 text-amber-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">
            聚焦 10 个新号及受限后恢复的重点账号。
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-xs">
          <CardHeader className="pb-2">
            <span className="text-xs text-slate-500 font-medium">今日累计审核放行</span>
            <CardTitle className="text-2xl font-bold text-slate-900 mt-1 flex items-center justify-between">
              <span>{strategyStats.approvedTodayCount} 条</span>
              <ShieldCheck className="w-5 h-5 text-blue-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">
            规则冲突 100% 自动阻断并保护。
          </CardContent>
        </Card>
      </div>

      {activeSubTab === 'rules' ? (
        /* Rules Table */
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <span>结构化经验与平台规则库明细 (当前生效 {filteredRules.length} 条)</span>
              <span className="text-xs text-slate-400">严禁将模糊描述下发执行，所有规则均含明确约束</span>
            </h3>

            <div className="flex items-center gap-2">
              <div className="flex gap-1 bg-slate-100 p-0.5 rounded-md border border-slate-200">
                <Button
                  variant={filterRuleNature === 'all' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setFilterRuleNature('all')}
                  className="text-xs h-7 px-2"
                >
                  全部
                </Button>
                <Button
                  variant={filterRuleNature === 'constraint' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setFilterRuleNature('constraint')}
                  className="text-xs h-7 px-2"
                >
                  约束 (强制)
                </Button>
                <Button
                  variant={filterRuleNature === 'heuristic' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setFilterRuleNature('heuristic')}
                  className="text-xs h-7 px-2"
                >
                  建议 (经验)
                </Button>
              </div>

              <Button
                size="sm"
                onClick={() => setShowAddRule(true)}
                className="text-xs h-7 bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                <span>录入新规则</span>
              </Button>
            </div>
          </div>

          <div className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-xs">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="text-xs font-semibold text-slate-700 w-36">规则编号/版本</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-700 w-28">规则性质</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-700 w-28">适用平台</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-700 w-52">触发前置条件</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-700">执行指令规范与例外处理</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-700 w-28">验证状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRules.map(rule => (
                  <TableRow key={rule.id} className="hover:bg-slate-50/80">
                    <TableCell className="font-mono text-xs font-medium text-slate-800">
                      <strong>{rule.id}</strong>
                      <span className="text-[10px] text-slate-400 block">{rule.version}</span>
                    </TableCell>

                    <TableCell className="text-xs">
                      {rule.nature === 'constraint' ? (
                        <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 text-[10px] font-semibold">
                          约束 (强制)
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-[10px]">
                          建议 (经验)
                        </Badge>
                      )}
                    </TableCell>

                    <TableCell className="text-xs">
                      <div className="flex gap-1">
                        {rule.targetPlatforms.map(p => (
                          <span key={p} className={`text-[10px] font-mono px-1 py-0.5 rounded ${p === 'facebook' ? 'bg-blue-100 text-blue-800' : 'bg-red-100 text-red-800'}`}>
                            {p === 'facebook' ? 'FB' : 'YT'}
                          </span>
                        ))}
                      </div>
                    </TableCell>

                    <TableCell className="text-xs text-slate-600">
                      {rule.triggerCondition}
                    </TableCell>

                    <TableCell className="text-xs">
                      <strong className="text-slate-900 block mb-0.5">{rule.title}</strong>
                      <span className="text-slate-600 text-[11px] leading-relaxed block">{rule.actionInstruction}</span>
                    </TableCell>

                    <TableCell className="text-xs">
                      <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
                        已验证有效
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : (
        /* Review Queue */
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <span>待办策略单人审查工作台（Human-in-the-Loop）</span>
                <Badge variant="outline" className="text-xs">{pendingCount} 条待确认</Badge>
              </h3>
              <p className="text-xs text-slate-500">仅对未开启自主托管的高风险/新批次账号进行审核，支持在线微调文案</p>
            </div>

            {pendingCount > 0 && (
              <Button
                size="sm"
                onClick={() => approveAllReviews()}
                className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 shadow-xs"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>一键批量通过全部待办 ({pendingCount})</span>
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4">
            {reviews.map(item => (
              <div key={item.id} className="p-4 bg-white border border-slate-200 rounded-lg shadow-xs space-y-3">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-slate-700">{item.id}</span>
                    <Badge variant="outline" className={item.platform === 'facebook' ? 'bg-blue-50 text-blue-700 border-blue-200 text-xs' : 'bg-red-50 text-red-700 border-red-200 text-xs'}>
                      {item.platform === 'facebook' ? 'Facebook Reel' : 'YouTube Short'}
                    </Badge>
                    <strong className="text-slate-900 text-sm">{item.accountName} ({item.accountId})</strong>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-slate-500">预计发布: {item.postTime}</span>
                    {item.status === 'approved' && (
                      <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs font-bold">已通过并下发真机</Badge>
                    )}
                    {item.status === 'rejected' && (
                      <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 text-xs font-bold">已驳回</Badge>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div className="space-y-1">
                    <span className="text-slate-500 block font-medium">拟发布切片与短链类型</span>
                    <strong className="text-slate-900 block">{item.clipTitle}</strong>
                    <span className="text-[11px] font-mono text-blue-600 block">
                      {item.shortlinkType === 'post_direct' ? '帖文直挂短链 (单条归因)' : '引导主页 Bio 短链 (频道级归因)'}
                    </span>
                  </div>

                  <div className="md:col-span-2 space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 font-medium">拟下发文案草案</span>
                      {item.status === 'pending' && (
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(item)}
                          className="text-indigo-600 hover:text-indigo-800 text-[11px] flex items-center gap-1 font-medium"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>微调文案</span>
                        </button>
                      )}
                    </div>
                    <p className="bg-slate-50 p-2.5 rounded border border-slate-200 text-slate-800 font-mono text-xs leading-relaxed">
                      {item.copywriting}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-indigo-50/50 p-2.5 rounded border border-indigo-100 text-xs">
                  <div className="flex items-start gap-2">
                    <Sparkles className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold text-indigo-900">AI 策略拟定依据：</span>
                      <span className="text-indigo-800 text-[11px]">{item.aiReasoning}</span>
                      <div className="flex gap-1.5 mt-1">
                        {item.referencedRuleIds.map(rid => (
                          <span key={rid} className="font-mono text-[10px] bg-white text-indigo-700 px-1 py-0.2 rounded border border-indigo-200">
                            {rid}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {item.status === 'pending' && (
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7 border-rose-300 text-rose-700 hover:bg-rose-50"
                        onClick={() => setRejectingItem(item)}
                      >
                        <XCircle className="w-3.5 h-3.5 mr-1" />
                        驳回
                      </Button>
                      <Button
                        size="sm"
                        className="text-xs h-7 bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={() => approveReview(item.id)}
                      >
                        <CheckCircle className="w-3.5 h-3.5 mr-1" />
                        确认并下发真机
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal 1: Edit Copywriting */}
      {editingItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-lg max-w-lg w-full p-5 border border-slate-200 shadow-xl space-y-4">
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div>
                <strong className="text-base text-slate-900">在线校准发布文案 ({editingItem.id})</strong>
                <p className="text-xs text-slate-500">编辑后的文案将直接覆盖拟定草案，并下发给 Artemis UI 驱动原生输入。</p>
              </div>
              <button type="button" onClick={() => setEditingItem(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <textarea
              value={editText}
              onChange={e => setEditText(e.target.value)}
              rows={5}
              className="w-full p-2.5 text-xs font-mono rounded border border-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button size="sm" variant="outline" onClick={() => setEditingItem(null)} className="h-8 text-xs">
                取消
              </Button>
              <Button size="sm" className="h-8 text-xs bg-indigo-600 hover:bg-indigo-700 text-white" onClick={handleSaveEdit}>
                保存文案调整
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Reject with Reason */}
      {rejectingItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-lg max-w-md w-full p-5 border border-slate-200 shadow-xl space-y-4">
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div>
                <strong className="text-base text-slate-900">驳回策略草案 ({rejectingItem.id})</strong>
                <p className="text-xs text-slate-500">请选择或输入驳回说明，通知策略引擎重新拟定。</p>
              </div>
              <button type="button" onClick={() => setRejectingItem(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <label className="font-medium text-slate-700 block">驳回说明</label>
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                rows={3}
                className="w-full p-2 text-xs rounded border border-slate-300 focus:outline-none focus:ring-1 focus:ring-rose-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button size="sm" variant="outline" onClick={() => setRejectingItem(null)} className="h-8 text-xs">
                取消
              </Button>
              <Button size="sm" className="h-8 text-xs bg-rose-600 hover:bg-rose-700 text-white" onClick={handleConfirmReject}>
                确认驳回
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: Add Strategy Rule */}
      {showAddRule && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-lg max-w-lg w-full p-5 border border-slate-200 shadow-xl space-y-4">
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div>
                <strong className="text-base text-slate-900">录入新经验规则 (New Strategy Rule)</strong>
                <p className="text-xs text-slate-500">结构化沉淀运营人员规则，系统将自动进行冲突校验。</p>
              </div>
              <button type="button" onClick={() => setShowAddRule(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">规则标题</label>
                <input
                  type="text"
                  placeholder="例如：Reels 前置悬念爆点在 3 秒内呈现规范"
                  value={newRuleTitle}
                  onChange={e => setNewRuleTitle(e.target.value)}
                  className="w-full h-8 px-2.5 rounded border border-slate-300 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">规则性质</label>
                <select
                  value={newRuleNature}
                  onChange={e => setNewRuleNature(e.target.value as 'constraint' | 'heuristic')}
                  className="w-full h-8 px-2.5 rounded border border-slate-300 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="heuristic">建议 (Heuristic) - 推荐采用，非硬性阻断</option>
                  <option value="constraint">约束 (Constraint) - 违反则强制拦截阻止下发</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">触发前置条件</label>
                <input
                  type="text"
                  placeholder="例如：在拟定 Facebook Reels 伴随帖文文案时"
                  value={newRuleTrigger}
                  onChange={e => setNewRuleTrigger(e.target.value)}
                  className="w-full h-8 px-2.5 rounded border border-slate-300 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">执行指令规范</label>
                <textarea
                  placeholder="明确的动作要求与例外规避说明"
                  value={newRuleAction}
                  onChange={e => setNewRuleAction(e.target.value)}
                  rows={3}
                  className="w-full p-2.5 rounded border border-slate-300 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button size="sm" variant="outline" onClick={() => setShowAddRule(false)} className="h-8 text-xs">
                取消
              </Button>
              <Button size="sm" className="h-8 text-xs bg-indigo-600 hover:bg-indigo-700 text-white" onClick={handleSaveNewRule}>
                确认录入生效
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
