import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FileRuntimeProfileRunReportRepository,
  InMemoryRuntimeProfileRunReportRepository,
  createAgentCycleTrace,
  createRuntimeProfileCognitionLlmStageDiagnostics,
  createRuntimeProfileAgentCycleDiagnostics,
  createPlannerExperimentRunsFromRuntimeProfileReports,
  createRuntimeProfileRunReport,
  type AgentCycleTrace,
  type DailyPlanRenewalTrace,
  type ObjectiveRenewalTrace,
  type PlannerExperimentMetric,
  type ReactionEvaluationTrace,
  type RuntimeProfileAgentCycleDiagnostics,
  type RuntimeProfileCognitionLlmStageDiagnostics,
  type RuntimeProfileRunReport,
} from './index';

const tmpRoots: string[] = [];

type AgentCycleWorldDecisionContextTrace = NonNullable<
  NonNullable<AgentCycleTrace['contextualPrioritization']>['worldDecisionContext']
>;
type ObjectiveWorldDecisionContextTrace = NonNullable<
  NonNullable<ObjectiveRenewalTrace['strategicPlan']>['worldDecisionContext']
>;

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
              events: [
                {
                  type: 'EducationChanged',
                  sequence: 10,
                  summary: 'study',
                  counterfactualStep: 1,
                  projectionEventCountBefore: 0,
                  projectionEventCountAfter: 1,
                },
              ],
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
              events: [
                {
                  type: 'TradeExecuted',
                  sequence: 12,
                  summary: 'buy Apple 1',
                  counterfactualStep: 2,
                  projectionEventCountBefore: 0,
                  projectionEventCountAfter: 1,
                },
              ],
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
      simulatorRolloutEventCount: 2,
      commandEmittingCycleCount: 2,
      fullReplanMaterializationCount: 2,
      commandEmittingCycleRatio: 2 / 3,
      fullReplanMaterializationRatio: 2 / 3,
      repairedSimulatorRatio: 1 / 3,
      rejectedSimulatorRatio: 1 / 3,
      replanningDecisionRatio: 2 / 3,
      simulatorRolloutCoverageRatio: 2 / 3,
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
      simulatorRolloutEventCount: 0,
      commandEmittingCycleCount: 0,
      fullReplanMaterializationCount: 0,
      commandEmittingCycleRatio: 0,
      fullReplanMaterializationRatio: 0,
      repairedSimulatorRatio: 0,
      rejectedSimulatorRatio: 0,
      replanningDecisionRatio: 0,
      simulatorRolloutCoverageRatio: 0,
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
          shortTermMemoryContext: { recordCount: 1 },
          longTermProfileContext: { entryCount: 1 },
          worldDecisionContext: createWorldDecisionContextTrace(),
        },
        actionSequenceGeneration: [
          {
            status: 'accepted',
            source: 'llm',
            selectedSubtask: { branchId: 'development', subtaskId: 'study' },
            shortTermMemoryContext: { recordCount: 1 },
            longTermProfileContext: { entryCount: 1 },
            worldDecisionContext: createWorldDecisionContextTrace(),
          },
          {
            status: 'fallback',
            source: 'deterministic-fallback',
            selectedSubtask: { branchId: 'development', subtaskId: 'study' },
            shortTermMemoryContext: { recordCount: 1 },
            longTermProfileContext: { entryCount: 1 },
            worldDecisionContext: createIncompleteWorldDecisionContextTrace(),
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
            shortTermMemoryContext: { recordCount: 1 },
            longTermProfileContext: { entryCount: 1 },
            worldDecisionContext: createWorldDecisionContextTrace(),
          },
        ],
        globalSynthesis: {
          status: 'fallback',
          source: 'deterministic-fallback',
          shortTermMemoryContext: { recordCount: 1 },
          longTermProfileContext: { entryCount: 1 },
          worldDecisionContext: createWorldDecisionContextTrace(),
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
              shortTermMemoryContext: { recordCount: 1 },
              longTermProfileContext: { entryCount: 1 },
              worldDecisionContext: createWorldDecisionContextTrace(),
            },
            outcome: 'repaired',
          },
        ],
        replanningDecisionTrace: {
          status: 'accepted',
          source: 'llm',
          requestId: 'llm-cycle:replanning-decision',
          providerId: 'scripted-replanning',
          model: 'replanning-model',
          decision: {
            kind: 'memory-guided-correction',
            trigger: 'simulator-rejection',
            reason: 'Use memory evidence before full replan.',
            failedActionIds: ['llm-cycle:action'],
            evidenceRecordIds: ['memory-food-shortage'],
          },
          shortTermMemoryContext: { recordCount: 1 },
          longTermProfileContext: { entryCount: 1 },
          worldDecisionContext: createWorldDecisionContextTrace(),
        },
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
        shortTermMemoryContextCount: 1,
        longTermProfileContextCount: 1,
        worldDecisionContextCount: 1,
        completeWorldDecisionContextCount: 1,
        rulesContextCount: 1,
        completeRulesContextCount: 1,
      },
      {
        stageName: 'actionSequenceGeneration',
        traceCount: 2,
        llmAcceptedCount: 1,
        deterministicFallbackCount: 1,
        deterministicCount: 0,
        missingCycleCount: 1,
        shortTermMemoryContextCount: 2,
        longTermProfileContextCount: 2,
        worldDecisionContextCount: 2,
        completeWorldDecisionContextCount: 1,
        rulesContextCount: 2,
        completeRulesContextCount: 2,
      },
      {
        stageName: 'socialDialogueGeneration',
        traceCount: 1,
        llmAcceptedCount: 1,
        deterministicFallbackCount: 0,
        deterministicCount: 0,
        missingCycleCount: 1,
        shortTermMemoryContextCount: 1,
        longTermProfileContextCount: 1,
        worldDecisionContextCount: 1,
        completeWorldDecisionContextCount: 1,
        rulesContextCount: 1,
        completeRulesContextCount: 1,
      },
      {
        stageName: 'globalSynthesis',
        traceCount: 1,
        llmAcceptedCount: 0,
        deterministicFallbackCount: 1,
        deterministicCount: 0,
        missingCycleCount: 1,
        shortTermMemoryContextCount: 1,
        longTermProfileContextCount: 1,
        worldDecisionContextCount: 1,
        completeWorldDecisionContextCount: 1,
        rulesContextCount: 1,
        completeRulesContextCount: 1,
      },
      {
        stageName: 'reactiveCorrection',
        traceCount: 1,
        llmAcceptedCount: 1,
        deterministicFallbackCount: 0,
        deterministicCount: 0,
        missingCycleCount: 1,
        shortTermMemoryContextCount: 1,
        longTermProfileContextCount: 1,
        worldDecisionContextCount: 1,
        completeWorldDecisionContextCount: 1,
        rulesContextCount: 1,
        completeRulesContextCount: 1,
      },
      {
        stageName: 'replanningDecision',
        traceCount: 1,
        llmAcceptedCount: 1,
        deterministicFallbackCount: 0,
        deterministicCount: 0,
        missingCycleCount: 1,
        shortTermMemoryContextCount: 1,
        longTermProfileContextCount: 1,
        worldDecisionContextCount: 1,
        completeWorldDecisionContextCount: 1,
        rulesContextCount: 1,
        completeRulesContextCount: 1,
      },
    ]);
  });

  test('does not count agent-cycle world context as complete without inventory, job, and location coverage', () => {
    const diagnostics = createRuntimeProfileAgentCycleDiagnostics([
      createTrace({
        traceId: 'agent-cycle-legacy-world-context',
        simulatorStatus: 'accepted',
        replanning: false,
        emittedCommandCount: 1,
        simulatorEvents: [],
        contextualPrioritization: {
          status: 'accepted',
          source: 'llm',
          worldDecisionContext:
            createLegacyWorldDecisionContextTraceWithoutAgentStateCoverage() as unknown as AgentCycleWorldDecisionContextTrace,
        },
      }),
    ]);

    expect(diagnostics.llmStageDiagnostics?.[0]).toMatchObject({
      stageName: 'contextualPrioritization',
      worldDecisionContextCount: 1,
      completeWorldDecisionContextCount: 0,
    });
  });

  test('summarizes cognition LLM stage diagnostics from durable profile traces', () => {
    const diagnostics = createRuntimeProfileCognitionLlmStageDiagnostics({
      objectiveRenewalTraces: [
        createObjectiveRenewalTrace({
          traceId: 'objective-accepted',
          strategicPlan: {
            status: 'accepted',
            source: 'llm',
            providerId: 'strategic-provider',
            model: 'strategic-model',
            worldDecisionContext: createWorldDecisionContextTrace(),
          },
        }),
        createObjectiveRenewalTrace({
          traceId: 'objective-missing-provider-trace',
        }),
      ],
      dailyPlanRenewalTraces: [
        createDailyPlanRenewalTrace({
          traceId: 'daily-fallback',
          planningTrace: {
            status: 'fallback',
            source: 'deterministic-fallback',
            providerId: 'daily-provider',
            model: 'daily-model',
            worldDecisionContext: createIncompleteWorldDecisionContextTrace(),
          },
        }),
      ],
      reactionEvaluationTraces: [
        createReactionEvaluationTrace({
          traceId: 'reaction-deterministic',
          reactionTrace: {
            status: 'deterministic',
            source: 'deterministic',
            message: 'static social rule',
            worldDecisionContext: createWorldDecisionContextTrace(),
          },
        }),
        createReactionEvaluationTrace({
          traceId: 'reaction-missing-provider-trace',
        }),
      ],
      reflectionSynthesisTraces: [
        {
          status: 'accepted',
          source: 'llm',
          worldDecisionContext: {
            agentId: 'agent-1',
            hasLocationId: true,
            hasPhysiology: true,
            hasJob: true,
            hasBalance: true,
            hasEducationScore: true,
            hasResidentialTier: true,
            hasInventory: true,
            inventoryItemCount: 2,
            marketSpotPriceCount: 1,
            hasLatestPriceIndex: true,
          },
        },
        {
          status: 'deterministic',
          source: 'deterministic',
        },
      ],
      socialModelSynthesisTraces: [
        {
          status: 'fallback',
          source: 'deterministic-fallback',
          worldDecisionContext: {
            agentId: 'agent-1',
            hasLocationId: true,
            hasPhysiology: true,
            hasJob: true,
            hasBalance: true,
            hasEducationScore: true,
            hasResidentialTier: true,
            hasInventory: true,
            inventoryItemCount: 2,
            marketSpotPriceCount: 1,
            hasLatestPriceIndex: true,
          },
        },
      ],
    });

    expect(diagnostics).toEqual([
      {
        stageName: 'strategicPlanning',
        traceCount: 2,
        llmAcceptedCount: 1,
        deterministicFallbackCount: 0,
        deterministicCount: 0,
        missingProviderTraceCount: 1,
        worldDecisionContextCount: 1,
        completeWorldDecisionContextCount: 1,
        rulesContextCount: 1,
        completeRulesContextCount: 1,
      },
      {
        stageName: 'dailyPlanning',
        traceCount: 1,
        llmAcceptedCount: 0,
        deterministicFallbackCount: 1,
        deterministicCount: 0,
        missingProviderTraceCount: 0,
        worldDecisionContextCount: 1,
        completeWorldDecisionContextCount: 0,
        rulesContextCount: 1,
        completeRulesContextCount: 1,
      },
      {
        stageName: 'reactionEvaluation',
        traceCount: 2,
        llmAcceptedCount: 0,
        deterministicFallbackCount: 0,
        deterministicCount: 1,
        missingProviderTraceCount: 1,
        worldDecisionContextCount: 1,
        completeWorldDecisionContextCount: 1,
        rulesContextCount: 1,
        completeRulesContextCount: 1,
      },
      {
        stageName: 'reflectionSynthesis',
        traceCount: 2,
        llmAcceptedCount: 1,
        deterministicFallbackCount: 0,
        deterministicCount: 1,
        missingProviderTraceCount: 0,
        worldDecisionContextCount: 1,
        completeWorldDecisionContextCount: 1,
        rulesContextCount: 0,
        completeRulesContextCount: 0,
      },
      {
        stageName: 'socialModelSynthesis',
        traceCount: 1,
        llmAcceptedCount: 0,
        deterministicFallbackCount: 1,
        deterministicCount: 0,
        missingProviderTraceCount: 0,
        worldDecisionContextCount: 1,
        completeWorldDecisionContextCount: 1,
        rulesContextCount: 0,
        completeRulesContextCount: 0,
      },
    ]);
  });

  test('does not count cognition world context as complete without inventory, job, and location coverage', () => {
    const diagnostics = createRuntimeProfileCognitionLlmStageDiagnostics({
      objectiveRenewalTraces: [
        createObjectiveRenewalTrace({
          traceId: 'cognition-legacy-world-context',
          strategicPlan: {
            status: 'accepted',
            source: 'llm',
            worldDecisionContext:
              createLegacyWorldDecisionContextTraceWithoutAgentStateCoverage() as unknown as ObjectiveWorldDecisionContextTrace,
          },
        }),
      ],
    });

    expect(diagnostics[0]).toMatchObject({
      stageName: 'strategicPlanning',
      worldDecisionContextCount: 1,
      completeWorldDecisionContextCount: 0,
    });
  });

  test('preserves cognition LLM stage diagnostics on runtime profile reports', () => {
    const diagnostics = createCognitionDiagnostics();
    const report = createReport({
      runId: 'run-with-cognition-diagnostics',
      cognitionLlmStageDiagnostics: diagnostics,
    });

    expect(report.cognitionLlmStageDiagnostics).toEqual(diagnostics);

    const cloned = createRuntimeProfileRunReport(report);
    expect(cloned.cognitionLlmStageDiagnostics).toEqual(diagnostics);
    Reflect.set(cloned.cognitionLlmStageDiagnostics![0]!, 'llmAcceptedCount', 99);

    expect(createRuntimeProfileRunReport(report).cognitionLlmStageDiagnostics).toEqual(diagnostics);
  });

  test('validates cognition LLM stage diagnostics', () => {
    expect(() =>
      createRuntimeProfileRunReport({
        ...createReport({ runId: 'invalid-cognition-diagnostics' }),
        cognitionLlmStageDiagnostics: [
          {
            stageName: 'strategicPlanning',
            traceCount: 1,
            llmAcceptedCount: -1,
            deterministicFallbackCount: 0,
            deterministicCount: 0,
            missingProviderTraceCount: 0,
            worldDecisionContextCount: 0,
            completeWorldDecisionContextCount: 0,
            rulesContextCount: 0,
            completeRulesContextCount: 0,
          },
        ],
      }),
    ).toThrow(
      'cognitionLlmStageDiagnostics strategicPlanning llmAcceptedCount must be a non-negative integer',
    );
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
  readonly cognitionLlmStageDiagnostics?: readonly RuntimeProfileCognitionLlmStageDiagnostics[];
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
    ...(input.cognitionLlmStageDiagnostics === undefined
      ? {}
      : { cognitionLlmStageDiagnostics: input.cognitionLlmStageDiagnostics }),
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
    simulatorRolloutEventCount: 12,
    commandEmittingCycleCount: 4,
    fullReplanMaterializationCount: 1,
    commandEmittingCycleRatio: 0.8,
    fullReplanMaterializationRatio: 0.2,
    repairedSimulatorRatio: 0.4,
    rejectedSimulatorRatio: 0.2,
    replanningDecisionRatio: 0.6,
    simulatorRolloutCoverageRatio: 1,
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
  readonly replanningDecisionTrace?: AgentCycleTrace['replanningDecisionTrace'];
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
    ...(input.replanningDecisionTrace === undefined
      ? {}
      : { replanningDecisionTrace: input.replanningDecisionTrace }),
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
    'replanningDecision',
  ].map((stageName) => ({
    stageName,
    traceCount: 0,
    llmAcceptedCount: 0,
    deterministicFallbackCount: 0,
    deterministicCount: 0,
    missingCycleCount: traceCount,
    shortTermMemoryContextCount: 0,
    longTermProfileContextCount: 0,
    worldDecisionContextCount: 0,
    completeWorldDecisionContextCount: 0,
    rulesContextCount: 0,
    completeRulesContextCount: 0,
  }));
}

