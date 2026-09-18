'use client';

import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { useDatabase, PlatformType } from '@/lib/db';
import { Link2, ShieldCheck, ArrowRight, Activity, Globe2, AlertTriangle, Plus, Copy, Check, X } from 'lucide-react';

export function ShortlinksView() {
  const { shortlinks, domainPool, shortlinkStats, accounts, createShortlink, toggleDomainStatus, notify } = useDatabase();
  const stats = shortlinkStats;

  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Create shortlink modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [platform, setPlatform] = useState<PlatformType>('facebook');
  const [accountId, setAccountId] = useState('fb-acc-001');
  const [slug, setSlug] = useState('');
  const [dramaTitle, setDramaTitle] = useState('heiress-ep01');

  const handleCopy = (id: string, url: string) => {
    navigator.clipboard?.writeText(url);
    setCopiedId(id);
    notify(`短链 ${url} 已成功复制到剪贴板！`, 'success');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCreateShortlink = () => {
    const finalSlug = slug.trim() || `sg-${Date.now().toString().slice(-5)}`;
    const utmSource = platform === 'facebook' ? 'fb_reels' : 'yt_channel_bio';
    const destinationUrl = `https://drama.clientapp.com/watch/${dramaTitle}?utm_source=${utmSource}&utm_medium=social&utm_campaign=${accountId}`;
    const fullShortUrl = `https://sg8.link/${finalSlug}`;

    createShortlink({
      slug: finalSlug,
      fullShortUrl,
      destinationUrl,
      platform,
      accountId
    });

    setShowCreateModal(false);
    setSlug('');
  };

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <span>模块 4：导流短链服务与防封域名池</span>
            <Badge variant="outline" className="bg-cyan-50 text-cyan-700 border-cyan-200 text-xs">
              302 稳定跳转 98.6%
            </Badge>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            自建导流短链中转服务，严格分离原始点击、机器爬虫过滤与真实有效跳转。实现 Facebook 帖文级单条归因与 YouTube 频道级归因。
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => setShowCreateModal(true)}
            className="text-xs h-8 bg-cyan-600 hover:bg-cyan-700 text-white flex items-center gap-1.5 shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>生成新导流短链 (UTM)</span>
          </Button>
        </div>
      </div>

      {/* 3-Layer Click Funnel Callout */}
      <div className="bg-slate-900 text-white rounded-lg p-5 border border-slate-800 shadow-sm">
        <h3 className="text-xs font-mono font-bold text-cyan-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4" />
          <span>前 3 个月导流三层点击流转漏斗（严禁将爬虫过滤直接虚标为真实人数）</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="bg-slate-800/80 p-3.5 rounded border border-slate-700">
            <span className="text-slate-400 text-xs block mb-1">1. 原始总访问 (Raw Hits)</span>
            <strong className="text-2xl font-bold text-white font-mono">{stats.rawClicksTotal.toLocaleString()}</strong>
            <span className="text-[11px] text-slate-400 block mt-1">短链触发的所有 HTTP GET</span>
          </div>

          <div className="bg-slate-800/80 p-3.5 rounded border border-slate-700">
            <span className="text-slate-400 text-xs block mb-1">2. 机器爬虫/预取过滤</span>
            <strong className="text-2xl font-bold text-rose-400 font-mono">-{stats.crawlerFilteredTotal.toLocaleString()}</strong>
            <span className="text-[11px] text-slate-400 block mt-1">FB/YT 链接预览与自动化请求</span>
          </div>

          <div className="bg-slate-800/80 p-3.5 rounded border border-slate-700">
            <span className="text-slate-400 text-xs block mb-1">3. 有效点击 (Clean Clicks)</span>
            <strong className="text-2xl font-bold text-cyan-400 font-mono">{stats.cleanClicksTotal.toLocaleString()}</strong>
            <span className="text-[11px] text-slate-400 block mt-1">去除非人类请求后的真实交互</span>
          </div>

          <div className="bg-slate-800/80 p-3.5 rounded border border-slate-700">
            <span className="text-slate-400 text-xs block mb-1">4. 302 成功到达目标页</span>
            <strong className="text-2xl font-bold text-emerald-400 font-mono">{stats.redirectsSuccessfulTotal.toLocaleString()}</strong>
            <span className="text-[11px] text-emerald-400 block mt-1">有效跳转率 98.6%</span>
          </div>
        </div>
      </div>

      {/* Domain Pool Status */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <span>多域名防封轮换与跳板域名池状态</span>
            <span className="text-xs text-slate-400 font-mono">已完成 2 次自动熔断平滑切换</span>
          </h3>
          <span className="text-xs text-slate-500">支持对高拦截率域名一键隔离熔断</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {domainPool.map(d => (
            <div
              key={d.domain}
              className={`p-3 rounded-lg border text-xs space-y-2 ${
                d.status === 'blocked' ? 'bg-rose-50 border-rose-200' : 'bg-white border-slate-200 shadow-xs'
              }`}
            >
              <div className="flex justify-between items-center">
                <span className="font-mono font-bold text-slate-900">{d.domain}</span>
                {d.role === 'primary' && <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200 font-semibold">主推</Badge>}
                {d.role === 'standby' && <Badge variant="outline" className="text-[10px] bg-slate-100 text-slate-600 border-slate-200">备用跳板</Badge>}
                {d.role === 'quarantined' && <Badge variant="outline" className="text-[10px] bg-rose-100 text-rose-800 border-rose-300 font-bold">隔离熔断</Badge>}
              </div>

              <div className="flex justify-between text-slate-500 font-mono text-[11px]">
                <span>健康度: {d.healthScore}/100</span>
                <span>拦截率: {(d.interceptRate * 100).toFixed(1)}%</span>
              </div>

              <div className="pt-1 border-t border-slate-100 flex items-center justify-between text-[10px]">
                <span className={d.status === 'healthy' ? 'text-emerald-600 font-medium' : 'text-rose-600 font-bold'}>
                  {d.status === 'healthy' ? '解析正常' : '平台拦截'}
                </span>
                <div className="flex gap-1">
                  {d.role !== 'primary' && d.status !== 'blocked' && (
                    <button
                      type="button"
                      onClick={() => toggleDomainStatus(d.domain, 'set_primary')}
                      className="text-blue-600 hover:underline text-[10px]"
                    >
                      设为主推
                    </button>
                  )}
                  {d.role !== 'quarantined' && (
                    <button
                      type="button"
                      onClick={() => toggleDomainStatus(d.domain, 'quarantine')}
                      className="text-rose-600 hover:underline text-[10px]"
                    >
                      熔断
                    </button>
                  )}
                  {d.role === 'quarantined' && (
                    <button
                      type="button"
                      onClick={() => toggleDomainStatus(d.domain, 'restore')}
                      className="text-emerald-600 hover:underline text-[10px]"
                    >
                      解除隔离
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Shortlink Attribution Table */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900 flex items-center justify-between">
          <span>核心短链与归因明细表 ({shortlinks.length} 条有效在跑)</span>
          <span className="text-xs text-slate-500">FB 帖文级单条归因 vs YT 频道主页级归因</span>
        </h3>

        <div className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-xs">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead className="text-xs font-semibold text-slate-700 w-48">短链 Slug / 链接</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700 w-28">平台来源</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700 w-32">归属账号</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700">跳转目的地 (含 UTM 归因参数)</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700 w-28 text-right">有效点击</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700 w-28 text-right">302 成功</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700 w-20 text-center">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shortlinks.map(link => (
                <TableRow key={link.id} className="hover:bg-slate-50/80">
                  <TableCell className="font-mono text-xs">
                    <strong className="text-cyan-700 block">{link.slug}</strong>
                    <span className="text-[10px] text-slate-400">{link.fullShortUrl}</span>
                  </TableCell>

                  <TableCell className="text-xs">
                    <Badge variant="outline" className={link.platform === 'facebook' ? 'bg-blue-50 text-blue-700 border-blue-200 text-[10px]' : 'bg-red-50 text-red-700 border-red-200 text-[10px]'}>
                      {link.platform === 'facebook' ? 'Facebook 帖文' : 'YouTube 频道'}
                    </Badge>
                  </TableCell>

                  <TableCell className="text-xs font-mono text-slate-800">
                    {link.accountId}
                  </TableCell>

                  <TableCell className="text-xs font-mono text-slate-600 truncate max-w-xs" title={link.destinationUrl}>
                    {link.destinationUrl}
                  </TableCell>

                  <TableCell className="text-xs font-mono text-right font-semibold text-slate-900">
                    {link.filteredClicks.toLocaleString()}
                  </TableCell>

                  <TableCell className="text-xs font-mono text-right font-bold text-emerald-600">
                    {link.successfulRedirects.toLocaleString()}
                  </TableCell>

                  <TableCell className="text-center">
                    <button
                      type="button"
                      onClick={() => handleCopy(link.id, link.fullShortUrl)}
                      title="复制完整短链"
                      className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800"
                    >
                      {copiedId === link.id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Modal: Create Shortlink */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-lg max-w-md w-full p-5 border border-slate-200 shadow-xl space-y-4">
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div>
                <strong className="text-base text-slate-900">生成新导流短链 (UTM Attribution)</strong>
                <p className="text-xs text-slate-500">自动组装渠道来源、剧目参数与防封 302 短链。</p>
              </div>
              <button type="button" onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">分发平台与归因层级</label>
                <select
                  value={platform}
                  onChange={e => {
                    const p = e.target.value as PlatformType;
                    setPlatform(p);
                    setAccountId(p === 'facebook' ? 'fb-acc-001' : 'yt-acc-001');
                  }}
                  className="w-full h-8 px-2 rounded border border-slate-300 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500"
                >
                  <option value="facebook">Facebook (帖文直挂可点击短链 · 单条单帖归因)</option>
                  <option value="youtube">YouTube (频道主页 Bio 短链 · 频道级归因)</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">指派归属账号</label>
                <select
                  value={accountId}
                  onChange={e => setAccountId(e.target.value)}
                  className="w-full h-8 px-2 rounded border border-slate-300 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500"
                >
                  {accounts.filter(a => a.platform === platform).map(a => (
                    <option key={a.id} value={a.id}>
                      {a.id} - {a.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">短剧落地页标识 (Landing Slug)</label>
                <input
                  type="text"
                  value={dramaTitle}
                  onChange={e => setDramaTitle(e.target.value)}
                  placeholder="例如: heiress-ep01, tycoon-ep03"
                  className="w-full h-8 px-2.5 rounded border border-slate-300 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">短链自定义 Slug (可选)</label>
                <input
                  type="text"
                  value={slug}
                  onChange={e => setSlug(e.target.value)}
                  placeholder="例如: d-heiress01 (留空则自动生成)"
                  className="w-full h-8 px-2.5 rounded border border-slate-300 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>

              <div className="p-2.5 bg-cyan-50 rounded border border-cyan-200 text-cyan-900 text-[11px] leading-relaxed">
                <strong>实时预览</strong>：https://sg8.link/{slug || 'sg-xxxxx'} → https://drama.clientapp.com/watch/{dramaTitle}?utm_source={platform === 'facebook' ? 'fb_reels' : 'yt_channel_bio'}&utm_campaign={accountId}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button size="sm" variant="outline" onClick={() => setShowCreateModal(false)} className="h-8 text-xs">
                取消
              </Button>
              <Button size="sm" className="h-8 text-xs bg-cyan-600 hover:bg-cyan-700 text-white" onClick={handleCreateShortlink}>
                立即生成并入库
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
