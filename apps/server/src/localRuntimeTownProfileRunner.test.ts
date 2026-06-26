import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ActionSequenceGenerator,
  FileBranchPlanRepository,
  type GlobalActionSynthesizer,
  type ReactiveCorrector,
  type ReplanningDecider,
  type SocialDialogueGenerator,
  type SubtaskPrioritizer,
  createBranchPlan,
  createDailyPlan,
} from '@aivilization/agent-runtime';
import { FileAgentIntentionRepository, FileShortTermMemoryRepository } from '@aivilization/memory';
import type { LlmProviderCompletionRequest } from '@aivilization/llm';
import {
  FileAgentCycleTraceRepository,
  FileDailyPlanRenewalTraceRepository,
  FileObjectiveRenewalTraceRepository,
  FileReactionEvaluationTraceRepository,
  InMemoryRuntimeProfileRunReportRepository,
} from '@aivilization/observability';
import { asAgentId } from '@aivilization/sim-core';
import { createWorldProjection } from '@aivilization/world';
import { afterEach, describe, expect, test } from 'vitest';
import { createLocalWorldRuntimeStorage } from '@aivilization/worker';
import {
  createLocalRuntimeTownProfileAgentProvider,
  createLocalRuntimeTownProfileWorldPolicies,
  runLocalRuntimeTownDaemonScenarioProfile,
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

describe('local runtime town profile runner', () => {
  test('default profile world policies include source-backed residential physiology caps', () => {
    const policies = createLocalRuntimeTownProfileWorldPolicies()(
      createWorldProjection({
        agents: [
          {
            agentId: asAgentId('profile-policy-agent'),
            physiology: { energy: 500, satiety: 500, health: 500 },
            educationScore: 31,
            balance: 100,
            residentialTier: 5,
            job: 'Stock Clerk',
            inventory: {},
          },
        ],
      }),
    );

    expect(policies.residentialPhysiologyCaps?.caps).toContainEqual({
      residentialTier: 5,
      maxEnergy: 500,
      maxSatiety: 500,
      maxHealth: 500,
    });
  });

  test('runs the smoke profile headlessly with default canonical agents', async () => {
    const rootDir = createRootDir();

    const summary = await runLocalRuntimeTownDaemonScenarioProfile({
      profileId: 'smoke-25',
      rootDir,
      cycleCount: 1,
      requestedAt: 100,
    });

    expect(summary).toMatchObject({
      profileId: 'smoke-25',
      manifestId: 'aivilization-smoke-25',
      rootDir,
      run: {
        traceId: 'aivilization-smoke-25:profile-run:100',
        outcome: 'succeeded',
        requestedCycleCount: 1,
        completedCycleCount: 1,
        stopReason: 'cycle-count-completed',
      },
      daemonHealth: 'healthy',
      partitionCount: 1,
      totalProjectionAgentCount: 25,
    });
    expect(summary.totalEventCount).toBeGreaterThan(summary.partitionCount);
    expect(summary.totalAgentTraceCount).toBeGreaterThan(0);
    expect(summary.agentCycleDiagnostics.traceCount).toBe(summary.totalAgentTraceCount);
    expect(summary.agentCycleDiagnostics.acceptedSimulatorCount).toBeGreaterThan(0);
    expect(summary.agentCycleDiagnostics.commandEmittingCycleCount).toBeGreaterThan(0);
    expect(summary.agentCycleDiagnostics.simulatorEventTraceCount).toBeGreaterThan(0);
    expect(summary.partitions).toEqual([
      expect.objectContaining({
        simulationId: 'aivilization-smoke-25',
        partitionKey: 'world-main',
        scenarioPresetId: 'aivilization-smoke-25-world-main',
        health: 'healthy',
        projectionAgentCount: 25,
      }),
    ]);
  });

  test('routes profile run memory context into later agent cycle traces by default', async () => {
    const rootDir = createRootDir();

    const summary = await runLocalRuntimeTownDaemonScenarioProfile({
      profileId: 'smoke-25',
      rootDir,
      cycleCount: 2,
      requestedAt: 160,
      cycleIntervalMs: 100,
    });
    const traceRepository = new FileAgentCycleTraceRepository({
      rootDir: join(
        rootDir,
        'simulations',
        'aivilization-smoke-25',
        'partitions',
        'world-main',
        'observability',
      ),
    });
    const traces = await traceRepository.query({
      simulationId: 'aivilization-smoke-25',
    });

    expect(summary.run.completedCycleCount).toBe(2);
    expect(traces.some((trace) => trace.memoryContextIds.length > 0)).toBe(true);
  });

  test('summarizes multi-partition default profile runs', async () => {
    const rootDir = createRootDir();

    const summary = await runLocalRuntimeTownDaemonScenarioProfile({
      profileId: 'default-100',
      rootDir,
      cycleCount: 2,
      requestedAt: 250,
      cycleIntervalMs: 100,
    });

    expect(summary).toMatchObject({
      profileId: 'default-100',
      manifestId: 'aivilization-default-100',
      rootDir,
      daemonHealth: 'healthy',
      partitionCount: 2,
      totalProjectionAgentCount: 100,
      run: {
        traceId: 'aivilization-default-100:profile-run:250',
        outcome: 'succeeded',
        requestedCycleCount: 2,
        completedCycleCount: 2,
        stopReason: 'cycle-count-completed',
      },
    });
    expect(summary.partitions.map((partition) => partition.partitionKey)).toEqual([
      'world-main',
      'world-east',
    ]);
    expect(summary.partitions).toEqual([
      expect.objectContaining({
        simulationId: 'aivilization-default-100',
        partitionKey: 'world-main',
        projectionAgentCount: 50,
      }),
      expect.objectContaining({
        simulationId: 'aivilization-default-100',
        partitionKey: 'world-east',
        projectionAgentCount: 50,
      }),
    ]);
    for (const partition of summary.partitions) {
      expect(partition.streamVersion).toBe(partition.eventCount);
      expect(partition.eventCount).toBeGreaterThan(2);
      expect(partition.agentTraceCount).toBeGreaterThan(0);
    }
  });

  test('records a runtime profile run report when a repository is supplied', async () => {
    const rootDir = createRootDir();
    const repository = new InMemoryRuntimeProfileRunReportRepository();

    const summary = await runLocalRuntimeTownDaemonScenarioProfile({
      profileId: 'smoke-25',
      rootDir,
      cycleCount: 1,
      requestedAt: 100,
      reportGeneratedAt: 150,
      profileRunReportRepository: repository,
    });

    await expect(repository.get(summary.run.traceId)).resolves.toMatchObject({
      runId: 'aivilization-smoke-25:profile-run:100',
      profileId: 'smoke-25',
      manifestId: 'aivilization-smoke-25',
      rootDir,
      generatedAt: 150,
      requestedAt: 100,
      daemonHealth: 'healthy',
      outcome: 'succeeded',
      requestedCycleCount: 1,
      completedCycleCount: 1,
      stopReason: 'cycle-count-completed',
      partitionCount: 1,
      totalProjectionAgentCount: 25,
      totalEventCount: summary.totalEventCount,
      totalAgentTraceCount: summary.totalAgentTraceCount,
      agentCycleDiagnostics: summary.agentCycleDiagnostics,
      partitions: summary.partitions,
    });
  });

  test('records planner experiment metadata on runtime profile run reports', async () => {
    const rootDir = createRootDir();
    const repository = new InMemoryRuntimeProfileRunReportRepository();

    const summary = await runLocalRuntimeTownDaemonScenarioProfile({
      profileId: 'smoke-25',
      rootDir,
      cycleCount: 1,
      requestedAt: 120,
      reportGeneratedAt: 180,
      profileRunReportRepository: repository,
      plannerExperiment: {
        taskId: 'high-tech-production',
        variant: 'without-branch',
        metrics: [{ metricId: 'completed-cycle-count', value: 1, higherIsBetter: true }],
      },
    });

    await expect(repository.get(summary.run.traceId)).resolves.toMatchObject({
      runId: 'aivilization-smoke-25:profile-run:120',
      plannerExperiment: {
        taskId: 'high-tech-production',
        variant: 'without-branch',
        metrics: [{ metricId: 'completed-cycle-count', value: 1, higherIsBetter: true }],
      },
    });
  });

  test('records experiment validation reports after profile runs when validation schedule is supplied', async () => {
    const rootDir = createRootDir();

    const summary = await runLocalRuntimeTownDaemonScenarioProfile({
      profileId: 'smoke-25',
      rootDir,
      cycleCount: 2,
      requestedAt: 110,
      cycleIntervalMs: 100,
      reportGeneratedAt: 170,
      agentProvider: () => [
        {
          agentId: asAgentId('smoke-25-world-main-agent-001'),
          observedStateSummary: 'agent-001 is validating market trade observations.',
          plan: createBranchPlan({
            objective: 'Buy fish to generate market validation observations.',
            branches: [
              {
                id: 'market-validation',
                objective: 'Create real market trades.',
                subtasks: [
                  {
                    id: 'buy-fish',
                    description: 'buy Fish from the market',
                    basePriority: 10,
                  },
                ],
              },
            ],
          }),
          signals: [],
          microPlanners: [
            {
              domain: 'trade',
              supports: ({ subtaskId }) => subtaskId === 'buy-fish',
              propose: () => [
                {
                  id: 'buy-fish',
                  description: 'buy Fish 1',
                  commandType: 'AgentTrade',
                  payload: { side: 'buy', commodityName: 'Fish', quantity: 1 },
                },
              ],
            },
          ],
          simulate: ({ action }) => ({ status: 'accepted', action }),
        },
      ],
      experimentValidationSchedule: {
        plannerRuns: createValidationPlannerRuns(),
        expectedTrajectoryAgentIds: ['smoke-25-world-main-agent-001'],
        thresholds: {
          marketStability: {
            maximumLogPriceRange: 10,
            maximumDrawdown: 1,
            minimumLogReturnStandardDeviation: 0,
          },
          heavyTailReturns: {
            minimumExcessKurtosis: -2,
            minimumReturnObservationCount: 1,
          },
          volatilityClustering: {
            minimumLagOneAbsoluteReturnAutocorrelation: -1,
            minimumReturnObservationCount: 1,
          },
          plannerAblation: {
            minimumDefaultWinRate: 1,
          },
        },
        reportGate: {
          criteriaId: 'profile-validation-gate',
          defaultAllowedStatuses: ['pass', 'watch'],
        },
      },
    });

    expect(summary).toMatchObject({
      experimentValidationReports: [
        {
          simulationId: 'aivilization-smoke-25',
          partitionKey: 'world-main',
          runId: 'aivilization-smoke-25:profile-run:110:world-main:experiment-validation',
          generatedAt: 170,
          source: 'local-runtime-profile-validation',
          gateStatus: 'pass',
          gateFailureCount: 0,
          metricStatusCounts: {
            fail: 0,
          },
        },
      ],
    });
    const validationSummary = summary.experimentValidationReports?.[0];
    expect(validationSummary?.eventCount).toBeGreaterThan(0);
    expect(validationSummary?.metricStatusCounts.pass).toBeGreaterThan(0);
    expect(validationSummary?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'market-stability',
          label: 'Market stability',
          status: expect.any(String),
          value: expect.any(Number),
          unit: expect.any(String),
          evidence: expect.objectContaining({
            observationCount: expect.any(Number),
            maximumLogPriceRange: expect.any(Number),
          }),
        }),
      ]),
    );

    const storage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'aivilization-smoke-25',
      partitionKey: 'world-main',
    });
    await expect(
      storage.experimentValidationReportRepository.get(
        'aivilization-smoke-25:profile-run:110:world-main:experiment-validation',
      ),
    ).resolves.toMatchObject({
      run: {
        runId: 'aivilization-smoke-25:profile-run:110:world-main:experiment-validation',
        simulationId: 'aivilization-smoke-25',
        generatedAt: 170,
        source: 'local-runtime-profile-validation',
      },
    });
  });

  test('uses a run id suffix for variant-safe profile run reports', async () => {
    const rootDir = createRootDir();
    const repository = new InMemoryRuntimeProfileRunReportRepository();

    const summary = await runLocalRuntimeTownDaemonScenarioProfile({
      profileId: 'smoke-25',
      rootDir,
      cycleCount: 1,
      requestedAt: 130,
      runIdSuffix: 'without-branch',
      reportGeneratedAt: 190,
      profileRunReportRepository: repository,
    });

    expect(summary.run.traceId).toBe('aivilization-smoke-25:profile-run:130:without-branch');
    await expect(repository.get(summary.run.traceId)).resolves.toMatchObject({
      runId: 'aivilization-smoke-25:profile-run:130:without-branch',
      profileId: 'smoke-25',
      requestedAt: 130,
    });
  });

  test('profile agent provider attaches configured agent-cycle LLM stage hooks to generated agents', async () => {
    const rootDir = createRootDir();
    const agentId = asAgentId('profile-hook-agent');
    const storage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-profile-hooks',
      partitionKey: 'world-main',
    });
    const projection = createWorldProjection({
      agents: [
        {
          agentId,
          locationId: null,
          physiology: { energy: 80, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 100,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
    });
    await storage.intentionRepository.setObjective(agentId, {
      id: 'objective-profile-hooks',
      agentId,
      statement: 'Study with runtime hooks.',
      priority: 3,
      source: 'human',
      affinityTags: ['study'],
      createdAt: 100,
      updatedAt: 100,
    });
    await storage.planRepository.save({
      planId: 'objective-profile-hooks',
      agentId,
      plan: createBranchPlan({
        objective: 'Study with runtime hooks.',
        branches: [
          {
            id: 'study-lane',
            objective: 'Study.',
            subtasks: [
              {
                id: 'study-step',
                description: 'Study using configured hooks.',
                basePriority: 5,
                intentionAffinityTags: ['study'],
              },
            ],
          },
        ],
      }),
      createdAt: 100,
      updatedAt: 100,
    });
    const subtaskPrioritizer: SubtaskPrioritizer = ({ candidates }) => ({
      candidates,
      trace: { status: 'deterministic', source: 'deterministic' },
    });
    const actionSequenceGenerator: ActionSequenceGenerator = (input) =>
      Promise.resolve({
        actions: input.deterministicActions,
        trace: {
          status: 'deterministic',
          source: 'deterministic',
          selectedSubtask: {
            branchId: input.selectedSubtask.branchId,
            subtaskId: input.selectedSubtask.subtaskId,
          },
        },
      });
    const globalSynthesizer: GlobalActionSynthesizer = (input) =>
      Promise.resolve({
        actions: input.candidateActions,
        trace: { status: 'deterministic', source: 'deterministic' },
      });
    const reactiveCorrector: ReactiveCorrector = () =>
      Promise.resolve({
        action: undefined,
        trace: {
          status: 'accepted',
          source: 'llm',
          decision: {
            kind: 'no-correction',
            rationale: 'test corrector',
            evidenceRecordIds: [],
          },
        },
      });
    const replanningDecider: ReplanningDecider = (input) => ({
      decision: { kind: 'none' },
      trace: {
        status: 'accepted',
        source: 'llm',
        requestId: `test-replanning:${input.agentId}:${input.selectedSubtask.subtaskId}:${input.issuedAt}`,
        decision: { kind: 'none' },
      },
    });
    const socialDialogueGenerator: SocialDialogueGenerator = (input) =>
      Promise.resolve({
        payload: input.deterministicPayload,
        trace: {
          status: 'deterministic',
          source: 'deterministic',
          selectedSubtask: {
            branchId: input.selectedSubtask.branchId,
            subtaskId: input.selectedSubtask.subtaskId,
          },
          actionId: input.action.id,
          targetAgentId: input.deterministicPayload.targetAgentId,
          turnCount: input.deterministicPayload.turns.length,
          rationale: 'test social dialogue generator',
        },
      });
    const provider = createLocalRuntimeTownProfileAgentProvider({
      subtaskPrioritizer,
      actionSequenceGenerator,
      socialDialogueGenerator,
      globalSynthesizer,
      reactiveCorrector,
      replanningDecider,
    });

    const agents = await provider({
      storage,
      simulationId: storage.partition.simulationId,
      issuedAt: 200,
      projection,
    });

    expect(agents).toHaveLength(1);
    const agent = agents[0];
    expect(agent?.subtaskPrioritizer).toBe(subtaskPrioritizer);
    expect(agent?.actionSequenceGenerator).toBe(actionSequenceGenerator);
    expect(agent?.socialDialogueGenerator).toBe(socialDialogueGenerator);
    expect(agent?.globalSynthesizer).toBe(globalSynthesizer);
    expect(agent?.reactiveCorrector).toBe(reactiveCorrector);
    expect(agent?.replanningDecider).toBe(replanningDecider);
  });

  test('uses profile LLM planning config for autonomous objective plans', async () => {
    const rootDir = createRootDir();

    const summary = await runLocalRuntimeTownDaemonScenarioProfile({
      profileId: 'smoke-25',
      rootDir,
      cycleCount: 1,
      requestedAt: 100,
      llmPlanning: {
        kind: 'traceable-llm-strategic-planner',
        profileId: 'smoke-25',
        model: 'profile-planner-model',
        provider: {
          kind: 'scripted',
          providerId: 'scripted-profile-planner',
          responses: createLlmStudyPlanResponses(25),
        },
      },
    });

    const agentId = asAgentId('smoke-25-world-main-agent-001');
    const objectiveId = 'auto-objective-smoke-25-world-main-agent-001-100';
    const planRepository = new FileBranchPlanRepository({
      rootDir: join(
        rootDir,
        'simulations',
        'aivilization-smoke-25',
        'partitions',
        'world-main',
        'planning',
      ),
    });
    const traceRepository = new FileAgentCycleTraceRepository({
      rootDir: join(
        rootDir,
        'simulations',
        'aivilization-smoke-25',
        'partitions',
        'world-main',
        'observability',
      ),
    });
    const objectiveTraceRepository = new FileObjectiveRenewalTraceRepository({
      rootDir: join(
        rootDir,
        'simulations',
        'aivilization-smoke-25',
        'partitions',
        'world-main',
        'observability',
      ),
    });
    const plan = await planRepository.require({
      planId: objectiveId,
      agentId,
    });
    const traces = await traceRepository.query({
      simulationId: 'aivilization-smoke-25',
      agentId,
      limit: 1,
    });
    const objectiveTraces = await objectiveTraceRepository.query({
      simulationId: 'aivilization-smoke-25',
      partitionKey: 'world-main',
      agentId,
      limit: 1,
    });

    expect(summary.totalAgentTraceCount).toBeGreaterThan(0);
    expect(
      summary.cognitionLlmStageDiagnostics?.find((stage) => stage.stageName === 'strategicPlanning')
        ?.llmAcceptedCount,
    ).toBeGreaterThan(0);
    expect(
      summary.cognitionLlmStageDiagnostics?.find((stage) => stage.stageName === 'strategicPlanning')
        ?.worldDecisionContextCount,
    ).toBeGreaterThan(0);
    expect(plan.plan).toMatchObject({
      objective: 'LLM study objective',
      branches: [
        {
          id: 'study-llm',
          objective: 'Use LLM strategic planning for study.',
          subtasks: [
            {
              id: 'study-from-llm',
              description: 'Study from the profile LLM branch plan.',
              basePriority: 10,
            },
          ],
        },
      ],
    });
    expect(traces[0]).toMatchObject({
      agentId,
      selectedBranch: 'study-llm',
      selectionEvidence: {
        selectedSubtaskId: 'study-from-llm',
      },
    });
    expect(objectiveTraces[0]).toMatchObject({
      traceId:
        'aivilization-smoke-25:world-main:smoke-25-world-main-agent-001:auto-objective-smoke-25-world-main-agent-001-100:100',
      simulationId: 'aivilization-smoke-25',
      partitionKey: 'world-main',
      agentId,
      objectiveId,
      strategicPlan: {
        status: 'accepted',
        source: 'llm',
        requestId:
          'profile-llm-plan:smoke-25:smoke-25-world-main-agent-001:auto-objective-smoke-25-world-main-agent-001-100:100',
        providerId: 'scripted-profile-planner',
        model: 'profile-planner-model',
      },
    });
  });

  test('uses an injected strategic plan compiler for autonomous objective plans', async () => {
    const rootDir = createRootDir();

    const summary = await runLocalRuntimeTownDaemonScenarioProfile({
      profileId: 'smoke-25',
      rootDir,
      cycleCount: 1,
      requestedAt: 140,
      strategicPlanCompiler: ({ objective }) => ({
        plan: createBranchPlan({
          objective: objective.statement,
          branches: [
            {
              id: 'injected-branch',
              objective: 'Use the injected study compiler.',
              subtasks: [
                {
                  id: 'study',
                  description: `Study through injected plan for: ${objective.statement}`,
                  basePriority: 99,
                  signalKeys: ['study'],
                  intentionAffinityTags: ['study'],
                  memoryAffinityTags: ['study'],
                  profileAffinityTags: ['study'],
                },
              ],
            },
          ],
        }),
        planningTrace: {
          status: 'deterministic',
          source: 'deterministic',
          message: 'Injected strategic plan compiler',
        },
      }),
    });

    const agentId = asAgentId('smoke-25-world-main-agent-001');
    const objectiveId = 'auto-objective-smoke-25-world-main-agent-001-140';
    const planRepository = new FileBranchPlanRepository({
      rootDir: join(
        rootDir,
        'simulations',
        'aivilization-smoke-25',
        'partitions',
        'world-main',
        'planning',
      ),
    });
    const traceRepository = new FileAgentCycleTraceRepository({
      rootDir: join(
        rootDir,
        'simulations',
        'aivilization-smoke-25',
        'partitions',
        'world-main',
        'observability',
      ),
    });
    const objectiveTraceRepository = new FileObjectiveRenewalTraceRepository({
      rootDir: join(
        rootDir,
        'simulations',
        'aivilization-smoke-25',
        'partitions',
        'world-main',
        'observability',
      ),
    });

    const plan = await planRepository.require({
      planId: objectiveId,
      agentId,
    });
    const traces = await traceRepository.query({
      simulationId: 'aivilization-smoke-25',
      agentId,
      limit: 1,
    });
    const objectiveTraces = await objectiveTraceRepository.query({
      simulationId: 'aivilization-smoke-25',
      partitionKey: 'world-main',
      agentId,
      limit: 1,
    });

    expect(summary.totalAgentTraceCount).toBeGreaterThan(0);
    expect(plan.plan.branches).toEqual([
      {
        id: 'injected-branch',
        objective: 'Use the injected study compiler.',
        subtasks: [
          {
            id: 'study',
            description:
              'Study through injected plan for: Improve education to qualify for better town opportunities.',
            basePriority: 99,
            signalKeys: ['study'],
            intentionAffinityTags: ['study'],
            memoryAffinityTags: ['study'],
            profileAffinityTags: ['study'],
          },
        ],
      },
    ]);
    expect(plan.planningTrace).toEqual({
      status: 'deterministic',
      source: 'deterministic',
      message: 'Injected strategic plan compiler',
    });
    expect(traces[0]).toMatchObject({
      agentId,
      selectedBranch: 'injected-branch',
      selectionEvidence: {
        selectedSubtaskId: 'study',
      },
    });
    expect(objectiveTraces[0]).toMatchObject({
      agentId,
      objectiveId,
      strategicPlan: {
        status: 'deterministic',
        source: 'deterministic',
        message: 'Injected strategic plan compiler',
      },
    });
  });

  test('uses profile replanning policy to materialize recovery plans during profile runs', async () => {
    const rootDir = createRootDir();

    const summary = await runLocalRuntimeTownDaemonScenarioProfile({
      profileId: 'smoke-25',
      rootDir,
      cycleCount: 1,
      requestedAt: 180,
      replanningPolicy: {
        consecutiveFailureThreshold: 2,
        majorContextShift: {
          key: 'profile-recovery-drill',
          reason: 'profile recovery drill requires a replacement plan',
        },
      },
      strategicPlanCompiler: ({ objective }) => ({
        plan: createBranchPlan({
          objective: objective.statement,
          branches: [
            {
              id: 'eat-recovery-drill',
              objective: 'Try an impossible eat action so the profile proves replan recovery.',
              subtasks: [
                {
                  id: 'eat-without-inventory',
                  description: 'eat an Apple without inventory',
                  basePriority: 99,
                  intentionAffinityTags: ['eat'],
                },
              ],
            },
          ],
        }),
        planningTrace: {
          status: 'deterministic',
          source: 'deterministic',
          message: 'Injected recovery drill plan',
        },
      }),
    });

    const traceRepository = new FileAgentCycleTraceRepository({
      rootDir: join(
        rootDir,
        'simulations',
        'aivilization-smoke-25',
        'partitions',
        'world-main',
        'observability',
      ),
    });
    const traces = await traceRepository.query({
      simulationId: 'aivilization-smoke-25',
    });

    expect(summary.agentCycleDiagnostics.fullReplanMaterializationCount).toBeGreaterThan(0);
    expect(summary.agentCycleDiagnostics.fullReplanMaterializationRatio).toBeGreaterThan(0);
    expect(
      traces.some(
        (trace) =>
          trace.replanMaterialization?.status === 'replanned' &&
          trace.replanMaterialization.trigger === 'major-context-shift',
      ),
    ).toBe(true);
  });

  test('runs the recovery drill profile with built-in full replan materialization defaults', async () => {
    const rootDir = createRootDir();

    const summary = await runLocalRuntimeTownDaemonScenarioProfile({
      profileId: 'recovery-drill-25',
      rootDir,
      cycleCount: 1,
      requestedAt: 220,
    });

    expect(summary).toMatchObject({
      profileId: 'recovery-drill-25',
      manifestId: 'aivilization-recovery-drill-25',
      daemonHealth: 'healthy',
      run: {
        traceId: 'aivilization-recovery-drill-25:profile-run:220',
        outcome: 'succeeded',
        completedCycleCount: 1,
        stopReason: 'cycle-count-completed',
      },
    });
    expect(summary.agentCycleDiagnostics.fullReplanMaterializationCount).toBeGreaterThan(0);
    expect(summary.agentCycleDiagnostics.fullReplanMaterializationRatio).toBeGreaterThan(0);
  });

  test('uses an injected daily plan compiler before autonomous objective renewal', async () => {
    const rootDir = createRootDir();
    const compiledAgentIds: string[] = [];

    const summary = await runLocalRuntimeTownDaemonScenarioProfile({
      profileId: 'smoke-25',
      rootDir,
      cycleCount: 1,
      requestedAt: 8.5 * 60 * 60 * 1000,
      dailyPlanCompiler: ({ agentId, issuedAt }) => {
        compiledAgentIds.push(agentId);
        return {
          plan: createDailyPlan({
            id: `daily-plan:${agentId}:0`,
            agentId,
            dayStart: 0,
            generatedAt: issuedAt,
            summary: 'Injected profile-run daily party plan.',
            items: [
              {
                id: 'party-prep',
                description: 'Coordinate party invitations at town square.',
                priority: 6,
                startsAtOffsetMs: 8 * 60 * 60 * 1000,
                endsAtOffsetMs: 10 * 60 * 60 * 1000,
                affinityTags: ['social', 'party', 'town-square'],
                source: 'memory-context',
              },
            ],
          }),
          planningTrace: {
            status: 'accepted',
            source: 'llm',
            providerId: 'injected-daily-provider',
            model: 'injected-daily-model',
          },
        };
      },
    });

    const agentId = asAgentId('smoke-25-world-main-agent-001');
    const objectiveTraceRepository = new FileObjectiveRenewalTraceRepository({
      rootDir: join(
        rootDir,
        'simulations',
        'aivilization-smoke-25',
        'partitions',
        'world-main',
        'observability',
      ),
    });
    const dailyPlanTraceRepository = new FileDailyPlanRenewalTraceRepository({
      rootDir: join(
        rootDir,
        'simulations',
        'aivilization-smoke-25',
        'partitions',
        'world-main',
        'observability',
      ),
    });
    const objectiveTraces = await objectiveTraceRepository.query({
      simulationId: 'aivilization-smoke-25',
      partitionKey: 'world-main',
      agentId,
      limit: 1,
    });
    const dailyPlanTraces = await dailyPlanTraceRepository.query({
      simulationId: 'aivilization-smoke-25',
      partitionKey: 'world-main',
      agentId,
      dailyPlanId: `daily-plan:${agentId}:0`,
      limit: 1,
    });

    expect(summary.totalAgentTraceCount).toBeGreaterThan(0);
    expect(
      summary.cognitionLlmStageDiagnostics?.find((stage) => stage.stageName === 'dailyPlanning')
        ?.llmAcceptedCount,
    ).toBeGreaterThan(0);
    expect(compiledAgentIds).toContain(agentId);
    expect(dailyPlanTraces[0]).toMatchObject({
      simulationId: 'aivilization-smoke-25',
      partitionKey: 'world-main',
      agentId,
      dailyPlanId: `daily-plan:${agentId}:0`,
      scheduledIntentionIds: [`daily-plan:${agentId}:0:party-prep`],
      issuedAt: 8.5 * 60 * 60 * 1000,
    });
    expect(objectiveTraces[0]).toMatchObject({
      agentId,
      objectiveId: `auto-objective-${agentId}-${8.5 * 60 * 60 * 1000}`,
      selectedCandidateId: 'scheduled-routine-social',
      scheduledIntentionIds: [`daily-plan:${agentId}:0:party-prep`],
    });
  });

  test('uses profile daily planning config with world decision context coverage', async () => {
    const rootDir = createRootDir();
    const observedRequestIds: string[] = [];

    const summary = await runLocalRuntimeTownDaemonScenarioProfile({
      profileId: 'smoke-25',
      rootDir,
      cycleCount: 1,
      requestedAt: 8.5 * 60 * 60 * 1000,
      dailyPlanning: {
        kind: 'traceable-llm-daily-planner',
        profileId: 'smoke-25',
        model: 'profile-daily-model',
        provider: {
          kind: 'scripted',
          providerId: 'scripted-profile-daily',
          responses: createProfileDailyPlanResponses(25, observedRequestIds),
        },
      },
    });

    const agentId = asAgentId('smoke-25-world-main-agent-001');
    const dailyPlanTraceRepository = new FileDailyPlanRenewalTraceRepository({
      rootDir: join(
        rootDir,
        'simulations',
        'aivilization-smoke-25',
        'partitions',
        'world-main',
        'observability',
      ),
    });
    const dailyPlanTraces = await dailyPlanTraceRepository.query({
      simulationId: 'aivilization-smoke-25',
      partitionKey: 'world-main',
      agentId,
      dailyPlanId: `daily-plan:${agentId}:0`,
      limit: 1,
    });

    expect(observedRequestIds).toContain(
      `profile-llm-daily-plan:smoke-25:${agentId}:${8.5 * 60 * 60 * 1000}`,
    );
    expect(
      summary.cognitionLlmStageDiagnostics?.find((stage) => stage.stageName === 'dailyPlanning')
        ?.llmAcceptedCount,
    ).toBeGreaterThan(0);
    expect(
      summary.cognitionLlmStageDiagnostics?.find((stage) => stage.stageName === 'dailyPlanning')
        ?.worldDecisionContextCount,
    ).toBeGreaterThan(0);
    expect(dailyPlanTraces[0]?.planningTrace).toMatchObject({
      status: 'accepted',
      source: 'llm',
      providerId: 'scripted-profile-daily',
      model: 'profile-daily-model',
      worldDecisionContext: {
        agentId,
        hasPhysiology: true,
        hasBalance: true,
        hasEducationScore: true,
        hasResidentialTier: true,
      },
    });
  });

  test('uses profile reaction planning config for ambient social observations', async () => {
    const rootDir = createRootDir();
    const actorId = asAgentId('smoke-25-world-main-agent-001');
    const targetId = asAgentId('smoke-25-world-main-agent-008');
    const bystanderId = asAgentId('smoke-25-world-main-agent-015');
    const reactionRequestIds: string[] = [];

    const summary = await runLocalRuntimeTownDaemonScenarioProfile({
      profileId: 'smoke-25',
      rootDir,
      cycleCount: 1,
      requestedAt: 200,
      reactionPlanning: {
        kind: 'traceable-llm-reaction-evaluator',
        profileId: 'smoke-25',
        model: 'profile-reaction-model',
        provider: {
          kind: 'scripted',
          providerId: 'scripted-profile-reaction',
          responses: createIgnoreReactionResponses(8, reactionRequestIds),
        },
      },
      agentProvider: () => [
        {
          agentId: actorId,
          observedStateSummary: 'agent-001 talks with agent-008 while bystanders are nearby',
          plan: createBranchPlan({
            objective: 'coordinate a party',
            branches: [
              {
                id: 'social',
                objective: 'discuss party logistics',
                subtasks: [
                  {
                    id: 'conversation',
                    description: 'discuss Valentine party',
                    basePriority: 5,
                  },
                ],
              },
            ],
          }),
          signals: [],
          microPlanners: [
            {
              domain: 'social',
              supports: ({ subtaskId }) => subtaskId === 'conversation',
              propose: () => [
                {
                  id: 'conversation-party',
                  description: 'Discuss Valentine party with agent-008.',
                  commandType: 'AgentStartConversation',
                  payload: {
                    targetAgentId: targetId,
                    topic: 'Valentine party',
                    relationDelta: 1,
                    attitudeDelta: 1,
                    turns: [
                      {
                        speakerAgentId: actorId,
                        utterance: 'Can you help coordinate the Valentine party?',
                        intent: 'invite-party-planning',
                      },
                      {
                        speakerAgentId: targetId,
                        utterance: 'Yes, let us invite more neighbors.',
                        intent: 'accept-party-planning',
                      },
                    ],
                  },
                },
              ],
            },
          ],
          simulate: ({ action }) => ({ status: 'accepted', action }),
        },
      ],
    });

    const simulationRoot = join(
      rootDir,
      'simulations',
      'aivilization-smoke-25',
      'partitions',
      'world-main',
    );
    const memoryRepository = new FileShortTermMemoryRepository({
      rootDir: join(simulationRoot, 'memory'),
    });
    const intentionRepository = new FileAgentIntentionRepository({
      rootDir: join(simulationRoot, 'memory'),
    });
    const reactionTraceRepository = new FileReactionEvaluationTraceRepository({
      rootDir: join(simulationRoot, 'observability'),
    });
    const conversationMemories = await memoryRepository.retrieve({
      agentId: bystanderId,
      kinds: ['observation'],
      requiredTags: ['ambient-observation', 'ConversationRecorded'],
      limit: 10,
    });
    const intentionState = await intentionRepository.getOrCreate(bystanderId);

    expect(summary.run.completedCycleCount).toBe(1);
    expect(
      summary.cognitionLlmStageDiagnostics?.find(
        (stage) => stage.stageName === 'reactionEvaluation',
      )?.llmAcceptedCount,
    ).toBeGreaterThan(0);
    expect(
      summary.cognitionLlmStageDiagnostics?.find(
        (stage) => stage.stageName === 'reactionEvaluation',
      )?.worldDecisionContextCount,
    ).toBeGreaterThan(0);
    expect(
      reactionRequestIds.some((requestId) =>
        requestId.startsWith('profile-llm-reaction:smoke-25:smoke-25-world-main-agent-015:'),
      ),
    ).toBe(true);
    const reactionTraces = await reactionTraceRepository.query({
      simulationId: 'aivilization-smoke-25',
      partitionKey: 'world-main',
      agentId: bystanderId,
      decisionKind: 'ignore',
      limit: 1,
    });

    expect(reactionTraces).toHaveLength(1);
    expect(reactionTraces[0]).toMatchObject({
      simulationId: 'aivilization-smoke-25',
      partitionKey: 'world-main',
      agentId: bystanderId,
      decision: {
        kind: 'ignore',
        confidence: 0.93,
        rationale: 'The bystander noticed the conversation but should not follow up.',
      },
      reactionTrace: {
        status: 'accepted',
        source: 'llm',
        providerId: 'scripted-profile-reaction',
        model: 'profile-reaction-model',
      },
      issuedAt: 200,
    });
    expect(reactionTraces[0]?.reactionTrace?.requestId).toMatch(
      /^profile-llm-reaction:smoke-25:smoke-25-world-main-agent-015:/,
    );
    expect(conversationMemories).toHaveLength(1);
    expect(conversationMemories[0]).toMatchObject({
      agentId: bystanderId,
      summary:
        'Observed smoke-25-world-main-agent-001 and smoke-25-world-main-agent-008 discuss Valentine party at Town Square.',
    });
    expect(intentionState.scheduledIntentions).toEqual([]);
  });

  test('attaches configured reflection synthesis to a provided memory consolidation schedule', async () => {
    const rootDir = createRootDir();
    const observedRequestIds: string[] = [];

    const summary = await runLocalRuntimeTownDaemonScenarioProfile({
      profileId: 'smoke-25',
      rootDir,
      cycleCount: 1,
      requestedAt: 260,
      memoryConsolidationSchedule: {
        agentIds: [asAgentId('smoke-25-world-main-agent-001')],
        retrievalLimit: 10,
        minPatternCount: 1,
      },
      reflectionSynthesis: {
        kind: 'traceable-llm-reflective-insight-synthesizer',
        profileId: 'smoke-25',
        model: 'profile-reflection-model',
        provider: {
          kind: 'scripted',
          providerId: 'scripted-profile-reflection',
          responses: createEmptyReflectionResponses(1, observedRequestIds),
        },
      },
    });

    expect(observedRequestIds).toHaveLength(1);
    expect(observedRequestIds[0]).toBe(
      'profile-llm-reflection-synthesis:smoke-25:smoke-25-world-main-agent-001:260',
    );
    expect(
      summary.cognitionLlmStageDiagnostics?.find(
        (stage) => stage.stageName === 'reflectionSynthesis',
      )?.llmAcceptedCount,
    ).toBe(1);
    expect(
      summary.cognitionLlmStageDiagnostics?.find(
        (stage) => stage.stageName === 'reflectionSynthesis',
      )?.worldDecisionContextCount,
    ).toBe(1);
  });

  test('attaches configured social model synthesis to a provided memory consolidation schedule', async () => {
    const rootDir = createRootDir();
    const observedRequestIds: string[] = [];

    const summary = await runLocalRuntimeTownDaemonScenarioProfile({
      profileId: 'smoke-25',
      rootDir,
      cycleCount: 1,
      requestedAt: 270,
      memoryConsolidationSchedule: {
        agentIds: [asAgentId('smoke-25-world-main-agent-001')],
        retrievalLimit: 10,
        minPatternCount: 1,
      },
      socialModelSynthesis: {
        kind: 'traceable-llm-social-model-synthesizer',
        profileId: 'smoke-25',
        model: 'profile-social-model',
        provider: {
          kind: 'scripted',
          providerId: 'scripted-profile-social-model',
          responses: createEmptySocialModelResponses(1, observedRequestIds),
        },
      },
    });

    expect(observedRequestIds).toHaveLength(1);
    expect(observedRequestIds[0]).toBe(
      'profile-llm-social-model-synthesis:smoke-25:smoke-25-world-main-agent-001:270',
    );
    expect(
      summary.cognitionLlmStageDiagnostics?.find(
        (stage) => stage.stageName === 'socialModelSynthesis',
      )?.llmAcceptedCount,
    ).toBe(1);
    expect(
      summary.cognitionLlmStageDiagnostics?.find(
        (stage) => stage.stageName === 'socialModelSynthesis',
      )?.worldDecisionContextCount,
    ).toBe(1);
  });

  test('creates a default memory consolidation schedule for configured memory synthesis', async () => {
    const rootDir = createRootDir();
    const observedReflectionRequestIds: string[] = [];
    const observedSocialModelRequestIds: string[] = [];

    const summary = await runLocalRuntimeTownDaemonScenarioProfile({
      profileId: 'smoke-25',
      rootDir,
      cycleCount: 1,
      requestedAt: 280,
      reflectionSynthesis: {
        kind: 'traceable-llm-reflective-insight-synthesizer',
        profileId: 'smoke-25',
        model: 'profile-reflection-model',
        provider: {
          kind: 'scripted',
          providerId: 'scripted-profile-reflection',
          responses: createEmptyReflectionResponses(100, observedReflectionRequestIds),
        },
      },
      socialModelSynthesis: {
        kind: 'traceable-llm-social-model-synthesizer',
        profileId: 'smoke-25',
        model: 'profile-social-model',
        provider: {
          kind: 'scripted',
          providerId: 'scripted-profile-social-model',
          responses: createEmptySocialModelResponses(100, observedSocialModelRequestIds),
        },
      },
    });

    expect(observedReflectionRequestIds.length).toBeGreaterThan(0);
    expect(observedSocialModelRequestIds.length).toBeGreaterThan(0);
    expect(observedReflectionRequestIds[0]).toMatch(
      /^profile-llm-reflection-synthesis:smoke-25:smoke-25-world-main-agent-\d{3}:280$/,
    );
    expect(observedSocialModelRequestIds[0]).toMatch(
      /^profile-llm-social-model-synthesis:smoke-25:smoke-25-world-main-agent-\d{3}:280$/,
    );

    const reflectionDiagnostics = summary.cognitionLlmStageDiagnostics?.find(
      (stage) => stage.stageName === 'reflectionSynthesis',
    );
    const socialModelDiagnostics = summary.cognitionLlmStageDiagnostics?.find(
      (stage) => stage.stageName === 'socialModelSynthesis',
    );
    expect(reflectionDiagnostics?.llmAcceptedCount).toBeGreaterThan(0);
    expect(reflectionDiagnostics?.worldDecisionContextCount).toBe(
      reflectionDiagnostics?.llmAcceptedCount,
    );
    expect(socialModelDiagnostics?.llmAcceptedCount).toBeGreaterThan(0);
    expect(socialModelDiagnostics?.worldDecisionContextCount).toBe(
      socialModelDiagnostics?.llmAcceptedCount,
    );
  });
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-profile-runner-'));
  tmpRoots.push(root);
  return root;
}

