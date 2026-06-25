import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FileRuntimeProfileRunReportRepository,
  InMemoryRuntimeProfileRunReportRepository,
  createAgentCycleTrace,
  createRuntimeProfileAgentCycleDiagnostics,
  createPlannerExperimentRunsFromRuntimeProfileReports,
  createRuntimeProfileRunReport,
  type AgentCycleTrace,
  type PlannerExperimentMetric,
  type RuntimeProfileAgentCycleDiagnostics,
  type RuntimeProfileRunReport,
} from './index';

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('runtime profile run report repositories', () => {
  test('records and queries in-memory reports idempotently', async () => {
    const repository = new InMemoryRuntimeProfileRunReportRepository();
    const older = createReport({ runId: 'run-100', generatedAt: 100 });
    const newer = createReport({ runId: 'run-200', generatedAt: 200 });
    const otherProfile = createReport({
      runId: 'run-other-profile',
      profileId: 'default-100',
      generatedAt: 300,
    });

    await repository.record(older);
    await repository.record(newer);
    await repository.record(otherProfile);
    await repository.record({
      ...newer,
      totalEventCount: 999,
    });

    await expect(repository.query({ profileId: 'smoke-25' })).resolves.toEqual([newer, older]);
    await expect(repository.query({ profileId: 'smoke-25', limit: 1 })).resolves.toEqual([newer]);
    await expect(
      repository.query({ profileId: 'smoke-25', fromGeneratedAt: 120, toGeneratedAt: 220 }),
    ).resolves.toEqual([newer]);
    await expect(repository.get('missing')).resolves.toBeUndefined();

    const read = await repository.get('run-200');
    if (read === undefined) {
      throw new Error('expected report to be readable');
    }
    Reflect.set(read, 'totalEventCount', 999);
    Reflect.set(read.partitions[0]!, 'eventCount', 999);
    Reflect.set(read.agentCycleDiagnostics, 'traceCount', 999);

    await expect(repository.get('run-200')).resolves.toEqual(newer);
  });

  test('persists file-backed reports across repository instances', async () => {
    const rootDir = createRootDir();
    const first = new FileRuntimeProfileRunReportRepository({ rootDir });
    const report = createReport({ runId: 'run-1', generatedAt: 100 });

    await first.record(report);
    await first.record({ ...report, totalEventCount: 999 });

    const restarted = new FileRuntimeProfileRunReportRepository({ rootDir });

    await expect(restarted.get('run-1')).resolves.toEqual(report);
    await expect(restarted.query({ profileId: 'smoke-25' })).resolves.toEqual([report]);
    await expect(restarted.query({ profileId: 'smoke-25', limit: 0 })).rejects.toThrow(
      'limit must be positive',
    );
  });

  test('preserves planner experiment metadata and maps reports to planner runs', async () => {
    const repository = new InMemoryRuntimeProfileRunReportRepository();
    const defaultMetric = { metricId: 'net-worth', value: 110_098, higherIsBetter: true };
    const ablatedMetric = { metricId: 'net-worth', value: 75_237, higherIsBetter: true };
    const defaultReport = createReport({
      runId: 'run-default',
      generatedAt: 200,
      plannerExperiment: createPlannerExperiment({
        variant: 'default',
        metrics: [defaultMetric],
      }),
    });
    const ablatedReport = createReport({
      runId: 'run-without-branch',
      generatedAt: 100,
      plannerExperiment: createPlannerExperiment({
        variant: 'without-branch',
        metrics: [ablatedMetric],
      }),
    });
    const nonExperimentReport = createReport({
      runId: 'run-non-experiment',
      profileId: 'default-100',
      generatedAt: 300,
    });

    await repository.record(ablatedReport);
    await repository.record(defaultReport);
    await repository.record(nonExperimentReport);

    await expect(repository.get('run-default')).resolves.toMatchObject({
      plannerExperiment: {
        taskId: 'high-tech-production',
        variant: 'default',
        metrics: [defaultMetric],
      },
    });

    const plannerRuns = createPlannerExperimentRunsFromRuntimeProfileReports(
      await repository.query({}),
    );

    expect(plannerRuns).toEqual([
      {
        taskId: 'high-tech-production',
        variant: 'default',
        metrics: [defaultMetric],
      },
      {
        taskId: 'high-tech-production',
        variant: 'without-branch',
        metrics: [ablatedMetric],
      },
    ]);
  });

  test('validates profile agent cycle diagnostics', () => {
    expect(() =>
      createRuntimeProfileRunReport({
        ...createReport({ runId: 'invalid-diagnostics-ratio' }),
        agentCycleDiagnostics: {
          ...createDiagnostics(),
          repairedSimulatorRatio: 1.1,
        },
      }),
    ).toThrow('agentCycleDiagnostics repairedSimulatorRatio must be between 0 and 1');
    expect(() =>
      createRuntimeProfileRunReport({
        ...createReport({ runId: 'invalid-diagnostics-count' }),
        agentCycleDiagnostics: {
          ...createDiagnostics(),
          traceCount: -1,
        },
      }),
    ).toThrow('agentCycleDiagnostics traceCount must be a non-negative integer');
    expect(() =>
      createRuntimeProfileRunReport({
        ...createReport({ runId: 'invalid-full-replan-materialization-ratio' }),
        agentCycleDiagnostics: {
          ...createDiagnostics(),
          fullReplanMaterializationRatio: 1.1,
        },
      }),
    ).toThrow('agentCycleDiagnostics fullReplanMaterializationRatio must be between 0 and 1');
    expect(() =>
      createRuntimeProfileRunReport({
        ...createReport({ runId: 'invalid-full-replan-materialization-count' }),
        agentCycleDiagnostics: {
          ...createDiagnostics(),
          fullReplanMaterializationCount: 6,
        },
      }),
    ).toThrow('agentCycleDiagnostics fullReplanMaterializationCount must not exceed traceCount');
  });

  test('summarizes agent cycle diagnostics from traces', () => {
    expect(
      createRuntimeProfileAgentCycleDiagnostics([
        createTrace({
          traceId: 'accepted-with-command',
          simulatorStatus: 'accepted',
          replanning: false,
          emittedCommandCount: 1,
          simulatorEvents: [
            {
              actionId: 'study-1',
              attempt: 'original',
              status: 'accepted',
              events: [{ type: 'EducationChanged', sequence: 10, summary: 'study' }],
            },
          ],
        }),
        createTrace({
          traceId: 'repaired-with-events',
          simulatorStatus: 'repaired',
          replanning: true,
          emittedCommandCount: 2,
          replanMaterialization: {
            status: 'replanned',
            objectiveId: 'objective-eat',
            planId: 'objective-eat',
            progressReset: true,
            trigger: 'repeated-failure',
            failedActionIds: ['eat-1'],
            evidenceRecordIds: ['stm-eat-failure'],
            matchingFailureCount: 2,
          },
          simulatorEvents: [
            {
              actionId: 'eat-1',
              attempt: 'original',
              status: 'rejected',
              reason: 'insufficient Apple',
              events: [{ type: 'ActionRejected', sequence: 11, summary: 'insufficient Apple' }],
            },
            {
              actionId: 'buy-apple-1',
              attempt: 'repair',
              status: 'accepted',
              events: [{ type: 'TradeExecuted', sequence: 12, summary: 'buy Apple 1' }],
            },
          ],
        }),
        createTrace({
          traceId: 'rejected-no-command',
          simulatorStatus: 'rejected',
          replanning: true,
          emittedCommandCount: 0,
          replanMaterialization: {
            status: 'skipped',
            planId: 'objective-study',
            reason: 'missing-active-objective',
          },
          simulatorEvents: [],
        }),
      ]),
    ).toEqual({
      traceCount: 3,
      acceptedSimulatorCount: 1,
      repairedSimulatorCount: 1,
      rejectedSimulatorCount: 1,
      replanningDecisionCount: 2,
      simulatorEventTraceCount: 3,
      simulatorEventCount: 3,
      commandEmittingCycleCount: 2,
      fullReplanMaterializationCount: 2,
      commandEmittingCycleRatio: 2 / 3,
      fullReplanMaterializationRatio: 2 / 3,
      repairedSimulatorRatio: 1 / 3,
      rejectedSimulatorRatio: 1 / 3,
      replanningDecisionRatio: 2 / 3,
      llmStageDiagnostics: createEmptyLlmStageDiagnostics(3),
    });
    expect(createRuntimeProfileAgentCycleDiagnostics([])).toEqual({
      traceCount: 0,
      acceptedSimulatorCount: 0,
      repairedSimulatorCount: 0,
      rejectedSimulatorCount: 0,
      replanningDecisionCount: 0,
      simulatorEventTraceCount: 0,
      simulatorEventCount: 0,
      commandEmittingCycleCount: 0,
      fullReplanMaterializationCount: 0,
      commandEmittingCycleRatio: 0,
      fullReplanMaterializationRatio: 0,
      repairedSimulatorRatio: 0,
      rejectedSimulatorRatio: 0,
      replanningDecisionRatio: 0,
      llmStageDiagnostics: createEmptyLlmStageDiagnostics(0),
    });
  });

  test('summarizes agent-cycle LLM stage diagnostics from durable traces', () => {
    const diagnostics = createRuntimeProfileAgentCycleDiagnostics([
      createTrace({
        traceId: 'llm-cycle',
        simulatorStatus: 'repaired',
        replanning: true,
        emittedCommandCount: 1,
        simulatorEvents: [],
        contextualPrioritization: {
          status: 'accepted',
          source: 'llm',
        },
        actionSequenceGeneration: [
          {
            status: 'accepted',
            source: 'llm',
            selectedSubtask: { branchId: 'development', subtaskId: 'study' },
          },
          {
            status: 'fallback',
            source: 'deterministic-fallback',
            selectedSubtask: { branchId: 'development', subtaskId: 'study' },
          },
        ],
        socialDialogueGeneration: [
          {
            status: 'accepted',
            source: 'llm',
            selectedSubtask: { branchId: 'social', subtaskId: 'talk' },
            actionId: 'conversation-1',
            targetAgentId: 'agent-2',
            turnCount: 2,
            rationale: 'LLM dialogue accepted.',
          },
        ],
        globalSynthesis: {
          status: 'fallback',
          source: 'deterministic-fallback',
        },
        actionRepair: [
          {
            actionId: 'eat-1',
            rejectionReason: 'insufficient Apple',
            selectedSubtask: { branchId: 'recovery', subtaskId: 'eat' },
            localRepair: { status: 'skipped' },
            reactiveCorrection: {
              status: 'accepted',
              source: 'llm',
              decision: {
                kind: 'propose-action',
                rationale: 'Buy food before eating.',
                evidenceRecordIds: ['memory-food-shortage'],
                action: {
                  id: 'buy-apple-1',
                  description: 'buy Apple',
                  commandType: 'AgentTrade',
                },
              },
            },
            outcome: 'repaired',
          },
        ],
      }),
      createTrace({
        traceId: 'missing-llm-stage-cycle',
        simulatorStatus: 'accepted',
        replanning: false,
        emittedCommandCount: 1,
        simulatorEvents: [],
      }),
    ]);

    expect(diagnostics.llmStageDiagnostics).toEqual([
      {
        stageName: 'contextualPrioritization',
        traceCount: 1,
        llmAcceptedCount: 1,
        deterministicFallbackCount: 0,
        deterministicCount: 0,
        missingCycleCount: 1,
      },
      {
        stageName: 'actionSequenceGeneration',
        traceCount: 2,
        llmAcceptedCount: 1,
        deterministicFallbackCount: 1,
        deterministicCount: 0,
        missingCycleCount: 1,
      },
      {
        stageName: 'socialDialogueGeneration',
        traceCount: 1,
        llmAcceptedCount: 1,
        deterministicFallbackCount: 0,
        deterministicCount: 0,
        missingCycleCount: 1,
      },
      {
        stageName: 'globalSynthesis',
        traceCount: 1,
        llmAcceptedCount: 0,
        deterministicFallbackCount: 1,
        deterministicCount: 0,
        missingCycleCount: 1,
      },
      {
        stageName: 'reactiveCorrection',
        traceCount: 1,
        llmAcceptedCount: 1,
        deterministicFallbackCount: 0,
        deterministicCount: 0,
        missingCycleCount: 1,
      },
    ]);
  });
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-profile-run-reports-'));
  tmpRoots.push(root);
  return root;
}

function createReport(input: {
  readonly runId: string;
  readonly profileId?: string;
  readonly generatedAt?: number;
  readonly plannerExperiment?: {
    readonly taskId: string;
    readonly variant: string;
    readonly metrics: readonly PlannerExperimentMetric[];
  };
}): RuntimeProfileRunReport {
  return createRuntimeProfileRunReport({
    runId: input.runId,
    profileId: input.profileId ?? 'smoke-25',
    manifestId: `aivilization-${input.profileId ?? 'smoke-25'}`,
    rootDir: '/tmp/aivilization-profile-run',
    generatedAt: input.generatedAt ?? 100,
    requestedAt: 50,
    daemonHealth: 'healthy',
    outcome: 'succeeded',
    requestedCycleCount: 2,
    completedCycleCount: 2,
    stopReason: 'cycle-count-completed',
    partitionCount: 1,
    totalProjectionAgentCount: 25,
    totalEventCount: 10,
    totalAgentTraceCount: 5,
    agentCycleDiagnostics: createDiagnostics(),
    ...(input.plannerExperiment === undefined
      ? {}
      : { plannerExperiment: input.plannerExperiment }),
    partitions: [
      {
        simulationId: 'aivilization-smoke-25',
        partitionKey: 'world-main',
        scenarioPresetId: 'aivilization-smoke-25-world-main',
        status: 'succeeded',
        health: 'healthy',
        lastAppliedSequence: 10,
        streamVersion: 10,
        eventCount: 10,
        projectionAgentCount: 25,
        agentTraceCount: 5,
      },
    ],
  });
}

function createDiagnostics(): RuntimeProfileAgentCycleDiagnostics {
  return {
    traceCount: 5,
    acceptedSimulatorCount: 2,
    repairedSimulatorCount: 2,
    rejectedSimulatorCount: 1,
    replanningDecisionCount: 3,
    simulatorEventTraceCount: 7,
    simulatorEventCount: 12,
    commandEmittingCycleCount: 4,
    fullReplanMaterializationCount: 1,
    commandEmittingCycleRatio: 0.8,
    fullReplanMaterializationRatio: 0.2,
    repairedSimulatorRatio: 0.4,
    rejectedSimulatorRatio: 0.2,
    replanningDecisionRatio: 0.6,
  };
}

function createPlannerExperiment(input: {
  readonly variant: string;
  readonly metrics: readonly PlannerExperimentMetric[];
}) {
  return {
    taskId: 'high-tech-production',
    variant: input.variant,
    metrics: input.metrics,
  };
}

function createTrace(input: {
  readonly traceId: string;
  readonly simulatorStatus: 'accepted' | 'repaired' | 'rejected';
  readonly replanning: boolean;
  readonly emittedCommandCount: number;
  readonly simulatorEvents: AgentCycleTrace['simulatorEvents'];
  readonly replanMaterialization?: AgentCycleTrace['replanMaterialization'];
  readonly contextualPrioritization?: AgentCycleTrace['contextualPrioritization'];
  readonly actionSequenceGeneration?: AgentCycleTrace['actionSequenceGeneration'];
  readonly socialDialogueGeneration?: AgentCycleTrace['socialDialogueGeneration'];
  readonly globalSynthesis?: AgentCycleTrace['globalSynthesis'];
  readonly actionRepair?: AgentCycleTrace['actionRepair'];
}): AgentCycleTrace {
  return createAgentCycleTrace({
    traceId: input.traceId,
    simulationId: 'sim-1',
    agentId: `${input.traceId}:agent`,
    cycleStartedAt: 100,
    observedStateSummary: 'energy=50 satiety=80 health=100 education=10',
    selectedBranch: 'development',
    ...(input.contextualPrioritization === undefined
      ? {}
      : { contextualPrioritization: input.contextualPrioritization }),
    ...(input.actionSequenceGeneration === undefined
      ? {}
      : { actionSequenceGeneration: input.actionSequenceGeneration }),
    ...(input.socialDialogueGeneration === undefined
      ? {}
      : { socialDialogueGeneration: input.socialDialogueGeneration }),
    ...(input.globalSynthesis === undefined ? {} : { globalSynthesis: input.globalSynthesis }),
    ...(input.actionRepair === undefined ? {} : { actionRepair: input.actionRepair }),
    subtaskCandidates: [
      {
        branchId: 'development',
        subtaskId: 'study',
        description: 'study',
        score: 5,
        scoreBreakdown: {
          basePriorityScore: 5,
          signalInfluenceScore: 0,
          intentionInfluenceScore: 0,
          memoryInfluenceScore: 0,
          profileInfluenceScore: 0,
        },
      },
    ],
    actionSynthesis: {
      acceptedActions: [
        {
          id: `${input.traceId}:action`,
          description: 'Study',
          commandType: 'AgentStudy',
        },
      ],
      rejectedActions: [],
    },
    candidateActions: ['Study'],
    simulatorResult:
      input.simulatorStatus === 'accepted'
        ? { status: 'accepted' }
        : { status: input.simulatorStatus, reason: `${input.simulatorStatus} fixture` },
    simulatorEvents: input.simulatorEvents,
    selectionEvidence: {
      selectedSubtaskId: 'study',
      intentionInfluenceScore: 0,
      memoryInfluenceScore: 0,
      profileInfluenceScore: 0,
      memoryEvidenceRecordIds: [],
      profileEntryKeys: [],
      profileEvidenceRecordIds: [],
    },
    replanningDecision: input.replanning
      ? {
          kind: 'memory-guided-correction',
          trigger: 'simulator-rejection',
          reason: 'fixture repair',
          failedActionIds: [`${input.traceId}:action`],
          evidenceRecordIds: [],
        }
      : { kind: 'none' },
    ...(input.replanMaterialization === undefined
      ? {}
      : { replanMaterialization: input.replanMaterialization }),
    subtaskReplanningDecisions: [
      {
        branchId: 'development',
        subtaskId: 'study',
        decision: input.replanning
          ? {
              kind: 'memory-guided-correction',
              trigger: 'simulator-rejection',
              reason: 'fixture repair',
              failedActionIds: [`${input.traceId}:action`],
              evidenceRecordIds: [],
            }
          : { kind: 'none' },
      },
    ],
    emittedCommandIds: Array.from(
      { length: input.emittedCommandCount },
      (_, index) => `${input.traceId}:command-${index + 1}`,
    ),
    memoryContextIds: [],
    memoryWriteIds: [],
  });
}

function createEmptyLlmStageDiagnostics(traceCount: number) {
  return [
    'contextualPrioritization',
    'actionSequenceGeneration',
    'socialDialogueGeneration',
    'globalSynthesis',
    'reactiveCorrection',
  ].map((stageName) => ({
    stageName,
    traceCount: 0,
    llmAcceptedCount: 0,
    deterministicFallbackCount: 0,
    deterministicCount: 0,
    missingCycleCount: traceCount,
  }));
}