function createWorldDecisionContextTrace() {
  return {
    agentId: 'agent-1',
    hasLocationId: true,
    hasPhysiology: true,
    hasJob: true,
    hasBalance: true,
    hasEducationScore: true,
    hasResidentialTier: true,
    hasInventory: true,
    inventoryItemCount: 2,
    marketSpotPriceCount: 1,
    hasLatestPriceIndex: true,
    occupationRuleCount: 4,
    eligibleOccupationRuleCount: 2,
    productionRuleCount: 6,
    producibleCommodityRuleCount: 3,
  };
}

function createLegacyWorldDecisionContextTraceWithoutAgentStateCoverage() {
  const { hasLocationId, hasJob, hasInventory, ...trace } = createWorldDecisionContextTrace();
  void hasLocationId;
  void hasJob;
  void hasInventory;
  return trace;
}

function createIncompleteWorldDecisionContextTrace() {
  return {
    ...createWorldDecisionContextTrace(),
    agentId: 'agent-incomplete-context',
    marketSpotPriceCount: 0,
    hasLatestPriceIndex: false,
  };
}

function createCognitionDiagnostics(): readonly RuntimeProfileCognitionLlmStageDiagnostics[] {
  return [
    {
      stageName: 'strategicPlanning',
      traceCount: 1,
      llmAcceptedCount: 1,
      deterministicFallbackCount: 0,
      deterministicCount: 0,
      missingProviderTraceCount: 0,
      worldDecisionContextCount: 0,
      completeWorldDecisionContextCount: 0,
      rulesContextCount: 0,
      completeRulesContextCount: 0,
    },
    {
      stageName: 'dailyPlanning',
      traceCount: 1,
      llmAcceptedCount: 0,
      deterministicFallbackCount: 1,
      deterministicCount: 0,
      missingProviderTraceCount: 0,
      worldDecisionContextCount: 0,
      completeWorldDecisionContextCount: 0,
      rulesContextCount: 0,
      completeRulesContextCount: 0,
    },
    {
      stageName: 'reactionEvaluation',
      traceCount: 0,
      llmAcceptedCount: 0,
      deterministicFallbackCount: 0,
      deterministicCount: 0,
      missingProviderTraceCount: 0,
      worldDecisionContextCount: 0,
      completeWorldDecisionContextCount: 0,
      rulesContextCount: 0,
      completeRulesContextCount: 0,
    },
    {
      stageName: 'reflectionSynthesis',
      traceCount: 0,
      llmAcceptedCount: 0,
      deterministicFallbackCount: 0,
      deterministicCount: 0,
      missingProviderTraceCount: 0,
      worldDecisionContextCount: 0,
      completeWorldDecisionContextCount: 0,
      rulesContextCount: 0,
      completeRulesContextCount: 0,
    },
    {
      stageName: 'socialModelSynthesis',
      traceCount: 0,
      llmAcceptedCount: 0,
      deterministicFallbackCount: 0,
      deterministicCount: 0,
      missingProviderTraceCount: 0,
      worldDecisionContextCount: 0,
      completeWorldDecisionContextCount: 0,
      rulesContextCount: 0,
      completeRulesContextCount: 0,
    },
  ];
}

