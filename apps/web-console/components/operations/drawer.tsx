'use client';

import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export type DrawerWidth = 'sm' | 'md' | 'lg' | 'xl' | '2xl';

const widthClasses: Record<DrawerWidth, string> = {
  sm: 'max-w-md',     // 448px
  md: 'max-w-lg',     // 512px
  lg: 'max-w-xl',     // 576px
  xl: 'max-w-2xl',    // 672px
  '2xl': 'max-w-3xl',  // 768px
};

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'xl',
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: DrawerWidth;
  className?: string;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // 监听 ESC 键关闭
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // 打开时锁定背景滚动
  useEffect(() => {
    if (open) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [open]);

  // 聚焦管理
  useEffect(() => {
    if (open) {
      panelRef.current?.focus();
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : undefined}
      className="fixed inset-0 z-50 overflow-hidden flex justify-end"
    >
      {/* 半透明遮罩层 */}
      <div
        ref={overlayRef}
        onClick={onClose}
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity duration-200 animate-in fade-in"
        aria-hidden="true"
      />

      {/* 侧边抽屉面板 */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          'relative z-10 w-full h-full bg-white dark:bg-slate-900 shadow-2xl border-l border-slate-200 dark:border-slate-800 flex flex-col focus:outline-none transition-transform duration-200 ease-out animate-in slide-in-from-right',
          widthClasses[width],
          className,
        )}
      >
        {/* 抽屉头部 */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-200 dark:border-slate-800 shrink-0 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 truncate">
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {description}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="关闭抽屉"
            title="关闭 (Esc)"
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 -mr-2"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* 抽屉滚动内容区 */}
        <div className="flex-1 overflow-y-auto px-6 py-5 text-sm text-slate-700 dark:text-slate-300">
          {children}
        </div>

        {/* 抽屉底部操作区（若提供） */}
        {footer && (
          <div className="px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80 shrink-0 flex items-center justify-end gap-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
