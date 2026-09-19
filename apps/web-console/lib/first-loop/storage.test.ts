import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyFirstLoopState } from './engine.ts';
import {
  FIRST_LOOP_STORAGE_KEY,
  loadFirstLoopState,
  saveFirstLoopState,
} from './storage.ts';

class MemoryStorage {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

void test('FL-01 storage boundary persists and reloads audit-ready state', () => {
  const storage = new MemoryStorage();
  const state = createEmptyFirstLoopState();
  state.projects.push({
    id: 'project-1',
    name: '受控项目',
    status: 'draft',
    createdAt: '2026-09-19T00:00:00Z',
    updatedAt: '2026-09-19T00:00:00Z',
  });
  saveFirstLoopState(storage, state);
  const reloaded = loadFirstLoopState(storage);
  assert.deepEqual(reloaded, state);
  assert.notEqual(reloaded, state);
});

void test('FL-01 storage boundary rejects malformed or structurally incomplete state', () => {
  const storage = new MemoryStorage();
  storage.setItem(FIRST_LOOP_STORAGE_KEY, '{bad json');
  assert.deepEqual(loadFirstLoopState(storage), createEmptyFirstLoopState());
  storage.setItem(FIRST_LOOP_STORAGE_KEY, JSON.stringify({ projects: [] }));
  assert.deepEqual(loadFirstLoopState(storage), createEmptyFirstLoopState());
});
