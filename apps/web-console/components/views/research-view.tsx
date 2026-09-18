'use client';

import { useState, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { sources } from '@/app/evidence';
import { nonnegative, reelsIncome } from '@/lib/calculations';

const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);

function Refs({ ids }: { ids: string }) {
  return (
    <span className="refs">
      {ids.split(',').map(id => {
        const s = sources.find(s => s.id === id);
        return s ? (
          <a key={id} href={s.url} target="_blank" rel="noreferrer" title={`${s.title} · ${s.date}`}>
            [{id}] ↗
          </a>
        ) : null;
      })}
    </span>
  );
}

function MarkedText({ text }: { text: string }) {
  const kind = /待核验|待后台|待核/.test(text) ? 'pending' : /未公开|未公布/.test(text) ? 'missing' : /测算值/.test(text) ? 'formula' : null;
  return kind ? <><span className={`status-dot ${kind}`} aria-hidden="true" />{text}</> : <>{text}</>;
}

function GridTable({ heads, rows }: { heads: string[]; rows: ReactNode[][] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {heads.map(x => <TableHead key={x}>{x}</TableHead>)}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, i) => (
          <TableRow key={i}>
            {row.map((cell, j) => (
              <TableCell key={j}>{typeof cell === 'string' ? <MarkedText text={cell} /> : cell}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Section({ id, n, title, children }: { id: string; n: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="panel">
      <div className="section-title">
        <span>{n}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Num({ id, label, value, onChange, max, step = 'any', hint }: { id: string; label: string; value: string; onChange: (s: string) => void; max?: number; step?: string; hint?: string }) {
  const n = nonnegative(value);
  const invalid = n === null || (max !== undefined && n > max) || (step === '1' && !Number.isInteger(n));
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <Input id={id} type="number" min="0" max={max} step={step} value={value} onChange={e => onChange(e.target.value)} aria-invalid={invalid} aria-describedby={hint ? `${id}-hint` : undefined} />
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}

function Bars({ rows, max, unit = '%', color = 'blue' }: { rows: { label: string; value: number; display?: string }[]; max: number; unit?: string; color?: string }) {
  return (
    <div className={`bars ${color}`} aria-label={rows.map(r => `${r.label} ${r.display ?? r.value + unit}`).join('；')}>
      {rows.map(r => (
        <div className="bar-row" key={r.label}>
          <span>{r.label}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${max > 0 ? Math.min(100, r.value / max * 100) : 0}%` }} />
          </div>
          <strong>{r.display ?? `${r.value}${unit}`}</strong>
        </div>
      ))}
      <div className="axis"><span>0</span><span>{max}{unit}</span></div>
    </div>
  );
}

export function ResearchView() {
  const [total, setTotal] = useState('');
  const [qualified, setQualified] = useState('');
  const [rate, setRate] = useState('');
  const [active, setActive] = useState(false);
  const result = reelsIncome(total, qualified, rate, active);

  return (
    <div className="research-report space-y-6">
      <div className="border-b border-slate-200 pb-3">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">
          归档参考：社媒变现准入门槛与官方收益政策档案
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          本部分保留了前期的 Facebook Reels / YouTube Shorts 变现准入门槛与收益模型测算，作为辅助背景核查资料归档。
        </p>
      </div>

      <Section id="reels" n="ARCHIVE-01" title="Facebook Reels：准入门槛与平台收益">
        <div className="process-line">
          <span>原创账号</span><b>→</b><span>平台邀请</span><b>→</b><span>审核与收款设置</span><b>→</b><span>合格内容收益</span><Refs ids="F1,F2" />
        </div>
        <GridTable
          heads={['准入维度', '要求 / 口径', '状态与执行要点']}
          rows={[
            ['账号与工具', 'Page或个人档案专业模式；开启工具不等于收益获批。', <>核对账号与管理权限。<Refs ids="F10,F1" /></>],
            ['邀请与数字门槛', '邀请制；无公开统一粉丝、观看量或小时门槛。', <>专业面板 → 变现 → 提交意向。<Refs ids="F1" /></>],
            ['原创与账号合规', '原创内容；持续符合内容、推荐及变现规则。', <>核对原创材料、版权及违规记录。<Refs ids="F3,F8" /></>],
            ['年龄、地区、语言', '最低年龄、主体地区及语言支持清单待核验。', <>登录官方资格页核对；主体地区≠观众地区。<Refs ids="F9" /></>],
            ['视频与合格观看', 'Reels含长短视频；按后台合格观看计佣。', <>最低计佣时长待核验；查看不合格原因。<Refs ids="F7,F1,F9" /></>],
            ['开通与收款', '接受条款、完成身份及收款设置。', <>税务、付款门槛及周期待后台核验。<Refs ids="F6,F9" /></>]
          ]}
        />
        <div className="subhead">
          <h3>收益规模与统计边界</h3>
          <span className="tag official">官方披露 · 2025年</span>
        </div>
        <div className="split">
          <div>
            <GridTable
              heads={['指标', '结果', '口径']}
              rows={[
                ['2025 Facebook整体付款', '接近30亿美元；Reels占60%', '含长短视频；缺少同口径账号数'],
                ['Reels付款量级（计算值）', '近30亿美元 × 60% ≈ 18亿美元', '测算值；非官方精确单列额'],
                ['年收入超过1万美元的创作者', '人数同比增长超过30%', '人数与该档均值未公开'],
                ['低／中／高档Reels平均收益', '数据未公开', '不按粉丝档位推定月收入']
              ]}
            />
            <Refs ids="F1" />
          </div>
          <figure>
            <figcaption>2025 Facebook创作者付款构成</figcaption>
            <Bars rows={[{ label: 'Reels（含长短视频）', value: 60 }, { label: 'Stories、图文等', value: 40 }]} max={100} />
            <p className="small">Reels含长短视频；40%为余数。图示为付款构成。<Refs ids="F1,F7" /></p>
          </figure>
        </div>

        <details className="calculator-fold" open>
          <summary>Reels收益测算｜输入账号后台数据</summary>
          <p>收入≈合格观看÷1,000×后台Earnings Rate；使用同期、同类内容数据。<Refs ids="F1" /></p>
          <div className="split">
            <form aria-label="Facebook Reels收益计算" onSubmit={e => e.preventDefault()}>
              <div className="form-grid">
                <Num id="fb-total" label="同一期间后台总观看量" value={total} onChange={setTotal} step="1" />
                <Num id="fb-qualified" label="其中合格观看量 Qualified Views" value={qualified} onChange={setQualified} step="1" />
              </div>
              <Num id="fb-rate" label="同期同类内容 Earnings Rate（USD/千次）" value={rate} onChange={setRate} hint="按USD填写；不自动换汇。" />
              <div className="checkline">
                <Checkbox id="fb-active" checked={active} onCheckedChange={v => setActive(Boolean(v))} />
                <label htmlFor="fb-active">已开通；观看处于有效变现期间</label>
              </div>
              <small>测算表单，不连接平台账户。</small>
            </form>
            <div className="result-box" aria-live="polite">
              <span>本期平台内容收入 · 近似换算</span>
              <output>{result ? money(result.payable) : '等待后台数据'}</output>
              <p>{result ? (active ? '以平台最终结算为准。' : '未开通：平台播放收益计为$0。') : '请输入有效数据；合格观看≤总观看。'}</p>
              <div className="result-line">
                <span>合格观看占比</span>
                <b>{result?.qualifiedShare !== null && result?.qualifiedShare !== undefined ? `${result.qualifiedShare.toFixed(1)}%` : '—'}</b>
              </div>
              <div className="result-line">
                <span>单价对应参考额</span>
                <b>{result ? money(result.reference) : '—'}</b>
              </div>
            </div>
          </div>
        </details>
      </Section>
    </div>
  );
}