function createValidationPlannerRuns() {
  return [
    {
      taskId: 'high-tech-production',
      variant: 'default',
      metrics: [{ metricId: 'net-worth', value: 110_098, higherIsBetter: true }],
    },
    {
      taskId: 'high-tech-production',
      variant: 'without-branch',
      metrics: [{ metricId: 'net-worth', value: 75_237, higherIsBetter: true }],
    },
    {
      taskId: 'high-tech-production',
      variant: 'without-objective-decomposition',
      metrics: [{ metricId: 'net-worth', value: 95_279, higherIsBetter: true }],
    },
  ];
}

function createLlmStudyPlanResponses(count: number) {
  return Array.from({ length: count }, () => ({
    providerId: 'scripted-profile-planner',
    model: 'profile-planner-model',
    content: JSON.stringify({
      objective: 'LLM study objective',
      branches: [
        {
          id: 'study-llm',
          objective: 'Use LLM strategic planning for study.',
          subtasks: [
            {
              id: 'study-from-llm',
              description: 'Study from the profile LLM branch plan.',
              basePriority: 10,
              memoryAffinityTags: ['study'],
            },
          ],
        },
      ],
    }),
    finishReason: 'stop' as const,
  }));
}

function createIgnoreReactionResponses(count: number, observedRequestIds: string[]) {
  return Array.from({ length: count }, () => (request: LlmProviderCompletionRequest) => {
    observedRequestIds.push(request.requestId);
    return {
      providerId: 'scripted-profile-reaction',
      model: 'profile-reaction-model',
      content: JSON.stringify({
        kind: 'ignore',
        confidence: 0.93,
        rationale: 'The bystander noticed the conversation but should not follow up.',
      }),
      finishReason: 'stop' as const,
    };
  });
}

