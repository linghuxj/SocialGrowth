'use client';
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  FirstLoopEngine,
  createEmptyFirstLoopState,
  createCommandContext,
} from './first-loop/engine';
import type {
  CommandContext,
  CommandResult,
  FirstLoopState,
} from './first-loop/types';
type Command<T> = (
  engine: FirstLoopEngine,
  context: CommandContext,
) => CommandResult<T>;

export async function runtimeRequest<T>(
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/runtime${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const result: unknown = await response.json();
  if (!response.ok)
    throw new Error(
      (result as { error?: { code?: string } })?.error?.code ??
        'RUNTIME_UNAVAILABLE',
    );
  return result as T;
}
function createStore() {
  const initial = createEmptyFirstLoopState();
  let snapshot = initial;
  let revision = 0;
  let ready = false;
  let storageError = '';
  let running = false;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const hydrate = async () => {
    if (running) return;
    try {
      const result = await runtimeRequest<{
        state: FirstLoopState;
        revision: number;
      }>('/state');
      if (result.revision >= revision) {
        snapshot = result.state;
        revision = result.revision;
      }
      ready = true;
      storageError = '';
    } catch {
      ready = false;
      storageError =
        '无法连接执行服务，操作尚未保存。请启动本机运行时后重试；原浏览器数据仍保留。';
      snapshot = { ...snapshot };
    }
    emit();
  };
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => snapshot,
    server: () => initial,
    get ready() {
      return ready;
    },
    get storageError() {
      return storageError;
    },
    hydrate,
    run: async <T,>(command: Command<T>): Promise<CommandResult<T>> => {
      if (!ready || running)
        return {
          ok: false,
          error: {
            code: 'RUNTIME_NOT_READY',
            message: '执行服务未就绪或上一项操作尚未完成',
          },
        };
      running = true;
      try {
        let invocation: { method: string; args: unknown[] } | undefined;
        const proxy = new Proxy({} as FirstLoopEngine, {
          get:
            (_target, property) =>
            (...args: unknown[]) => {
              if (invocation) throw new Error('ONE_COMMAND_REQUIRED');
              invocation = { method: String(property), args };
              return { ok: true };
            },
        });
        command(proxy, createCommandContext('local-operator'));
        if (!invocation) throw new Error('COMMAND_REQUIRED');
        const result = await runtimeRequest<{
          result: CommandResult<T>;
          state: FirstLoopState;
          revision: number;
        }>('/commands', {
          requestId: crypto.randomUUID(),
          revision,
          ...invocation,
        });
        snapshot = result.state;
        revision = result.revision;
        emit();
        return result.result;
      } catch (error) {
        const code = error instanceof Error ? error.message : 'RUNTIME_FAILED';
        return {
          ok: false,
          error: {
            code,
            message:
              code === 'REVISION_CONFLICT'
                ? '数据已更新，请核对最新内容后重新提交。'
                : '操作未确认保存，请刷新核对审计记录后再处理；输入已保留。',
          },
        };
      } finally {
        running = false;
        await hydrate();
      }
    },
  };
}
type Context = {
  state: FirstLoopState;
  now: number;
  run: <T>(command: Command<T>) => Promise<CommandResult<T>>;
  ready: boolean;
  storageError: string;
  refresh: () => Promise<void>;
};
const OperationsContext = createContext<Context | null>(null);
export function OperationsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [store] = useState(createStore);
  const [now, setNow] = useState(Date.now);
  const state = useSyncExternalStore(store.subscribe, store.get, store.server);
  useEffect(() => {
    void store.hydrate();
    const timer = setInterval(() => {
      setNow(Date.now());
      void store.hydrate();
    }, 5000);
    return () => clearInterval(timer);
  }, [store]);
  return (
    <OperationsContext.Provider
      value={{
        state,
        now,
        run: store.run,
        ready: store.ready,
        storageError: store.storageError,
        refresh: store.hydrate,
      }}
    >
      {children}
    </OperationsContext.Provider>
  );
}
export function useOperations() {
  const value = useContext(OperationsContext);
  if (!value) throw new Error('OperationsProvider required');
  return value;
}
