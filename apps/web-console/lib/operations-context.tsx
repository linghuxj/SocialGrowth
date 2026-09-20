'use client';
import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { FirstLoopEngine, createEmptyFirstLoopState, createCommandContext } from './first-loop/engine';
import { FIRST_LOOP_STORAGE_KEY, loadFirstLoopState, saveFirstLoopState } from './first-loop/storage';
import type { CommandContext, CommandResult, FirstLoopState } from './first-loop/types';

type Command<T> = (engine: FirstLoopEngine, context: CommandContext) => CommandResult<T>;
function createStore() {
  const initial = createEmptyFirstLoopState();
  let snapshot = initial;
  let ready = false;
  let storageError = '';
  const listeners = new Set<() => void>();
  const engine = new FirstLoopEngine(initial, { logSink: (entry) => console.info('[operations-audit]',JSON.stringify(entry)) });
  const emit = () => listeners.forEach((listener) => listener());
  const hydrate = () => {
    try { snapshot = loadFirstLoopState(window.localStorage); engine.replaceState(snapshot); ready = true; storageError = ''; }
    catch { ready = false; storageError = '无法读取浏览器存储，请检查浏览器设置后刷新。'; }
    emit();
  };
  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    get: () => snapshot,
    server: () => initial,
    get ready() { return ready; },
    get storageError() { return storageError; },
    hydrate,
    run: <T,>(command: Command<T>): CommandResult<T> => {
      if (!ready) return {ok:false,error:{code:'STORAGE_NOT_READY',message:'本地存储尚未就绪'}};
      const previous = snapshot;
      try {
        engine.replaceState(loadFirstLoopState(window.localStorage));
        const result = command(engine, createCommandContext('local-operator'));
        const next = engine.snapshot();
        saveFirstLoopState(window.localStorage,next);
        snapshot = next;
        emit();
        return result;
      } catch (error) {
        engine.replaceState(previous);
        console.error('[operations-storage]', error instanceof Error ? error.message : 'unknown');
        return {ok:false,error:{code:'LOCAL_SAVE_FAILED',message:'操作未保存，请检查本地存储空间后重试。输入已保留。'}};
      }
    },
  };
}
type Context = { state: FirstLoopState; run: <T>(command: Command<T>) => CommandResult<T>; ready: boolean; storageError: string };
const OperationsContext = createContext<Context | null>(null);
export function OperationsProvider({children}:{children:React.ReactNode}) {
  const [store] = useState(createStore);
  const state = useSyncExternalStore(store.subscribe,store.get,store.server);
  useEffect(() => {
    store.hydrate();
    const sync = (event:StorageEvent) => { if (event.key === FIRST_LOOP_STORAGE_KEY) store.hydrate(); };
    window.addEventListener('storage',sync);
    return () => window.removeEventListener('storage',sync);
  },[store]);
  return <OperationsContext.Provider value={{state,run:store.run,ready:store.ready,storageError:store.storageError}}>{children}</OperationsContext.Provider>;
}
export function useOperations() { const value=useContext(OperationsContext); if (!value) throw new Error('OperationsProvider required'); return value; }