function createProfileDailyPlanResponses(count: number, observedRequestIds: string[]) {
  return Array.from({ length: count }, () => (request: LlmProviderCompletionRequest) => {
    observedRequestIds.push(request.requestId);
    const userContent = request.messages[1]?.content ?? '{}';
    const payload = JSON.parse(userContent) as {
      readonly agentId: string;
      readonly dayStart: number;
      readonly issuedAt: number;
    };
    return {
      providerId: 'scripted-profile-daily',
      model: 'profile-daily-model',
      content: JSON.stringify({
        id: `daily-plan:${payload.agentId}:${payload.dayStart}`,
        agentId: payload.agentId,
        dayStart: payload.dayStart,
        generatedAt: payload.issuedAt,
        summary: 'Use LLM daily planning with world context.',
        items: [
          {
            id: 'market-aware-routine',
            description: 'Review current market and inventory before choosing activities.',
            priority: 5,
            startsAtOffsetMs: 8 * 60 * 60 * 1000,
            endsAtOffsetMs: 10 * 60 * 60 * 1000,
            affinityTags: ['market', 'routine'],
            source: 'world-state',
          },
        ],
      }),
      finishReason: 'stop' as const,
    };
  });
}

function createEmptyReflectionResponses(count: number, observedRequestIds: string[]) {
  return Array.from({ length: count }, () => (request: LlmProviderCompletionRequest) => {
    observedRequestIds.push(request.requestId);
    return {
      providerId: 'scripted-profile-reflection',
      model: 'profile-reflection-model',
      content: JSON.stringify({ insights: [] }),
      finishReason: 'stop' as const,
    };
  });
}

function createEmptySocialModelResponses(count: number, observedRequestIds: string[]) {
  return Array.from({ length: count }, () => (request: LlmProviderCompletionRequest) => {
    observedRequestIds.push(request.requestId);
    return {
      providerId: 'scripted-profile-social-model',
      model: 'profile-social-model',
      content: JSON.stringify({ socialRecords: [], socialReflections: [] }),
      finishReason: 'stop' as const,
    };
  });
}
