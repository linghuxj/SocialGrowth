'use client';

import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDatabase } from '@/lib/db';
import { Database, Download, Table2, FileCode, CheckCircle2, Copy } from 'lucide-react';

export function DatabaseView() {
  const db = useDatabase();
  const [activeTab, setActiveTab] = useState<'tables' | 'schema' | 'json'>('tables');
  const [copied, setCopied] = useState(false);

  const tablesMeta = [
    { name: 'devices', desc: '物理真机设备表 (100% 纯物理真机底座)', count: db.devices.length, keyField: 'id' },
    { name: 'accounts', desc: '账号资产表 (1:1 专属强绑定)', count: db.accounts.length, keyField: 'id' },
    { name: 'coldSparePool', desc: '冷备账号池 (解耦独立就绪池)', count: db.coldSparePool.length, keyField: 'id' },
    { name: 'clips', desc: '切片素材资产表 (排他独占锁)', count: db.clips.length, keyField: 'id' },
    { name: 'strategyRules', desc: '经验与平台规则库 (约束 vs 建议)', count: db.rules.length, keyField: 'id' },
    { name: 'reviews', desc: '待审策略任务队列 (单人审核流)', count: db.reviews.length, keyField: 'id' },
    { name: 'shortlinks', desc: '导流短链表 (三层点击流转)', count: db.shortlinks.length, keyField: 'id' },
    { name: 'domainPool', desc: '防封跳板域名池 (主推/备用/熔断)', count: db.domainPool.length, keyField: 'domain' },
    { name: 'anomalies', desc: '风控与异常追溯台账 (4类异常证据链)', count: db.anomalies.length, keyField: 'id' },
    { name: 'replacementOrders', desc: '冷备换号流水线 (6步SOP记录)', count: db.replacementOrders.length, keyField: 'orderId' },
    { name: 'hitl2FaEvents', desc: 'HITL 2FA 人机协同接管记录', count: db.hitl2FaEvents.length, keyField: 'id' },
    { name: 'experiments', desc: '小样本量化 A/B 策略实验表', count: db.experiments.length, keyField: 'experimentId' },
  ];

  const handleCopyJson = () => {
    const jsonStr = db.exportCurrentDatabaseJson();
    navigator.clipboard?.writeText(jsonStr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <span>数据库与数据持久化管理中心 (Database & Data Management)</span>
            <Badge variant="outline" className="bg-slate-900 text-emerald-400 border-slate-800 text-xs font-mono">
              11 张核心业务表就绪
            </Badge>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            对应 docs/delivery-specification.md 第 7.1 节规范。存储源为 data/database.json 与 schema.sql，所有操作支持即时热更新与一键快照导出。
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyJson}
            className="text-xs h-8 flex items-center gap-1.5"
          >
            {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
            <span>{copied ? '已复制快照' : '复制全量快照'}</span>
          </Button>
          <Button
            size="sm"
            onClick={() => db.exportCurrentDatabaseJson()}
            className="text-xs h-8 bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            <span>导出 database.json</span>
          </Button>
        </div>
      </div>

      {/* Navigation Subtabs */}
      <div className="flex gap-2 border-b border-slate-200 pb-2">
        <Button
          variant={activeTab === 'tables' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveTab('tables')}
          className="text-xs h-8 flex items-center gap-1.5"
        >
          <Table2 className="w-3.5 h-3.5" />
          <span>业务数据表全景 ({tablesMeta.length})</span>
        </Button>
        <Button
          variant={activeTab === 'schema' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveTab('schema')}
          className="text-xs h-8 flex items-center gap-1.5"
        >
          <FileCode className="w-3.5 h-3.5" />
          <span>SQL DDL 结构规范</span>
        </Button>
        <Button
          variant={activeTab === 'json' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveTab('json')}
          className="text-xs h-8 flex items-center gap-1.5"
        >
          <Database className="w-3.5 h-3.5" />
          <span>当前内存快照 JSON 浏览器</span>
        </Button>
      </div>

      {activeTab === 'tables' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tablesMeta.map(t => (
            <Card key={t.name} className="border-slate-200 shadow-xs">
              <CardHeader className="pb-2">
                <div className="flex justify-between items-center">
                  <span className="font-mono font-bold text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                    {t.name}
                  </span>
                  <Badge variant="outline" className="text-xs font-mono font-semibold text-slate-800">
                    {t.count} 条记录
                  </Badge>
                </div>
                <CardTitle className="text-sm font-semibold text-slate-900 mt-2">
                  {t.desc}
                </CardTitle>
                <CardDescription className="text-xs text-slate-400 font-mono">
                  主键标识: {t.keyField}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-slate-500 pt-2 border-t border-slate-100 flex justify-between items-center">
                <span>持久化映射: data/database.json</span>
                <span className="text-emerald-600 font-medium">状态正常</span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {activeTab === 'schema' && (
        <Card className="border-slate-200 shadow-xs">
          <CardHeader className="pb-3 border-b border-slate-100">
            <CardTitle className="text-sm font-bold text-slate-900 flex items-center justify-between">
              <span>data/schema.sql (PostgreSQL / SQLite 兼容 DDL 规范)</span>
              <span className="text-xs text-slate-400 font-mono">严格约束与索引</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <pre className="bg-slate-950 text-slate-100 p-4 rounded-lg font-mono text-xs overflow-x-auto max-h-[600px] leading-relaxed">
{`-- 1. 物理真机设备表 (100% 纯物理真机底座，杜绝虚拟化)
CREATE TABLE IF NOT EXISTS devices (
    device_id VARCHAR(32) PRIMARY KEY,
    model VARCHAR(64) NOT NULL DEFAULT 'Samsung Galaxy S23 (SM-S911U1)',
    serial_number VARCHAR(64) NOT NULL UNIQUE,
    carrier VARCHAR(64) NOT NULL DEFAULT 'T-Mobile US 5G',
    location VARCHAR(128) NOT NULL,
    battery_level INTEGER NOT NULL CHECK (battery_level BETWEEN 0 AND 100),
    temperature_c NUMERIC(4, 1) NOT NULL,
    network_latency_ms INTEGER NOT NULL,
    health_status VARCHAR(16) NOT NULL CHECK (health_status IN ('healthy', 'warning', 'critical')),
    assigned_fb_account_id VARCHAR(32) NOT NULL,
    assigned_yt_account_id VARCHAR(32) NOT NULL
);

-- 2. 账号资产表 (1:1 设备专属强绑定)
CREATE TABLE IF NOT EXISTS accounts (
    account_id VARCHAR(32) PRIMARY KEY,
    platform VARCHAR(16) NOT NULL CHECK (platform IN ('facebook', 'youtube', 'instagram')),
    name VARCHAR(128) NOT NULL,
    handle VARCHAR(128) NOT NULL,
    bound_device_id VARCHAR(32) NOT NULL,
    followers_count INTEGER NOT NULL DEFAULT 0,
    stage VARCHAR(32) NOT NULL CHECK (stage IN ('cold_start', 'active_operation', 'restricted', 'replaced')),
    auto_pilot_enabled BOOLEAN NOT NULL DEFAULT false
);

-- 3. 切片素材资产表 (分布式 Exclusive Lock 排他独占分发)
CREATE TABLE IF NOT EXISTS slice_metadata (
    slice_id VARCHAR(64) PRIMARY KEY,
    title VARCHAR(256) NOT NULL,
    drama_title VARCHAR(128) NOT NULL,
    duration_seconds INTEGER NOT NULL,
    allocation_status VARCHAR(32) NOT NULL CHECK (allocation_status IN ('unallocated', 'assigned_locked', 'published')),
    exclusive_account_id VARCHAR(32),
    sha256_checksum VARCHAR(64) NOT NULL
);`}
            </pre>
          </CardContent>
        </Card>
      )}

      {activeTab === 'json' && (
        <Card className="border-slate-200 shadow-xs">
          <CardHeader className="pb-3 border-b border-slate-100 flex flex-row justify-between items-center">
            <div>
              <CardTitle className="text-sm font-bold text-slate-900">
                当前运行态数据库快照
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                包含了当前所有在管设备、账号、独占切片与审核状态，随时可通过上方按钮下载保存
              </CardDescription>
            </div>
            <Badge variant="outline" className="font-mono text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
              内存已同步
            </Badge>
          </CardHeader>
          <CardContent className="pt-4">
            <pre className="bg-slate-950 text-emerald-400 p-4 rounded-lg font-mono text-xs overflow-x-auto max-h-[560px] leading-relaxed">
              {JSON.stringify(
                {
                  summary: db.summary,
                  deviceSample: db.devices.slice(0, 3),
                  accountSample: db.accounts.slice(0, 4),
                  coldSparePool: db.coldSparePool,
                  clipVaultStats: db.clipVaultStats,
                  strategyStats: db.strategyStats,
                  shortlinkStats: db.shortlinkStats,
                  hitl2FaEvents: db.hitl2FaEvents
                },
                null,
                2
              )}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
