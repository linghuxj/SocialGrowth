'use client';
import React, { useEffect, useId, useState, useRef } from 'react';
import type { CommandResult } from '@/lib/first-loop/types';
import { useOperations } from '@/lib/operations-context';
import { href, type PageId } from '@/lib/operations';

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
export function Status({ children }: { children: React.ReactNode }) {
  return <span className="op-status">{children}</span>;
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
}: {
  page: PageId;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <a className="op-link" href={href(page, id)}>
      {children}
    </a>
  );
}
export function Detail({
  title,
  children,
  page,
}: {
  title: string;
  children: React.ReactNode;
  page: PageId;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    ref.current?.scrollIntoView({ block: 'start' });
  }, []);
  return (
    <section className="op-detail" ref={ref} tabIndex={-1} aria-label={title}>
      <div className="op-row">
        <h2>{title}</h2>
        <Link page={page}>关闭详情</Link>
      </div>
      {children}
    </section>
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
          <table className="op-table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  {row.cells.map((cell, i) => (
                    <td key={i}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
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
}) {
  const { ready } = useOperations();
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
  return (
    <details className="op-form-panel" open={open || undefined}>
      <summary>{title}</summary>
      <form
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
            }
          } catch (error) {
            console.error('[operations-form]', id, error);
            setFeedback({ ok: false, text: '操作未完成，请检查输入后重试。' });
          } finally {
            setBusy(false);
          }
        }}
      >
        {description && <p className="op-help">{description}</p>}
        {children}
        <div className="op-fields">
          {definitions(values).map((field) => (
            <div
              className={
                field.type === 'textarea' ? 'op-field op-wide' : 'op-field'
              }
              key={field.key}
            >
              <label htmlFor={`${uid}-${field.key}`}>
                {field.label}
                {field.optional && <span>（选填）</span>}
              </label>
              {field.options ? (
                <select
                  id={`${uid}-${field.key}`}
                  name={field.key}
                  required={!field.optional}
                  value={values[field.key] ?? field.initial ?? ''}
                  onChange={(e) => change(field.key, e.target.value)}
                >
                  <option value="">请选择</option>
                  {field.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              ) : field.type === 'textarea' ? (
                <textarea
                  id={`${uid}-${field.key}`}
                  name={field.key}
                  required={!field.optional}
                  value={values[field.key] ?? field.initial ?? ''}
                  onChange={(e) => change(field.key, e.target.value)}
                  rows={3}
                />
              ) : field.type === 'file' ? (
                <input
                  id={`${uid}-${field.key}`}
                  name={field.key}
                  type="file"
                  accept="video/*,image/*"
                  required={!field.optional}
                />
              ) : (
                <input
                  id={`${uid}-${field.key}`}
                  name={field.key}
                  type={field.type ?? 'text'}
                  required={!field.optional}
                  step={field.type === 'number' ? 'any' : undefined}
                  value={values[field.key] ?? field.initial ?? ''}
                  onChange={(e) => change(field.key, e.target.value)}
                />
              )}
              {field.hint && <small>{field.hint}</small>}
            </div>
          ))}
        </div>
        <div className="op-form-footer">
          <button disabled={!ready || busy} className="op-button" type="submit">
            {busy ? '保存中…' : submit}
          </button>
          <span className="op-help">未提交的文字输入在本次浏览器会话保留</span>
        </div>
        {feedback && (
          <p
            role={feedback.ok ? 'status' : 'alert'}
            className={feedback.ok ? 'op-success' : 'op-error'}
          >
            {feedback.text}
          </p>
        )}
      </form>
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
      <button
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
      </button>
      {feedback && <output>{feedback}</output>}
    </div>
  );
}
