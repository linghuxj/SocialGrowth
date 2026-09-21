'use client';
import React, { useEffect, useId, useState, useRef } from 'react';
import { Plus } from 'lucide-react';
import type { CommandResult } from '@/lib/first-loop/types';
import { useOperations } from '@/lib/operations-context';
import { href, type PageId } from '@/lib/operations';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { StatusBadge, type StatusType } from './status-badge';
import { Drawer, type DrawerWidth } from './drawer';

export type Values = Record<string, string>;
export type Option = { id: string; name: string };
export type Field = {
  key: string;
  label: string;
  type?: 'text' | 'url' | 'number' | 'datetime-local' | 'textarea' | 'file';
  options?: Option[];
  optional?: boolean;
  initial?: string;
  hint?: string;
  multiple?: boolean;
};
export const options = (values: string[], names: Record<string, string>) =>
  values.map((id) => ({ id, name: names[id] ?? id }));
export const iso = (value: string) =>
  value ? new Date(value).toISOString() : '';
export const localTime = (value: string) => {
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
export const date = (value?: string) =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未设置';
export const fail = (message: string): CommandResult<never> => ({
  ok: false,
  error: { code: 'INPUT_REQUIRED', message },
});

export const InsideDetailContext = React.createContext(false);

export function Status({
  children,
  type = 'neutral',
}: {
  children: React.ReactNode;
  type?: StatusType;
}) {
  return (
    <span className="op-status">
      <StatusBadge status={type}>{children}</StatusBadge>
    </span>
  );
}

export function Notice({ children }: { children: React.ReactNode }) {
  return <p className="op-notice">{children}</p>;
}

export function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="op-panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function Link({
  page,
  id,
  children,
  project,
}: {
  page: PageId;
  id?: string;
  project?: string;
  children: React.ReactNode;
}) {
  const { projectId } = useOperations();
  return (
    <a className="op-link" href={href(page, id, '', project ?? projectId)}>
      {children}
    </a>
  );
}

export function Detail({
  title,
  children,
  page,
  width = '2xl',
}: {
  title: string;
  children: React.ReactNode;
  page: PageId;
  width?: DrawerWidth;
}) {
  const handleClose = () => {
    window.location.assign(href(page));
  };

  return (
    <Drawer open={true} onClose={handleClose} title={title} width={width}>
      <InsideDetailContext.Provider value={true}>
        <section className="op-detail-content space-y-4" tabIndex={-1} aria-label={title}>
          <div className="flex justify-end mb-2">
            <Link page={page}>关闭详情返回列表</Link>
          </div>
          {children}
        </section>
      </InsideDetailContext.Provider>
    </Drawer>
  );
}

