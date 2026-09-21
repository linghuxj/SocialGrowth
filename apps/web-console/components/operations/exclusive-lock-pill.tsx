'use client';

import React from 'react';
import { Lock, Unlock } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ExclusiveLockPill({
  isLocked,
  targetAccountId,
  targetAccountName,
  lockedAt,
  className,
}: {
  isLocked: boolean;
  targetAccountId?: string;
  targetAccountName?: string;
  lockedAt?: string;
  className?: string;
}) {
  const formattedTime = lockedAt
    ? new Date(lockedAt).toLocaleString('zh-CN', { hour12: false })
    : '未知';

  if (!isLocked || !targetAccountId) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] border border-dashed border-slate-300 bg-slate-50 text-slate-500 text-xs font-medium select-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400',
          className,
        )}
        title="切片素材未锁定，可分配至唯一目标账号"
      >
        <Unlock className="h-3 w-3 text-slate-400 shrink-0" aria-hidden="true" />
        <span>未锁定独占账号</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[4px] border border-amber-500/40 bg-amber-50 text-amber-900 text-xs font-medium select-none dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-300',
        className,
      )}
      title={`排他独占锁定于: ${formattedTime} (账号: ${targetAccountId})`}
    >
      <Lock className="h-3 w-3 text-amber-600 dark:text-amber-400 shrink-0" aria-hidden="true" />
      <span className="font-semibold tracking-tight">排他独占</span>
      <span className="text-amber-700 dark:text-amber-400 font-mono text-[11px]">
        {targetAccountName ?? targetAccountId}
      </span>
    </span>
  );
}
