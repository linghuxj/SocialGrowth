'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
  BasicReview,
  CommandResult,
  ContentIdentity,
  DestinationEntry,
  DestinationVersion,
  ExecutionApproval,
  FirstLoopState,
  MetricObservation,
  PublicationSchedule,
  Project,
  SliceAsset,
  StrategyDraft,
  StrategyRule,
} from './types';

interface FirstLoopContextValue {
  state: FirstLoopState;
  activeProjectId: string;
  selectProject: (projectId: string) => void;
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
  scheduleApproval: (
    input: Omit<PublicationSchedule, 'id' | 'status' | 'createdAt'>,
  ) => CommandResult<PublicationSchedule>;
  recordMetricObservation: (
    input: Omit<MetricObservation, 'id' | 'capturedAt'>,
  ) => CommandResult<MetricObservation>;
  createBasicReview: (input: {
    projectId: string;
    approvalId: string;
    primaryMetricKey: string;
    requiredWorkComplete: boolean;
    sourceComparisonAccepted: boolean;
  }) => CommandResult<BasicReview>;
  confirmReview: (
    reviewId: string,
    nextAction: NonNullable<BasicReview['nextAction']>,
  ) => CommandResult<BasicReview>;
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

export function FirstLoopProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<FirstLoopState>(createEmptyFirstLoopState);
  const [activeProjectId, setActiveProjectId] = useState('');
  const [engine] = useState(
    () =>
      new FirstLoopEngine(state, {
        logSink: (entry) =>
          console.info('[first-loop-audit]', JSON.stringify(entry)),
      }),
  );

  useEffect(() => {
    const persisted = loadFirstLoopState(window.localStorage);
    engine.replaceState(persisted);
    setState(persisted);
    setActiveProjectId(
      persisted.projects.find((item) => item.status !== 'exited')?.id ?? '',
    );
  }, [engine]);

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
      activeProjectId,
      selectProject: setActiveProjectId,
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
      scheduleApproval: (input) =>
        execute(() => engine.scheduleApproval(input, createCommandContext())),
      recordMetricObservation: (input) =>
        execute(() =>
          engine.recordMetricObservation(input, createCommandContext()),
        ),
      createBasicReview: (input) =>
        execute(() => engine.createBasicReview(input, createCommandContext())),
      confirmReview: (reviewId, nextAction) =>
        execute(() =>
          engine.confirmReview(reviewId, nextAction, createCommandContext()),
        ),
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
    [activeProjectId, engine, execute, state],
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