export function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="op-facts">
      {items.map(([name, value]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function List({
  columns,
  rows,
  empty = '当前没有记录。',
  query,
}: {
  columns: string[];
  rows: { id: string; search: string; cells: React.ReactNode[] }[];
  empty?: string;
  query: string;
}) {
  const cellText = (node: React.ReactNode): string =>
    typeof node === 'string' || typeof node === 'number'
      ? String(node)
      : Array.isArray(node)
        ? node.map(cellText).join(' ')
        : React.isValidElement<{ children?: React.ReactNode }>(node)
          ? cellText(node.props.children)
          : '';
  const visible = rows.filter((row) =>
    `${row.search} ${row.cells.map(cellText).join(' ')}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  return (
    <>
      <p className="op-count">
        {query
          ? `匹配 ${visible.length} / 全部 ${rows.length} 条`
          : `全部 ${rows.length} 条`}
      </p>
      {visible.length ? (
        <div className="op-table-scroll">
          <Table className="op-table">
            <TableHeader>
              <TableRow>
                {columns.map((c) => (
                  <TableHead key={c}>{c}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => (
                <TableRow key={row.id}>
                  {row.cells.map((cell, i) => (
                    <TableCell key={i}>{cell}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="op-empty">
          {query ? '没有匹配记录，请调整或清除搜索。' : empty}
        </p>
      )}
    </>
  );
}

export function Form({
  id,
  title,
  fields,
  submit,
  onSubmit,
  description,
  children,
  open = false,
  drawer,
}: {
  id: string;
  title: string;
  fields: Field[] | ((values: Values) => Field[]);
  submit: string;
  onSubmit: (
    values: Values,
    form: HTMLFormElement,
  ) => CommandResult<unknown> | Promise<CommandResult<unknown>>;
  description?: string;
  children?: React.ReactNode;
  open?: boolean;
  drawer?: boolean;
}) {
  const { ready } = useOperations();
  const insideDetail = React.useContext(InsideDetailContext);
  const useDrawer = drawer ?? !insideDetail;
  const [drawerOpen, setDrawerOpen] = useState(open);

  const uid = useId();
  const definitions = (values: Values) =>
    typeof fields === 'function' ? fields(values) : fields;
  const [values, setValues] = useState<Values>(() =>
    Object.fromEntries(definitions({}).map((f) => [f.key, f.initial ?? ''])),
  );
  const [feedback, setFeedback] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const draft = sessionStorage.getItem(`op-form:${id}`);
      // Synchronize the recovered browser draft after hydration; server output remains deterministic.
      // oxlint-disable-next-line react/react-compiler
      if (draft) setValues((v) => ({ ...v, ...JSON.parse(draft) }));
    } catch {
      /* Draft recovery is optional. */
    }
  }, [id]);

  const change = (key: string, value: string) => {
    setValues((v) => {
      const next = { ...v, [key]: value };
      try {
        sessionStorage.setItem(`op-form:${id}`, JSON.stringify(next));
      } catch {
        /* Saving the command remains authoritative. */
      }
      return next;
    });
    setFeedback(null);
  };

  const formElement = (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const form = event.currentTarget;
        setBusy(true);
        try {
          const submitted = {
            ...values,
            ...Object.fromEntries(
              [...new FormData(form).entries()].filter(
                (entry): entry is [string, string] =>
                  typeof entry[1] === 'string',
              ),
            ),
          };
          const result = await onSubmit(submitted, form);
          setFeedback({
            ok: result.ok,
            text: result.ok
              ? '已保存，列表和操作审计已更新。'
              : (result.error?.message ?? '未能保存，请重试。'),
          });
          if (result.ok) {
            try {
              sessionStorage.removeItem(`op-form:${id}`);
            } catch {
              /* optional */
            }
            setValues(
              definitions({}).some((f) => f.initial !== undefined)
                ? submitted
                : Object.fromEntries(
                    definitions({}).map((f) => [f.key, f.initial ?? '']),
                  ),
            );
            form.reset();
            if (useDrawer) {
              setTimeout(() => setDrawerOpen(false), 600);
            }
          }
        } catch (error) {
          console.error('[operations-form]', id, error);
          setFeedback({ ok: false, text: '操作未完成，请检查输入后重试。' });
        } finally {
          setBusy(false);
        }
      }}
    >
      {description && !useDrawer && <p className="op-help mb-2">{description}</p>}
      {children}
      <div className="op-fields">
        {definitions(values).map((field) => (
          <div
            className={
              field.type === 'textarea' ? 'op-field op-wide' : 'op-field'
            }
            key={field.key}
          >
            <label htmlFor={`${uid}-${field.key}`} className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {field.label}
              {field.optional && <span className="text-slate-400 font-normal">（选填）</span>}
            </label>
            {field.options ? (
              <select
                id={`${uid}-${field.key}`}
                name={field.key}
                required={!field.optional}
                value={values[field.key] ?? field.initial ?? ''}
                onChange={(e) => change(field.key, e.target.value)}
                className="w-full h-9 px-2.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
              >
                <option value="">请选择</option>
                {field.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            ) : field.type === 'textarea' ? (
              <Textarea
                id={`${uid}-${field.key}`}
                name={field.key}
                required={!field.optional}
                value={values[field.key] ?? field.initial ?? ''}
                onChange={(e) => change(field.key, e.target.value)}
                rows={3}
                className="w-full text-xs"
              />
            ) : field.type === 'file' ? (
              <input
                id={`${uid}-${field.key}`}
                name={field.key}
                type="file"
                multiple={field.multiple}
                accept="video/*,image/*"
                required={!field.optional}
                className="w-full text-xs py-1"
              />
            ) : (
              <Input
                id={`${uid}-${field.key}`}
                name={field.key}
                type={field.type ?? 'text'}
                required={!field.optional}
                step={field.type === 'number' ? 'any' : undefined}
                value={values[field.key] ?? field.initial ?? ''}
                onChange={(e) => change(field.key, e.target.value)}
                className="w-full text-xs"
              />
            )}
            {field.hint && <small className="text-[11px] text-slate-400 mt-1 block">{field.hint}</small>}
          </div>
        ))}
      </div>
      <div className="op-form-footer pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center gap-3">
        <Button
          disabled={!ready || busy}
          className="op-button text-xs"
          type="submit"
        >
          {busy ? '保存中…' : submit}
        </Button>
        {useDrawer && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setDrawerOpen(false)}
            className="text-xs"
          >
            取消
          </Button>
        )}
        <span className="op-help text-[11px] text-slate-400">未提交的文字输入在本次浏览器会话保留</span>
      </div>
      {feedback && (
        <p
          role={feedback.ok ? 'status' : 'alert'}
          className={feedback.ok ? 'op-success text-xs' : 'op-error text-xs'}
        >
          {feedback.text}
        </p>
      )}
    </form>
  );

  if (useDrawer) {
    return (
      <div className="op-form-drawer-container my-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setDrawerOpen(true)}
          className="op-trigger-button inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 hover:text-blue-600 hover:border-blue-400 transition-colors shadow-xs"
        >
          <Plus className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
          <span>{title}</span>
        </Button>

        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title={title}
          description={description}
          width="xl"
        >
          {formElement}
        </Drawer>
      </div>
    );
  }

  return (
    <details className="op-form-panel" open={open || undefined}>
      <summary>{title}</summary>
      {formElement}
    </details>
  );
}

export function Action({
  name,
  act,
}: {
  name: string;
  act: () => CommandResult<unknown> | Promise<CommandResult<unknown>>;
}) {
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="op-inline">
      <Button
        className="op-button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await act();
            setFeedback(r.ok ? '已完成。' : (r.error?.message ?? '操作失败'));
          } catch {
            setFeedback('操作未确认完成，请刷新核对。');
          } finally {
            setBusy(false);
          }
        }}
      >
        {name}
      </Button>
      {feedback && <output>{feedback}</output>}
    </div>
  );
}

export { StatusBadge, type StatusType } from './status-badge';
export { ExclusiveLockPill } from './exclusive-lock-pill';
export { MetricCard, type MetricType } from './metric-card';
export { TerminalStream, type LogLine } from './terminal-stream';
export { Drawer, type DrawerWidth } from './drawer';
