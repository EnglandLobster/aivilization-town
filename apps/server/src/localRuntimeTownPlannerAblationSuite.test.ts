import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FileBranchPlanRepository,
  createBranchPlan,
  normalizeStrategicPlanCompilerOutput,
  type BranchPlanRecord,
} from '@aivilization/agent-runtime';
import {
  InMemoryRuntimeProfileRunReportRepository,
  createPlannerExperimentRunsFromRuntimeProfileReports,
} from '@aivilization/observability';
import { asAgentId } from '@aivilization/sim-core';
import { afterEach, describe, expect, test } from 'vitest';
import { runLocalRuntimeTownPlannerAblationSuite } from './localRuntimeTownPlannerAblationSuite';
import {
  type LocalRuntimeTownProfileRunnerInput,
  type LocalRuntimeTownProfileRunnerSummary,
} from './localRuntimeTownProfileRunner';
import { createLocalRuntimeTownProfileGateCriteria } from './localRuntimeTownProfileGate';
import { createLocalRuntimeTownDaemonScenarioProfile } from './localRuntimeTownScenarioProfile';

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('local runtime town planner ablation suite', () => {
  test('runs default and ablated profile variants into validation-ready reports', async () => {
    const inputs: LocalRuntimeTownProfileRunnerInput[] = [];
    const repository = new InMemoryRuntimeProfileRunReportRepository();

    const result = await runLocalRuntimeTownPlannerAblationSuite({
      rootDir: '/tmp/aivilization-planner-ablation',
      profileRunReportRepository: repository,
      profileId: 'smoke-25',
      taskId: 'high-tech-production',
      requestedAt: 100,
      reportGeneratedAt: 200,
      cycleCount: 2,
      cycleIntervalMs: 25,
      runProfile: (input) => {
        inputs.push(input);
        return Promise.resolve(createVariantSummary(input));
      },
    });

    expect(result).toMatchObject({
      status: 'completed',
      profileId: 'smoke-25',
      taskId: 'high-tech-production',
      variantCount: 2,
      requestedAt: 100,
    });
    expect(result.variants.map((variant) => variant.variant)).toEqual([
      'default',
      'without-branch',
    ]);
    expect(inputs.map((input) => input.runIdSuffix)).toEqual(['default', 'without-branch']);
    expect(inputs.map((input) => input.rootDir)).toEqual([
      '/tmp/aivilization-planner-ablation/default',
      '/tmp/aivilization-planner-ablation/without-branch',
    ]);
    expect(
      result.variants.map((variant) => variant.report.plannerExperiment?.metrics.slice(0, 3)),
    ).toEqual([
      [
        { metricId: 'completed-cycle-count', value: 2, higherIsBetter: true },
        { metricId: 'total-agent-trace-count', value: 2, higherIsBetter: true },
        { metricId: 'total-event-count', value: 6, higherIsBetter: true },
      ],
      [
        { metricId: 'completed-cycle-count', value: 1, higherIsBetter: true },
        { metricId: 'total-agent-trace-count', value: 1, higherIsBetter: true },
        { metricId: 'total-event-count', value: 3, higherIsBetter: true },
      ],
    ]);
    expect(result.variants[0]?.report.plannerExperiment?.metrics).toEqual(
      expect.arrayContaining([
        { metricId: 'planner-plan-count', value: 0, higherIsBetter: true },
      ]),
    );

    const plannerRuns = createPlannerExperimentRunsFromRuntimeProfileReports(
      await repository.query({ profileId: 'smoke-25' }),
    );

    expect(plannerRuns.map((run) => ({ taskId: run.taskId, variant: run.variant }))).toEqual([
      { taskId: 'high-tech-production', variant: 'default' },
      { taskId: 'high-tech-production', variant: 'without-branch' },
    ]);
  });

  test('wires default without-branch variant to a real strategic compiler', async () => {
    const inputs: LocalRuntimeTownProfileRunnerInput[] = [];

    await runLocalRuntimeTownPlannerAblationSuite({
      rootDir: '/tmp/aivilization-planner-ablation',
      profileId: 'smoke-25',
      taskId: 'high-tech-production',
      requestedAt: 300,
      runProfile: (input) => {
        inputs.push(input);
        return Promise.resolve(createVariantSummary(input));
      },
    });

    expect(inputs).toHaveLength(2);
    expect(inputs[0]?.runIdSuffix).toBe('default');
    expect(inputs[0]?.strategicPlanCompiler).toBeUndefined();
    expect(inputs[1]?.runIdSuffix).toBe('without-branch');
    expect(inputs[1]?.strategicPlanCompiler).not.toBeUndefined();

    const compiler = inputs[1]?.strategicPlanCompiler;
    if (compiler === undefined) {
      throw new Error('expected without-branch compiler');
    }
    const compiled = normalizeStrategicPlanCompilerOutput(
      await compiler({
        objective: {
          id: 'objective-study',
          agentId: asAgentId('agent-1'),
          statement: 'Study before applying for work.',
          priority: 4,
          source: 'agent',
          affinityTags: ['study', 'work', 'study'],
          createdAt: 300,
          updatedAt: 300,
        },
        issuedAt: 333,
      }),
    );

    expect(compiled.plan).toEqual({
      objective: 'Study before applying for work.',
      branches: [
        {
          id: 'without-branch',
          objective: 'Pursue the objective without alternative branch decomposition.',
          subtasks: [
            {
              id: 'pursue-objective',
              description:
                'Pursue the objective directly without branch decomposition: Study before applying for work.',
              basePriority: 12,
              signalKeys: ['study', 'work'],
              intentionAffinityTags: ['study', 'work'],
              memoryAffinityTags: ['study', 'work'],
              profileAffinityTags: ['study', 'work'],
            },
          ],
        },
      ],
    });
    expect(compiled.planningTrace).toEqual({
      status: 'deterministic',
      source: 'deterministic',
      message: 'Planner ablation without branch decomposition',
    });
  });

  test('adds planner shape metrics from durable branch plan artifacts', async () => {
    const rootDir = createRootDir();

    const result = await runLocalRuntimeTownPlannerAblationSuite({
      rootDir,
      profileId: 'smoke-25',
      taskId: 'high-tech-production',
      requestedAt: 400,
      runProfile: async (input) => {
        const summary = createVariantSummary(input);
        await saveSuiteBranchPlanArtifact(summary, input.runIdSuffix ?? 'default');
        return summary;
      },
    });

    const defaultMetrics = result.variants[0]?.report.plannerExperiment?.metrics ?? [];
    const withoutBranchMetrics = result.variants[1]?.report.plannerExperiment?.metrics ?? [];

    expect(defaultMetrics).toEqual(
      expect.arrayContaining([
        { metricId: 'planner-plan-count', value: 1, higherIsBetter: true },
        { metricId: 'planner-mean-branch-count', value: 2, higherIsBetter: true },
        { metricId: 'planner-mean-subtask-count', value: 3, higherIsBetter: true },
        { metricId: 'planner-single-branch-plan-ratio', value: 0, higherIsBetter: false },
        { metricId: 'planner-llm-source-count', value: 1, higherIsBetter: true },
      ]),
    );
    expect(withoutBranchMetrics).toEqual(
      expect.arrayContaining([
        { metricId: 'planner-plan-count', value: 1, higherIsBetter: true },
        { metricId: 'planner-mean-branch-count', value: 1, higherIsBetter: true },
        { metricId: 'planner-mean-subtask-count', value: 1, higherIsBetter: true },
        { metricId: 'planner-single-branch-plan-ratio', value: 1, higherIsBetter: false },
        { metricId: 'planner-deterministic-source-count', value: 1, higherIsBetter: true },
      ]),
    );
  });
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-planner-ablation-suite-'));
  tmpRoots.push(root);
  return root;
}

async function saveSuiteBranchPlanArtifact(
  summary: LocalRuntimeTownProfileRunnerSummary,
  variant: string,
): Promise<void> {
  const partition = summary.partitions[0];
  if (partition === undefined) {
    throw new Error('expected at least one profile partition');
  }
  const repository = new FileBranchPlanRepository({
    rootDir: join(
      summary.rootDir,
      'simulations',
      partition.simulationId,
      'partitions',
      partition.partitionKey,
      'planning',
    ),
  });
  await repository.save(createSuitePlanRecord(variant));
}

function createSuitePlanRecord(variant: string): BranchPlanRecord {
  const isWithoutBranch = variant === 'without-branch';
  return {
    planId: `${variant}-plan`,
    agentId: asAgentId(`${variant}-agent`),
    plan: createBranchPlan({
      objective: `${variant} objective`,
      branches: isWithoutBranch
        ? [
            {
              id: 'without-branch',
              objective: 'Direct pursuit.',
              subtasks: [
                {
                  id: 'pursue-objective',
                  description: 'Pursue directly.',
                  basePriority: 1,
                },
              ],
            },
          ]
        : [
            {
              id: 'research',
              objective: 'Research alternatives.',
              subtasks: [{ id: 'study', description: 'Study.', basePriority: 1 }],
            },
            {
              id: 'production',
              objective: 'Produce resources.',
              subtasks: [
                { id: 'source-inputs', description: 'Source inputs.', basePriority: 1 },
                { id: 'produce-output', description: 'Produce output.', basePriority: 1 },
              ],
            },
          ],
    }),
    planningTrace: {
      status: isWithoutBranch ? 'deterministic' : 'accepted',
      source: isWithoutBranch ? 'deterministic' : 'llm',
    },
    createdAt: 100,
    updatedAt: 100,
  };
}

function createVariantSummary(
  input: LocalRuntimeTownProfileRunnerInput,
): LocalRuntimeTownProfileRunnerSummary {
  const summary = createPassingProfileSummary(input);
  if (input.runIdSuffix === 'without-branch') {
    return {
      ...summary,
      totalEventCount: 3,
      totalAgentTraceCount: 1,
      run: {
        ...summary.run,
        completedCycleCount: 1,
      },
      partitions: summary.partitions.map((partition) => ({
        ...partition,
        eventCount: 3,
        agentTraceCount: 1,
      })),
    };
  }
  return summary;
}

function createPassingProfileSummary(
  input: LocalRuntimeTownProfileRunnerInput,
): LocalRuntimeTownProfileRunnerSummary {
  const profile = createLocalRuntimeTownDaemonScenarioProfile(input.profileId);
  const criteria = createLocalRuntimeTownProfileGateCriteria(input.profileId, {
    minimumCompletedCycleCount: input.cycleCount,
  });
  const partitions = profile.manifest.partitions.map((partition) => {
    const projectionAgentCount =
      criteria.expectedProjectionAgentCountByPartition[partition.partitionKey];
    if (projectionAgentCount === undefined) {
      throw new Error(`missing expected agent count for ${partition.partitionKey}`);
    }

    return {
      simulationId: partition.simulationId,
      partitionKey: partition.partitionKey,
      scenarioPresetId: partition.scenarioPresetId,
      status: 'completed',
      health: 'healthy',
      lastAppliedSequence: 3,
      streamVersion: 3,
      eventCount: 6,
      projectionAgentCount,
      agentTraceCount: 2,
    };
  });

  return {
    profileId: input.profileId,
    manifestId: profile.manifest.id,
    rootDir: input.rootDir,
    requestedAt: input.requestedAt,
    daemonHealth: 'healthy',
    partitionCount: partitions.length,
    totalProjectionAgentCount: partitions.reduce(
      (total, partition) => total + partition.projectionAgentCount,
      0,
    ),
    totalEventCount: partitions.reduce((total, partition) => total + partition.eventCount, 0),
    totalAgentTraceCount: partitions.reduce(
      (total, partition) => total + partition.agentTraceCount,
      0,
    ),
    run: {
      traceId: `${profile.manifest.id}:profile-run:${input.requestedAt}:${input.runIdSuffix}`,
      outcome: 'succeeded',
      requestedCycleCount: input.cycleCount,
      completedCycleCount: input.cycleCount,
      stopReason: 'cycle-count-completed',
    },
    partitions,
  };
}
