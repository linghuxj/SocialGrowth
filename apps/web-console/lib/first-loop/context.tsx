'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import {
  FirstLoopEngine,
  createCommandContext,
  createEmptyFirstLoopState,
} from './engine';
import { loadFirstLoopState, saveFirstLoopState } from './storage';
import type {
  AccountServiceRelation,
  CommandResult,
  ContentIdentity,
  DestinationEntry,
  DestinationVersion,
  ExecutionApproval,
  FirstLoopState,
  Project,
  SliceAsset,
  StrategyDraft,
  StrategyRule,
} from './types';

interface FirstLoopContextValue {
  state: FirstLoopState;
  saveProject: (
    input: Omit<Project, 'id' | 'status' | 'createdAt' | 'updatedAt'> & {
      id?: string;
    },
  ) => CommandResult<Project>;
  activateProject: (projectId: string) => CommandResult<Project>;
  grantAccountServiceRelation: (
    input: Omit<AccountServiceRelation, 'id' | 'createdAt'>,
  ) => CommandResult<AccountServiceRelation>;
  createDestination: (input: {
    projectId: string;
    accountId: string;
    scope: DestinationEntry['scope'];
    scopeId: string;
    url: string;
    maintenancePermissionRef: string;
    sharedAttribution: boolean;
    exitPolicy: DestinationEntry['exitPolicy'];
  }) => CommandResult<{ entry: DestinationEntry; version: DestinationVersion }>;
  addStrategyRule: (
    input: Omit<StrategyRule, 'id' | 'version' | 'status' | 'createdAt'>,
  ) => CommandResult<StrategyRule>;
  generateStrategyDraft: (input: {
    projectId: string;
    outputMode: StrategyDraft['outputMode'];
    rationale: string;
    assumptions: string[];
  }) => CommandResult<StrategyDraft>;
  approveStrategy: (
    input: Parameters<FirstLoopEngine['approveStrategy']>[0],
  ) => CommandResult<ExecutionApproval>;
  addContent: (input: {
    identityId?: string;
    title: string;
    sourceRef: string;
    storySummary: string;
    language: string;
    fileRef: string;
    sha256: string;
    rightsRef: string;
  }) => CommandResult<{ identity: ContentIdentity; asset: SliceAsset }>;
  allocateContent: (
    contentIdentityId: string,
    accountId: string,
    expectedVersion: number,
  ) => CommandResult<ContentIdentity>;
  projectGaps: (projectId: string) => string[];
}

const FirstLoopContext = createContext<FirstLoopContextValue | null>(null);

function loadInitialState(): FirstLoopState {
  if (typeof window === 'undefined') return createEmptyFirstLoopState();
  return loadFirstLoopState(window.localStorage);
}

export function FirstLoopProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<FirstLoopState>(loadInitialState);
  const [engine] = useState(
    () =>
      new FirstLoopEngine(state, {
        logSink: (entry) =>
          console.info('[first-loop-audit]', JSON.stringify(entry)),
      }),
  );

  const sync = useCallback(() => {
    const snapshot = engine.snapshot();
    setState(snapshot);
    saveFirstLoopState(window.localStorage, snapshot);
  }, [engine]);

  const execute = useCallback(
    <T,>(command: () => CommandResult<T>): CommandResult<T> => {
      const result = command();
      sync();
      return result;
    },
    [sync],
  );

  const value = useMemo<FirstLoopContextValue>(
    () => ({
      state,
      saveProject: (input) =>
        execute(() => engine.saveProjectDraft(input, createCommandContext())),
      activateProject: (projectId) =>
        execute(() =>
          engine.activateProject(projectId, createCommandContext()),
        ),
      grantAccountServiceRelation: (input) =>
        execute(() =>
          engine.grantAccountServiceRelation(input, createCommandContext()),
        ),
      createDestination: (input) =>
        execute(() => engine.createDestination(input, createCommandContext())),
      addStrategyRule: (input) =>
        execute(() => engine.addStrategyRule(input, createCommandContext())),
      generateStrategyDraft: (input) =>
        execute(() =>
          engine.generateStrategyDraft(input, createCommandContext()),
        ),
      approveStrategy: (input) =>
        execute(() => engine.approveStrategy(input, createCommandContext())),
      addContent: (input) =>
        execute(() =>
          engine.admitContent(
            {
              identity: input.identityId ? { id: input.identityId } : undefined,
              title: input.title,
              sourceRef: input.sourceRef,
              storySummary: input.storySummary,
              asset: {
                language: input.language,
                variant: 'subtitle',
                fileRef: input.fileRef,
                sha256: input.sha256,
                rightsRef: input.rightsRef,
                destinationFit: 'eligible',
              },
            },
            createCommandContext(),
          ),
        ),
      allocateContent: (contentIdentityId, accountId, expectedVersion) =>
        execute(() =>
          engine.allocateContent(
            contentIdentityId,
            accountId,
            expectedVersion,
            createCommandContext(),
          ),
        ),
      projectGaps: (projectId) =>
        engine.listProjectGaps(projectId).map((gap) => gap.message),
    }),
    [engine, execute, state],
  );

  return (
    <FirstLoopContext.Provider value={value}>
      {children}
    </FirstLoopContext.Provider>
  );
}

export function useFirstLoop(): FirstLoopContextValue {
  const value = useContext(FirstLoopContext);
  if (!value)
    throw new Error('useFirstLoop must be used within FirstLoopProvider');
  return value;
}