function createObjectiveRenewalTrace(input: {
  readonly traceId: string;
  readonly strategicPlan?: ObjectiveRenewalTrace['strategicPlan'];
}): ObjectiveRenewalTrace {
  return {
    traceId: input.traceId,
    simulationId: 'aivilization-smoke-25',
    partitionKey: 'world-main',
    agentId: 'agent-1',
    objectiveId: `${input.traceId}:objective`,
    selectedCandidateId: 'education',
    rationale: 'fixture objective',
    score: 1,
    shortTermMemoryContextIds: [],
    profileEntryKeys: [],
    profileEvidenceRecordIds: [],
    ...(input.strategicPlan === undefined ? {} : { strategicPlan: input.strategicPlan }),
    issuedAt: 100,
  };
}

function createDailyPlanRenewalTrace(input: {
  readonly traceId: string;
  readonly planningTrace?: DailyPlanRenewalTrace['planningTrace'];
}): DailyPlanRenewalTrace {
  return {
    traceId: input.traceId,
    simulationId: 'aivilization-smoke-25',
    partitionKey: 'world-main',
    agentId: 'agent-1',
    dailyPlanId: `${input.traceId}:daily-plan`,
    scheduledIntentionIds: [],
    shortTermMemoryContextIds: [],
    profileEntryKeys: [],
    profileEvidenceRecordIds: [],
    ...(input.planningTrace === undefined ? {} : { planningTrace: input.planningTrace }),
    issuedAt: 100,
  };
}

function createReactionEvaluationTrace(input: {
  readonly traceId: string;
  readonly reactionTrace?: ReactionEvaluationTrace['reactionTrace'];
}): ReactionEvaluationTrace {
  return {
    traceId: input.traceId,
    simulationId: 'aivilization-smoke-25',
    partitionKey: 'world-main',
    agentId: 'agent-1',
    memoryRecordId: `${input.traceId}:memory`,
    decision: {
      kind: 'ignore',
      confidence: 0.7,
      rationale: 'fixture reaction',
    },
    ...(input.reactionTrace === undefined ? {} : { reactionTrace: input.reactionTrace }),
    issuedAt: 100,
  };
}
