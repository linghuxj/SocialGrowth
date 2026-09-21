'use client';

import React from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export type MetricType = 'observed' | 'hypothetical' | 'plan';

export function MetricCard({
  title,
  value,
  unit,
  trend,
  trendDirection,
  type = 'observed',
  sourceInfo,
  description,
  className,
}: {
  title: string;
  value: string | number;
  unit?: string;
  trend?: string;
  trendDirection?: 'up' | 'down' | 'flat';
  type?: MetricType;
  sourceInfo?: string;
  description?: string;
  className?: string;
}) {
  const badgeColors: Record<MetricType, { text: string; bg: string; label: string }> = {
    observed: {
      text: 'text-emerald-700 dark:text-emerald-300',
      bg: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800',
      label: '实际观察',
    },
    hypothetical: {
      text: 'text-amber-700 dark:text-amber-300',
      bg: 'bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-800',
      label: '规划假设',
    },
    plan: {
      text: 'text-blue-700 dark:text-blue-300',
      bg: 'bg-blue-50 border-blue-200 dark:bg-blue-950/40 dark:border-blue-800',
      label: '运营计划',
    },
  };

  const badge = badgeColors[type];

  return (
    <Card
      className={cn(
        'p-4 rounded-[6px] border border-slate-200 bg-white text-slate-900 shadow-[0_1px_2px_0_rgba(0,0,0,0.05)] transition-all hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
          {title}
        </span>
        <span
          className={cn(
            'inline-flex items-center px-1.5 py-0.5 rounded-[3px] border text-[10px] font-medium leading-none shrink-0',
            badge.bg,
            badge.text,
          )}
        >
          {badge.label}
        </span>
      </div>

      <div className="flex items-baseline gap-1 my-2">
        <span className="text-3xl font-bold tracking-tight font-mono text-slate-900 dark:text-white">
          {value}
        </span>
        {unit && (
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 select-none ml-1">
            {unit}
          </span>
        )}
      </div>

      {(trend || sourceInfo) && (
        <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-100 dark:border-slate-800/80 text-[11px] text-slate-500">
          {trend ? (
            <div className="flex items-center gap-1 font-medium">
              {trendDirection === 'up' && (
                <TrendingUp className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              )}
              {trendDirection === 'down' && (
                <TrendingDown className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
              )}
              {trendDirection === 'flat' && (
                <Minus className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              )}
              <span
                className={cn(
                  trendDirection === 'up' && 'text-emerald-700 dark:text-emerald-400',
                  trendDirection === 'down' && 'text-rose-700 dark:text-rose-400',
                  trendDirection === 'flat' && 'text-slate-600 dark:text-slate-400',
                )}
              >
                {trend}
              </span>
            </div>
          ) : <span />}
          {sourceInfo && (
            <span className="truncate text-slate-400 dark:text-slate-500 text-[10px]" title={sourceInfo}>
              {sourceInfo}
            </span>
          )}
        </div>
      )}

      {description && (
        <p className="mt-1.5 text-[11px] text-slate-400 line-clamp-2">
          {description}
        </p>
      )}
    </Card>
  );
}
