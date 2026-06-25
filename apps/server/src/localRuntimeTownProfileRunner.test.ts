import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FileBranchPlanRepository,
  createBranchPlan,
  createDailyPlan,
} from '@aivilization/agent-runtime';
import {
  FileAgentCycleTraceRepository,
  FileDailyPlanRenewalTraceRepository,
  FileObjectiveRenewalTraceRepository,
  InMemoryRuntimeProfileRunReportRepository,
} from '@aivilization/observability';
import { asAgentId } from '@aivilization/sim-core';
import { createWorldProjection } from '@aivilization/world';
import { afterEach, describe, expect, test } from 'vitest';
import {
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
        return createDailyPlan({
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
        });
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
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-profile-runner-'));
  tmpRoots.push(root);
  return root;
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
