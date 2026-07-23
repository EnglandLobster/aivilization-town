import {
  aivilizationAblationScenarioPreset,
  createCommodityMarketPoolSeeds,
} from '@aivilization/content';
import { createAgentCycleTrace } from '@aivilization/observability';
import { createEventEnvelope } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  createPaperPlannerAblationObjectiveProposer,
  createWorkerPaperPlannerAblationRunArtifact,
  createWorldProjectionFromScenario,
} from './index';

describe('worker paper planner ablation experiment', () => {
  test('injects one paper-reported top-level long-term goal for every cohort agent', async () => {
    const proposer = createPaperPlannerAblationObjectiveProposer('task-2');
    const agent = aivilizationAblationScenarioPreset.agentSeeds[0];
    if (agent === undefined) {
      throw new Error('expected an ablation agent');
    }
    const proposal = await proposer({
      agentId: agent.agentId,
      agent: {
        agentId: agent.agentId,
        locationId: agent.locationId,
        physiology: agent.physiology,
        educationScore: agent.educationScore,
        balance: agent.balance,
        residentialTier: agent.residentialTier,
        job: agent.job,
        inventory: agent.inventory,
      },
      projection: createProjection(0),
      intentionState: {
        agentId: agent.agentId,
        completedObjectives: [],
        scheduledIntentions: [],
        updatedAt: 0,
      },
      longTermProfile: {
        agentId: agent.agentId,
        beliefs: [],
        habits: [],
        mood: [],
        values: [],
        personality: [],
        socialRecords: [],
      },
      shortTermMemoryContext: [],
      issuedAt: 0,
    });

    expect(proposal).toMatchObject({
      objective: {
        id: 'paper-ablation:task-2:ablation-agent-001',
        statement:
          'Try to earn as much money as possible and increase your study experience as much as possible',
        priority: 100,
        affinityTags: ['work', 'trade', 'production', 'education', 'study'],
      },
      decisionTrace: {
        selectedCandidateId: 'paper-ablation-task-2',
      },
    });
  });

  test('derives terminal outcomes, high-tech production, chip output, and action diversity', () => {
    const firstAgentId = aivilizationAblationScenarioPreset.agentSeeds[0]?.agentId;
    if (firstAgentId === undefined) {
      throw new Error('expected an ablation agent');
    }
    const production = createEventEnvelope({
      id: 'production-event-1',
      simulationId: 'aivilization-ablation-80',
      commandId: 'production-command-1',
      type: 'CommodityProduced',
      payload: {
        agentId: firstAgentId,
        produced: { Transistor: 2, Chip: 1 },
        consumedInputs: {},
        energyCost: 1,
        satietyCost: 1,
        laborSeconds: 1,
      },
      occurredAt: 60_000,
      sequence: 1,
    });
    const traces = [
      createTrace('trace-1', firstAgentId, 30_000, ['Craft Chip', 'Buy Fish']),
      createTrace('trace-2', firstAgentId, 60_000, [' craft   chip ', 'Self Study']),
    ];

    const artifact = createWorkerPaperPlannerAblationRunArtifact({
      run: {
        runId: 'task-3-default-run',
        simulationId: 'aivilization-ablation-80',
        runManifestId: 'resolved-run-manifest:sha256:test',
        sourceRevision: {
          commit: '0123456789abcdef0123456789abcdef01234567',
          dirty: false,
        },
        seed: 'task-3-seed',
        taskId: 'task-3',
        variant: 'default',
        experimentStartedAt: 0,
        experimentEndedAt: 120_000,
        completedCycleCount: 2,
        generatedAt: 125_000,
      },
      finalProjection: createProjection(120_000),
      events: [production],
      agentCycleTraces: traces,
    });

    expect(artifact.agentOutcomes[0]).toMatchObject({
      agentId: firstAgentId,
      highTechItemsProduced: 3,
      chipsProduced: 1,
      productionEventIds: ['production-event-1'],
    });
    expect(artifact.metrics).toMatchObject([
      { metricId: 'unique-actions-per-turn', value: 2 },
      { metricId: 'unique-actions-per-simulated-minute', value: 1.5 },
      { metricId: 'total-unique-actions', value: 3 },
    ]);
  });
});

function createProjection(now: number) {
  return createWorldProjectionFromScenario({
    preset: aivilizationAblationScenarioPreset,
    clock: { now, tickDurationMs: 1_000 },
    marketPools: createCommodityMarketPoolSeeds({
      commodityReserve: 1_000,
      currencyReserve: 10_000,
    }),
  });
}

function createTrace(
  traceId: string,
  agentId: string,
  cycleStartedAt: number,
  candidateActions: readonly string[],
) {
  return createAgentCycleTrace({
    traceId,
    simulationId: 'aivilization-ablation-80',
    agentId,
    cycleStartedAt,
    observedStateSummary: 'paper ablation fixture',
    selectedBranch: 'exploration',
    subtaskCandidates: [
      {
        branchId: 'exploration',
        subtaskId: 'explore',
        description: 'Explore',
        score: 1,
        scoreBreakdown: {
          basePriorityScore: 1,
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
          id: `${traceId}-action`,
          description: candidateActions[0] ?? 'Explore',
          commandType: 'AgentProduce',
        },
      ],
      rejectedActions: [],
    },
    candidateActions,
    simulatorResult: { status: 'accepted' },
    simulatorEvents: [],
    selectionEvidence: {
      selectedSubtaskId: 'explore',
      intentionInfluenceScore: 0,
      memoryInfluenceScore: 0,
      profileInfluenceScore: 0,
      memoryEvidenceRecordIds: [],
      profileEntryKeys: [],
      profileEvidenceRecordIds: [],
    },
    replanningDecision: { kind: 'none' },
    subtaskReplanningDecisions: [],
    emittedCommandIds: [],
    memoryContextIds: [],
    memoryWriteIds: [],
  });
}
