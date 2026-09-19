import { createEmptyFirstLoopState } from './engine.ts';
import type { FirstLoopState } from './types.ts';

export const FIRST_LOOP_STORAGE_KEY = 'socialgrowth:first-loop:design-v1';

export interface StateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function hasStateShape(value: unknown): value is FirstLoopState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  return [
    'projects',
    'accountServiceRelations',
    'contentIdentities',
    'sliceAssets',
    'publicationAttempts',
    'destinationEntries',
    'destinationVersions',
    'destinationEvents',
    'strategyRules',
    'strategyDrafts',
    'executionApprovals',
    'publicationSchedules',
    'auditLogs',
  ].every((key) => Array.isArray(state[key]));
}

export function loadFirstLoopState(storage: StateStorage): FirstLoopState {
  const stored = storage.getItem(FIRST_LOOP_STORAGE_KEY);
  if (!stored) return createEmptyFirstLoopState();
  try {
    const parsed: unknown = JSON.parse(stored);
    return hasStateShape(parsed)
      ? structuredClone(parsed)
      : createEmptyFirstLoopState();
  } catch {
    return createEmptyFirstLoopState();
  }
}

export function saveFirstLoopState(
  storage: StateStorage,
  state: FirstLoopState,
): void {
  storage.setItem(FIRST_LOOP_STORAGE_KEY, JSON.stringify(state));
}
