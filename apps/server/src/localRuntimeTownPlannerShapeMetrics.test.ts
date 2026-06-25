import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FileBranchPlanRepository,
  createBranchPlan,
  type BranchPlanRecord,
} from '@aivilization/agent-runtime';
import { asAgentId } from '@aivilization/sim-core';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createLocalRuntimeTownProfilePlannerShapeMetrics,
  createPlannerShapeMetricsFromBranchPlans,
} from './localRuntimeTownPlannerShapeMetrics';
import type { LocalRuntimeTownProfileRunnerSummary } from './localRuntimeTownProfileRunner';

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('local runtime town planner shape metrics', () => {
  test('summarizes durable branch plan structure and planning sources', () => {
    const metrics = createPlannerShapeMetricsFromBranchPlans([
      createPlanRecord({
        planId: 'plan-llm',
        branchCount: 2,
        subtaskCounts: [3, 1],
        planningSource: 'llm',
      }),
      createPlanRecord({
        planId: 'plan-deterministic',
        branchCount: 2,
        subtaskCounts: [1, 1],
        planningSource: 'deterministic',
      }),
    ]);

    expect(metrics).toEqual([
      { metricId: 'planner-plan-count', value: 2, higherIsBetter: true },
      { metricId: 'planner-mean-branch-count', value: 2, higherIsBetter: true },
      { metricId: 'planner-mean-subtask-count', value: 3, higherIsBetter: true },
      { metricId: 'planner-mean-subtasks-per-branch', value: 1.5, higherIsBetter: true },
      { metricId: 'planner-single-branch-plan-ratio', value: 0, higherIsBetter: false },
      { metricId: 'planner-multi-subtask-branch-ratio', value: 0.25, higherIsBetter: true },
      { metricId: 'planner-llm-source-count', value: 1, higherIsBetter: true },
      { metricId: 'planner-deterministic-source-count', value: 1, higherIsBetter: true },
      { metricId: 'planner-deterministic-fallback-source-count', value: 0, higherIsBetter: true },
    ]);
  });

  test('reads planner shape metrics from profile partition planning repositories', async () => {
    const rootDir = createRootDir();
    await savePartitionPlan({
      rootDir,
      simulationId: 'aivilization-smoke-25',
      partitionKey: 'world-main',
      record: createPlanRecord({
        planId: 'main-plan',
        branchCount: 2,
        subtaskCounts: [1, 1],
        planningSource: 'llm',
      }),
    });
    await savePartitionPlan({
      rootDir,
      simulationId: 'aivilization-smoke-25',
      partitionKey: 'world-east',
      record: createPlanRecord({
        planId: 'east-plan',
        branchCount: 1,
        subtaskCounts: [3],
        planningSource: 'deterministic-fallback',
      }),
    });

    await expect(
      createLocalRuntimeTownProfilePlannerShapeMetrics(createSummary(rootDir)),
    ).resolves.toEqual([
      { metricId: 'planner-plan-count', value: 2, higherIsBetter: true },
      { metricId: 'planner-mean-branch-count', value: 1.5, higherIsBetter: true },
      { metricId: 'planner-mean-subtask-count', value: 2.5, higherIsBetter: true },
      { metricId: 'planner-mean-subtasks-per-branch', value: 5 / 3, higherIsBetter: true },
      { metricId: 'planner-single-branch-plan-ratio', value: 0.5, higherIsBetter: false },
      { metricId: 'planner-multi-subtask-branch-ratio', value: 1 / 3, higherIsBetter: true },
      { metricId: 'planner-llm-source-count', value: 1, higherIsBetter: true },
      { metricId: 'planner-deterministic-source-count', value: 0, higherIsBetter: true },
      { metricId: 'planner-deterministic-fallback-source-count', value: 1, higherIsBetter: true },
    ]);
  });
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-planner-shape-'));
  tmpRoots.push(root);
  return root;
}

async function savePartitionPlan(input: {
  readonly rootDir: string;
  readonly simulationId: string;
  readonly partitionKey: string;
  readonly record: BranchPlanRecord;
}): Promise<void> {
  const repository = new FileBranchPlanRepository({
    rootDir: join(
      input.rootDir,
      'simulations',
      input.simulationId,
      'partitions',
      input.partitionKey,
      'planning',
    ),
  });
  await repository.save(input.record);
}

function createPlanRecord(input: {
  readonly planId: string;
  readonly branchCount: number;
  readonly subtaskCounts: readonly number[];
  readonly planningSource?: 'llm' | 'deterministic' | 'deterministic-fallback';
}): BranchPlanRecord {
  return {
    planId: input.planId,
    agentId: asAgentId(`${input.planId}-agent`),
    plan: createBranchPlan({
      objective: `Objective for ${input.planId}`,
      branches: Array.from({ length: input.branchCount }, (_, branchIndex) => ({
        id: `branch-${branchIndex + 1}`,
        objective: `Branch ${branchIndex + 1}`,
        subtasks: Array.from(
          { length: input.subtaskCounts[branchIndex] ?? 1 },
          (_, subtaskIndex) => ({
            id: `branch-${branchIndex + 1}-subtask-${subtaskIndex + 1}`,
            description: `Subtask ${subtaskIndex + 1}`,
            basePriority: subtaskIndex + 1,
          }),
        ),
      })),
    }),
    ...(input.planningSource === undefined
      ? {}
      : {
          planningTrace: {
            status: input.planningSource === 'llm' ? 'accepted' : 'deterministic',
            source: input.planningSource,
          },
        }),
    createdAt: 100,
    updatedAt: 100,
  };
}

function createSummary(rootDir: string): LocalRuntimeTownProfileRunnerSummary {
  return {
    profileId: 'smoke-25',
    manifestId: 'aivilization-smoke-25',
    rootDir,
    requestedAt: 100,
    daemonHealth: 'healthy',
    partitionCount: 2,
    totalProjectionAgentCount: 25,
    totalEventCount: 10,
    totalAgentTraceCount: 2,
    agentCycleDiagnostics: createAgentCycleDiagnostics(2),
    run: {
      traceId: 'aivilization-smoke-25:profile-run:100',
      outcome: 'succeeded',
      requestedCycleCount: 1,
      completedCycleCount: 1,
      stopReason: 'cycle-count-completed',
    },
    partitions: [
      {
        simulationId: 'aivilization-smoke-25',
        partitionKey: 'world-main',
        scenarioPresetId: 'aivilization-smoke-25-world-main',
        status: 'completed',
        health: 'healthy',
        lastAppliedSequence: 5,
        streamVersion: 5,
        eventCount: 5,
        projectionAgentCount: 13,
        agentTraceCount: 1,
      },
      {
        simulationId: 'aivilization-smoke-25',
        partitionKey: 'world-east',
        scenarioPresetId: 'aivilization-smoke-25-world-east',
        status: 'completed',
        health: 'healthy',
        lastAppliedSequence: 5,
        streamVersion: 5,
        eventCount: 5,
        projectionAgentCount: 12,
        agentTraceCount: 1,
      },
    ],
  };
}

function createAgentCycleDiagnostics(traceCount: number) {
  return {
    traceCount,
    acceptedSimulatorCount: traceCount,
    repairedSimulatorCount: 0,
    rejectedSimulatorCount: 0,
    replanningDecisionCount: 0,
    simulatorEventTraceCount: traceCount,
    simulatorEventCount: traceCount,
    simulatorRolloutEventCount: traceCount,
    commandEmittingCycleCount: traceCount,
    fullReplanMaterializationCount: 0,
    commandEmittingCycleRatio: traceCount === 0 ? 0 : 1,
    fullReplanMaterializationRatio: 0,
    repairedSimulatorRatio: 0,
    rejectedSimulatorRatio: 0,
    replanningDecisionRatio: 0,
    simulatorRolloutCoverageRatio: traceCount === 0 ? 0 : 1,
  };
}
