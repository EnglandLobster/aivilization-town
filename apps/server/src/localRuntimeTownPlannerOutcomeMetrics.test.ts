import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FileAgentCycleTraceRepository,
  createAgentCycleTrace,
  type AgentCycleTrace,
} from '@aivilization/observability';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createLocalRuntimeTownProfilePlannerOutcomeMetrics,
  createPlannerOutcomeMetricsFromAgentCycleTraces,
} from './localRuntimeTownPlannerOutcomeMetrics';
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

describe('local runtime town planner outcome metrics', () => {
  test('summarizes planner execution outcomes from agent cycle traces', () => {
    const metrics = createPlannerOutcomeMetricsFromAgentCycleTraces([
      createTrace({
        traceId: 'accepted',
        selectedBranch: 'development',
        simulatorStatus: 'accepted',
        acceptedActionCount: 2,
        emittedCommandCount: 2,
        replanning: false,
      }),
      createTrace({
        traceId: 'repaired',
        selectedBranch: 'production',
        simulatorStatus: 'repaired',
        acceptedActionCount: 1,
        emittedCommandCount: 1,
        replanning: true,
      }),
      createTrace({
        traceId: 'rejected',
        selectedBranch: 'production',
        simulatorStatus: 'rejected',
        acceptedActionCount: 0,
        emittedCommandCount: 0,
        replanning: true,
      }),
    ]);

    expect(metrics).toEqual([
      { metricId: 'planner-cycle-trace-count', value: 3, higherIsBetter: true },
      { metricId: 'planner-command-emitting-cycle-ratio', value: 2 / 3, higherIsBetter: true },
      { metricId: 'planner-simulator-accepted-ratio', value: 1 / 3, higherIsBetter: true },
      { metricId: 'planner-simulator-repaired-ratio', value: 1 / 3, higherIsBetter: false },
      { metricId: 'planner-simulator-rejected-ratio', value: 1 / 3, higherIsBetter: false },
      { metricId: 'planner-replanning-cycle-ratio', value: 2 / 3, higherIsBetter: false },
      { metricId: 'planner-mean-accepted-action-count', value: 1, higherIsBetter: true },
      { metricId: 'planner-mean-emitted-command-count', value: 1, higherIsBetter: true },
      { metricId: 'planner-distinct-selected-branch-count', value: 2, higherIsBetter: true },
    ]);
  });

  test('reads planner outcome metrics from profile partition observability repositories', async () => {
    const rootDir = createRootDir();
    await savePartitionTrace({
      rootDir,
      simulationId: 'aivilization-smoke-25',
      partitionKey: 'world-main',
      trace: createTrace({
        traceId: 'main-accepted',
        simulationId: 'aivilization-smoke-25',
        selectedBranch: 'development',
        simulatorStatus: 'accepted',
        acceptedActionCount: 1,
        emittedCommandCount: 1,
        replanning: false,
      }),
    });
    await savePartitionTrace({
      rootDir,
      simulationId: 'aivilization-smoke-25',
      partitionKey: 'world-east',
      trace: createTrace({
        traceId: 'east-rejected',
        simulationId: 'aivilization-smoke-25',
        selectedBranch: 'market',
        simulatorStatus: 'rejected',
        acceptedActionCount: 0,
        emittedCommandCount: 0,
        replanning: true,
      }),
    });

    await expect(
      createLocalRuntimeTownProfilePlannerOutcomeMetrics(createSummary(rootDir)),
    ).resolves.toEqual([
      { metricId: 'planner-cycle-trace-count', value: 2, higherIsBetter: true },
      { metricId: 'planner-command-emitting-cycle-ratio', value: 0.5, higherIsBetter: true },
      { metricId: 'planner-simulator-accepted-ratio', value: 0.5, higherIsBetter: true },
      { metricId: 'planner-simulator-repaired-ratio', value: 0, higherIsBetter: false },
      { metricId: 'planner-simulator-rejected-ratio', value: 0.5, higherIsBetter: false },
      { metricId: 'planner-replanning-cycle-ratio', value: 0.5, higherIsBetter: false },
      { metricId: 'planner-mean-accepted-action-count', value: 0.5, higherIsBetter: true },
      { metricId: 'planner-mean-emitted-command-count', value: 0.5, higherIsBetter: true },
      { metricId: 'planner-distinct-selected-branch-count', value: 2, higherIsBetter: true },
    ]);
  });
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-planner-outcome-'));
  tmpRoots.push(root);
  return root;
}

async function savePartitionTrace(input: {
  readonly rootDir: string;
  readonly simulationId: string;
  readonly partitionKey: string;
  readonly trace: AgentCycleTrace;
}): Promise<void> {
  const repository = new FileAgentCycleTraceRepository({
    rootDir: join(
      input.rootDir,
      'simulations',
      input.simulationId,
      'partitions',
      input.partitionKey,
      'observability',
    ),
  });
  await repository.record(input.trace);
}

function createTrace(input: {
  readonly traceId: string;
  readonly simulationId?: string;
  readonly selectedBranch: string;
  readonly simulatorStatus: 'accepted' | 'repaired' | 'rejected';
  readonly acceptedActionCount: number;
  readonly emittedCommandCount: number;
  readonly replanning: boolean;
}): AgentCycleTrace {
  const acceptedActions = Array.from({ length: input.acceptedActionCount }, (_, index) => ({
    id: `${input.traceId}:action-${index + 1}`,
    description: `Accepted action ${index + 1}`,
    commandType: 'AgentStudy',
    priority: index + 1,
  }));
  const rejectedActions =
    input.acceptedActionCount === 0
      ? [
          {
            action: {
              id: `${input.traceId}:rejected-action`,
              description: 'Rejected action',
              commandType: 'AgentStudy',
            },
            reason: 'blocked by test fixture',
          },
        ]
      : [];

  return createAgentCycleTrace({
    traceId: input.traceId,
    simulationId: input.simulationId ?? 'sim-1',
    agentId: `${input.traceId}:agent`,
    cycleStartedAt: 100,
    observedStateSummary: 'energy=50 satiety=80 health=100 education=10',
    selectedBranch: input.selectedBranch,
    subtaskCandidates: [
      {
        branchId: input.selectedBranch,
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
      acceptedActions,
      rejectedActions,
    },
    candidateActions: acceptedActions.map((action) => action.description),
    simulatorResult:
      input.simulatorStatus === 'accepted'
        ? { status: 'accepted' }
        : { status: input.simulatorStatus, reason: `${input.simulatorStatus} by test fixture` },
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
          reason: 'repair from outcome fixture',
          failedActionIds: [`${input.traceId}:failed-action`],
          evidenceRecordIds: [],
        }
      : { kind: 'none' },
    emittedCommandIds: Array.from(
      { length: input.emittedCommandCount },
      (_, index) => `${input.traceId}:command-${index + 1}`,
    ),
    memoryContextIds: [],
    memoryWriteIds: [],
  });
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
