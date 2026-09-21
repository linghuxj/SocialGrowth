'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Terminal, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export type LogLine = {
  timestamp?: string;
  level?: 'info' | 'warn' | 'error' | 'healing';
  message: string;
  detail?: string;
};

export function TerminalStream({
  title = 'Artemis 纯真机执行日志流',
  lines = [],
  healingLogs = [],
  className,
}: {
  title?: string;
  lines?: (string | LogLine)[];
  healingLogs?: string[];
  className?: string;
}) {
  const [showHealing, setShowHealing] = useState(false);
  const [copied, setCopied] = useState(false);

  const parsedLines: LogLine[] = lines.map((l) =>
    typeof l === 'string' ? { message: l, level: 'info' } : l,
  );

  const rawText = parsedLines.map((l) => `${l.timestamp ? `[${l.timestamp}] ` : ''}${l.message}`).join('\n');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(rawText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard write may fail in untrusted context */
    }
  };

  return (
    <div
      className={cn(
        'rounded-[6px] border border-slate-800 bg-[#0F172A] text-[#E2E8F0] overflow-hidden text-xs font-mono shadow-md',
        className,
      )}
    >
      {/* 终端头部 */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#1E293B]/80 border-b border-slate-800/80 select-none">
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-blue-400 shrink-0" />
          <span className="font-semibold text-slate-200 tracking-wide">{title}</span>
          <span className="text-[10px] text-slate-400 bg-slate-800/80 px-1.5 py-0.2 rounded">
            {parsedLines.length} 行
          </span>
        </div>
        <div className="flex items-center gap-2">
          {healingLogs.length > 0 && (
            <button
              type="button"
              onClick={() => setShowHealing(!showHealing)}
              className="flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 bg-amber-950/40 px-2 py-0.5 rounded border border-amber-800/50"
            >
              {showHealing ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <span>自愈修复日志 ({healingLogs.length})</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            title="复制日志"
            className="text-slate-400 hover:text-slate-200 p-1 rounded hover:bg-slate-800 transition-colors"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* 坐标自愈日志展开区 */}
      {showHealing && healingLogs.length > 0 && (
        <div className="bg-amber-950/20 border-b border-amber-900/50 p-2 text-amber-200/90 text-[11px] space-y-1 max-h-40 overflow-y-auto">
          <div className="font-semibold text-amber-400 mb-1">端侧坐标自愈（Self-healing Logs）：</div>
          {healingLogs.map((log, idx) => (
            <div key={idx} className="flex gap-2">
              <span className="text-amber-500/70 select-none">#</span>
              <span className="break-all">{log}</span>
            </div>
          ))}
        </div>
      )}

      {/* 主日志流内容 */}
      <div className="p-3 max-h-72 overflow-y-auto space-y-1 select-text scrollbar-thin scrollbar-thumb-slate-700">
        {parsedLines.length === 0 ? (
          <div className="text-slate-500 italic py-2">暂无真机回执日志输出</div>
        ) : (
          parsedLines.map((line, idx) => (
            <div key={idx} className="flex items-start gap-2 leading-relaxed hover:bg-slate-800/40 px-1 rounded">
              <span className="text-slate-600 select-none text-[10px] w-6 text-right shrink-0">
                {idx + 1}
              </span>
              {line.timestamp && (
                <span className="text-slate-500 text-[11px] shrink-0">[{line.timestamp}]</span>
              )}
              <span
                className={cn(
                  'break-all flex-1',
                  line.level === 'error' && 'text-rose-400 font-medium',
                  line.level === 'warn' && 'text-amber-400',
                  line.level === 'healing' && 'text-cyan-400',
                  line.level === 'info' && 'text-slate-200',
                )}
              >
                {line.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
