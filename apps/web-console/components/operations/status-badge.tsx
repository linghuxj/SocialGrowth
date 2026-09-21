'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export type StatusType =
  | 'online'
  | 'warning'
  | 'danger'
  | 'experiment'
  | 'shortlink'
  | 'neutral';

const statusStyles: Record<StatusType, { bg: string; text: string; border: string; dot: string }> = {
  online: {
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-700 dark:text-emerald-400',
    border: 'border-emerald-500/30',
    dot: 'bg-emerald-500',
  },
  warning: {
    bg: 'bg-amber-500/10',
    text: 'text-amber-700 dark:text-amber-400',
    border: 'border-amber-500/30',
    dot: 'bg-amber-500',
  },
  danger: {
    bg: 'bg-rose-500/10',
    text: 'text-rose-700 dark:text-rose-400',
    border: 'border-rose-500/30',
    dot: 'bg-rose-500',
  },
  experiment: {
    bg: 'bg-purple-500/10',
    text: 'text-purple-700 dark:text-purple-400',
    border: 'border-purple-500/30',
    dot: 'bg-purple-500',
  },
  shortlink: {
    bg: 'bg-cyan-500/10',
    text: 'text-cyan-700 dark:text-cyan-400',
    border: 'border-cyan-500/30',
    dot: 'bg-cyan-500',
  },
  neutral: {
    bg: 'bg-slate-500/10',
    text: 'text-slate-700 dark:text-slate-400',
    border: 'border-slate-500/30',
    dot: 'bg-slate-400',
  },
};

export function StatusBadge({
  status = 'neutral',
  children,
  className,
  title,
}: {
  status?: StatusType;
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  const s = statusStyles[status] ?? statusStyles.neutral;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[4px] border text-xs font-medium leading-none tracking-tight select-none',
        s.bg,
        s.text,
        s.border,
        className,
      )}
      title={title}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', s.dot)} aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}
