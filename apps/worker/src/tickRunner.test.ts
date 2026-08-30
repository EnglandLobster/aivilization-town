import {
  createBranchPlan,
  InMemoryBranchPlanRepository,
  InMemoryBranchPlanProgressRepository,
  type AtomicActionProposal,
  type ActionSequenceGenerator,
  type DomainMicroPlanner,
  type GlobalActionSynthesizer,
  type ReactiveCorrector,
  type SocialDialogueGenerator,
  type SocialSignalExtractor,
  type SubtaskPrioritizer,
  type WorldDecisionContext,
} from '@aivilization/agent-runtime';
import { createAmmPool } from '@aivilization/economy';
import {
  InMemoryMarketObservationRepository,
  type ReactionEvaluationTrace,
} from '@aivilization/observability';
import {
  createShortTermMemoryRecord,
  InMemoryAgentIntentionRepository,
  InMemoryLongTermProfileRepository,
  InMemoryShortTermMemoryRepository,
  type LongTermAgentProfile,
  type ShortTermMemoryRecord,
} from '@aivilization/memory';
import {
  FileProjectionSnapshotStore,
  InMemoryEventStore,
  InMemoryProjectionCheckpointStore,
  asAgentId,
  asEventId,
  asLocationId,
  asSimulationId,
  createSimulationPartition,
  type AgentId,
} from '@aivilization/sim-core';
import {
  createWorldProjection,
  type WorldCommandPolicies,
  type WorldEvent,
  type WorldProjection,
} from '@aivilization/world';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createAivilizationWorldCommandPolicies,
  dispatchCommandDraftsToWorldEventStream,
  runWorkerSimulationTick,
} from './index';
import { CANONICAL_AMBIENT_OBSERVATION_VISIBLE_EVENT_TYPES } from './ambientObservationMemory';

const simulationId = asSimulationId('sim-1');
const agentOne = asAgentId('agent-1');
const agentTwo = asAgentId('agent-2');
const agentThree = asAgentId('agent-3');
const school = asLocationId('school');
const partition = createSimulationPartition({ simulationId, partitionKey: 'world-main' });
const tmpRoots: string[] = [];

type CapturedAmbientReactionContext = {
  readonly agentId: AgentId;
  readonly longTermProfile: LongTermAgentProfile | undefined;
  readonly memoryContext: readonly ShortTermMemoryRecord[] | undefined;
  readonly worldDecisionContext: WorldDecisionContext | undefined;
};

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: { Bread: 15 },
  maxSatiety: 100,
  wageCalculator: () => 10,
  laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
  criticalThresholds: { energy: 1, health: 1 },
  sleep: { energyRecoveryPerSecond: 1, maxEnergy: 100 },
  jobApplication: {
    populationEducationScores: [0],
    quotaByResidentialTier: [1, 1, 1, 1, 1],
  },
};

function createProjection() {
  return createWorldProjection({
    agents: [
      {
        agentId: agentOne,
        physiology: { energy: 50, satiety: 80, health: 100 },
        educationScore: 10,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
      {
        agentId: agentTwo,
        physiology: { energy: 60, satiety: 80, health: 100 },
        educationScore: 20,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
    ],
  });
}

function createCoLocatedStudyProjection() {
  return createWorldProjection({
    locations: [
      {
        locationId: school,
        name: 'School',
        kind: 'education',
        activityAffinities: ['study', 'socialize'],
        capacity: null,
      },
    ],
    agents: [
      {
        agentId: agentOne,
        locationId: school,
        physiology: { energy: 50, satiety: 80, health: 100 },
        educationScore: 10,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
      {
        agentId: agentTwo,
        locationId: school,
        physiology: { energy: 60, satiety: 80, health: 100 },
        educationScore: 20,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
    ],
  });
}

function createCoLocatedConversationProjection() {
  return createWorldProjection({
    locations: [
      {
        locationId: school,
        name: 'School',
        kind: 'education',
        activityAffinities: ['study', 'socialize'],
        capacity: null,
      },
    ],
    agents: [
      {
        agentId: agentOne,
        locationId: school,
        physiology: { energy: 50, satiety: 80, health: 100 },
        educationScore: 10,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
      {
        agentId: agentTwo,
        locationId: school,
        physiology: { energy: 60, satiety: 80, health: 100 },
        educationScore: 20,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
      {
        agentId: agentThree,
        locationId: school,
        physiology: { energy: 70, satiety: 80, health: 100 },
        educationScore: 30,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
    ],
  });
}

function createSleepDeprivedProjection() {
  return createWorldProjection({
    agents: [
      {
        agentId: agentOne,
        physiology: { energy: 10, satiety: 80, health: 90 },
        educationScore: 10,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
    ],
  });
}

function createTierCappedSleepProjection() {
  return createWorldProjection({
    agents: [
      {
        agentId: agentOne,
        physiology: { energy: 40, satiety: 70, health: 90 },
        educationScore: 10,
        balance: 100,
        residentialTier: 2,
        job: null,
        inventory: {},
      },
    ],
  });
}

function createIllnessProjection() {
  return createWorldProjection({
    agents: [
      {
        agentId: agentOne,
        physiology: { energy: 80, satiety: 80, health: 90 },
        educationScore: 10,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
    ],
  });
}

function createLowBalanceProjection() {
  return createWorldProjection({
    agents: [
      {
        agentId: agentOne,
        physiology: { energy: 80, satiety: 80, health: 90 },
        educationScore: 10,
        balance: 10,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
    ],
    moneySupply: 100,
  });
}

function createResidentialUpkeepProjection() {
  return createWorldProjection({
    agents: [
      {
        agentId: agentOne,
        physiology: { energy: 80, satiety: 80, health: 90 },
        educationScore: 10,
        balance: 100,
        residentialTier: 2,
        job: null,
        inventory: {},
      },
    ],
    moneySupply: 1000,
  });
}

function createDefaultSurvivalTimePolicyProjection() {
  return createWorldProjection({
    agents: [
      {
        agentId: agentOne,
        physiology: { energy: 10, satiety: 80, health: 90 },
        educationScore: 10,
        balance: 10,
        residentialTier: 2,
        job: null,
        inventory: {},
      },
    ],
    moneySupply: 1000,
  });
}

function createRewardProductionProjection() {
  return createWorldProjection({
    agents: [
      {
        agentId: agentOne,
        physiology: { energy: 100, satiety: 25, health: 100 },
        educationScore: 10,
        balance: 100,
        residentialTier: 5,
        job: null,
        inventory: { Transistor: 1, 'Circuit Board': 1 },
      },
    ],
  });
}

function createMarketProjection() {
  return createWorldProjection({
    agents: [
      {
        agentId: agentOne,
        physiology: { energy: 50, satiety: 80, health: 100 },
        educationScore: 10,
        balance: 1000,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
    ],
    marketPools: [
      createAmmPool({ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }),
    ],
    moneySupply: 1000,
  });
}

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-worker-tick-'));
  tmpRoots.push(root);
  return root;
}

function createStudyPlan() {
  return createBranchPlan({
    objective: 'develop education',
    branches: [
      {
        id: 'development',
        objective: 'improve education',
        subtasks: [{ id: 'study', description: 'self study', basePriority: 5 }],
      },
    ],
  });
}

function createStudyFailureMemory(input: {
  readonly id: string;
  readonly agentId: AgentId;
  readonly occurredAt: number;
}) {
  return createShortTermMemoryRecord({
    id: input.id,
    agentId: input.agentId,
    kind: 'action',
    status: 'failed',
    summary: 'Failed to study because energy was too low.',
    occurredAt: input.occurredAt,
    importanceScore: 0.9,
    source: { eventIds: [] },
    tags: ['study', 'energy'],
  });
}

function createSocialPlan() {
  return createBranchPlan({
    objective: 'build community relationships',
    branches: [
      {
        id: 'social',
        objective: 'coordinate a community party',
        subtasks: [{ id: 'socialize', description: 'discuss Valentine party', basePriority: 5 }],
      },
    ],
  });
}

function createStudyPlanner(action: AtomicActionProposal): DomainMicroPlanner {
  return {
    domain: 'study',
    supports: ({ subtaskId }) => subtaskId === 'study',
    propose: () => [action],
  };
}

function createConversationPlanner(): DomainMicroPlanner {
  return {
    domain: 'social',
    supports: ({ subtaskId }) => subtaskId === 'socialize',
    propose: () => [
      {
        id: 'conversation-party',
        description: 'Discuss Valentine party with agent-3.',
        commandType: 'AgentStartConversation',
        payload: {
          targetAgentId: agentThree,
          topic: 'Valentine party',
          relationDelta: 1,
          attitudeDelta: 1,
          turns: [
            {
              speakerAgentId: agentOne,
              utterance: 'Can you help coordinate the Valentine party?',
              intent: 'invite-party-planning',
            },
            {
              speakerAgentId: agentThree,
              utterance: 'Yes, let us invite more neighbors.',
              intent: 'accept-party-planning',
            },
          ],
        },
      },
    ],
  };
}

function createRepositories() {
  return {
    intentionRepository: new InMemoryAgentIntentionRepository(),
    longTermProfileRepository: new InMemoryLongTermProfileRepository(),
    shortTermMemoryRepository: new InMemoryShortTermMemoryRepository(),
  };
}

function createTickAgents() {
  return [
    {
      agentId: agentOne,
      observedStateSummary: 'agent-1 education=10',
      plan: createStudyPlan(),
      signals: [],
      microPlanners: [
        createStudyPlanner({
          id: 'study-agent-1',
          description: 'agent 1 studies',
          commandType: 'AgentStudy',
          payload: { durationSeconds: 60, educationRatePerSecond: 1 },
        }),
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    },
    {
      agentId: agentTwo,
      observedStateSummary: 'agent-2 education=20',
      plan: createStudyPlan(),
      signals: [],
      microPlanners: [
        createStudyPlanner({
          id: 'study-agent-2',
          description: 'agent 2 studies',
          commandType: 'AgentStudy',
          payload: { durationSeconds: 30, educationRatePerSecond: 1 },
        }),
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    },
  ] satisfies Parameters<typeof runWorkerSimulationTick>[0]['agents'];
}

function createTradeTickAgent() {
  return {
    agentId: agentOne,
    observedStateSummary: 'agent-1 is checking the Apple market',
    plan: createBranchPlan({
      objective: 'buy food from the market',
      branches: [
        {
          id: 'market',
          objective: 'buy Apple',
          subtasks: [{ id: 'buy-apple', description: 'buy Apple', basePriority: 5 }],
        },
      ],
    }),
    signals: [],
    microPlanners: [
      {
        domain: 'trade',
        supports: ({ subtaskId }) => subtaskId === 'buy-apple',
        propose: () => [
          {
            id: 'buy-apple',
            description: 'buy Apple from AMM',
            commandType: 'AgentTrade',
            payload: { side: 'buy', commodityName: 'Apple', quantity: 10 },
          },
        ],
      },
    ],
    simulate: ({ action }) => ({ status: 'accepted', action }),
  } satisfies Parameters<typeof runWorkerSimulationTick>[0]['agents'][number];
}

function createRewardProductionTickAgent() {
  return {
    agentId: agentOne,
    observedStateSummary: 'agent-1 is producing a Chip',
    plan: createBranchPlan({
      objective: 'produce high-tech goods',
      branches: [
        {
          id: 'production',
          objective: 'produce Chip',
          subtasks: [{ id: 'produce-chip', description: 'craft Chip', basePriority: 5 }],
        },
      ],
    }),
    signals: [],
    microPlanners: [
      {
        domain: 'production',
        supports: ({ subtaskId }) => subtaskId === 'produce-chip',
        propose: () => [
          {
            id: 'produce-chip',
            description: 'produce Chip with possible special reward',
            commandType: 'AgentProduce',
            payload: {
              commodityName: 'Chip',
              quantity: 1,
              availableLaborSeconds: 5,
            },
          },
        ],
      },
    ],
    simulate: ({ action }) => ({ status: 'accepted', action }),
  } satisfies Parameters<typeof runWorkerSimulationTick>[0]['agents'][number];
}

function createSleepTickAgent() {
  return {
    agentId: agentOne,
    observedStateSummary: 'agent-1 energy=40',
    plan: createBranchPlan({
      objective: 'recover energy',
      branches: [
        {
          id: 'rest',
          objective: 'sleep',
          subtasks: [{ id: 'sleep', description: 'sleep now', basePriority: 5 }],
        },
      ],
    }),
    signals: [],
    microPlanners: [
      {
        domain: 'sleep',
        supports: ({ subtaskId }) => subtaskId === 'sleep',
        propose: () => [
          {
            id: 'sleep',
            description: 'sleep to recover energy',
            commandType: 'AgentSleep',
            payload: { durationSeconds: 1800 },
          },
        ],
      },
    ],
    simulate: ({ action }) => ({ status: 'accepted', action }),
  } satisfies Parameters<typeof runWorkerSimulationTick>[0]['agents'][number];
}

describe('worker tick runner', () => {
  test('runs agent cycles in order while carrying projection and stream version forward', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const individuallyRecordedTraceIds: string[] = [];
    const recordedTraceBatches: string[][] = [];
    const result = await runWorkerSimulationTick({
      tickId: 'tick-1',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: createTickAgents(),
      traceSink: {
        record: (trace) => {
          individuallyRecordedTraceIds.push(trace.traceId);
        },
        recordMany: (traces) => {
          recordedTraceBatches.push(traces.map((trace) => trace.traceId));
        },
      },
      ...repositories,
    });

    expect(result.agentResults).toHaveLength(2);
    expect(result.events.map((event) => [event.sequence, event.type])).toEqual([
      [1, 'SimulationTimeAdvanced'],
      [2, 'EducationChanged'],
      [3, 'AgentActivityTimeCommitted'],
      [4, 'ShortTermMemoryRecorded'],
      [5, 'EducationChanged'],
      [6, 'AgentActivityTimeCommitted'],
      [7, 'ShortTermMemoryRecorded'],
    ]);
    expect(result.events[0]).toMatchObject({
      id: 'tick-1-advance-time:event:0',
      commandId: 'tick-1-advance-time',
      payload: {
        previous: { now: 0, tickDurationMs: 1000 },
        next: { now: 1000, tickDurationMs: 1000 },
        deltaMs: 1000,
      },
    });
    expect(result.projection.clock).toEqual({ now: 1000, tickDurationMs: 1000 });
    expect(result.projection.agents['agent-1']?.educationScore).toBe(70);
    expect(result.projection.agents['agent-2']?.educationScore).toBe(50);
    expect(result.streamVersion).toBe(7);
    expect(result.traces.map((trace) => trace.traceId)).toEqual([
      'tick-1:cycle:1:agent-1',
      'tick-1:cycle:2:agent-2',
    ]);
    expect(individuallyRecordedTraceIds).toEqual([]);
    expect(recordedTraceBatches).toEqual([['tick-1:cycle:1:agent-1', 'tick-1:cycle:2:agent-2']]);
    expect(eventStore.getStreamVersion(partition.eventStreamName)).toBe(7);
  });

  test('passes tick agent action synthesis policy into cycle traces', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const simulatedActionIds: string[] = [];

    const result = await runWorkerSimulationTick({
      tickId: 'tick-action-synthesis',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: [
        {
          agentId: agentOne,
          observedStateSummary: 'agent-1 education=10',
          plan: createStudyPlan(),
          signals: [],
          actionSynthesis: { maxActions: 1 },
          microPlanners: [
            {
              domain: 'study',
              supports: ({ subtaskId }) => subtaskId === 'study',
              propose: () => [
                {
                  id: 'sleep-low-priority',
                  description: 'sleep before studying',
                  commandType: 'AgentSleep',
                  payload: { durationSeconds: 60 },
                  priority: 1,
                  resourceEstimate: { actionSeconds: 60 },
                },
                {
                  id: 'study-high-priority',
                  description: 'study now',
                  commandType: 'AgentStudy',
                  payload: { durationSeconds: 60, educationRatePerSecond: 1 },
                  priority: 3,
                  resourceEstimate: { actionSeconds: 60 },
                },
              ],
            },
          ],
          simulate: ({ action }) => {
            simulatedActionIds.push(action.id);
            return { status: 'accepted', action };
          },
        },
      ],
      ...repositories,
    });

    expect(simulatedActionIds).toEqual(['study-high-priority']);
    expect(result.traces[0]?.actionSynthesis).toEqual({
      acceptedActions: [
        {
          id: 'study-high-priority',
          description: 'study now',
          commandType: 'AgentStudy',
          priority: 3,
          synthesisContext: {
            branchId: 'development',
            subtaskId: 'study',
            subtaskScore: 5,
          },
          resourceEstimate: { actionSeconds: 60 },
        },
      ],
      rejectedActions: [
        {
          action: {
            id: 'sleep-low-priority',
            description: 'sleep before studying',
            commandType: 'AgentSleep',
            priority: 1,
            synthesisContext: {
              branchId: 'development',
              subtaskId: 'study',
              subtaskScore: 5,
            },
            resourceEstimate: { actionSeconds: 60 },
          },
          reason: 'maxActions exhausted',
        },
      ],
    });
    expect(result.events.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'EducationChanged',
      'AgentActivityTimeCommitted',
      'ShortTermMemoryRecorded',
    ]);
  });

  test('passes tick agent contextual subtask prioritizer into cycle traces', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const simulatedSubtasks: string[] = [];
    const prioritizer: SubtaskPrioritizer = async ({ candidates }) => {
      await Promise.resolve();
      return {
        candidates: [
          {
            ...candidates[1]!,
            score: 13,
            scoreBreakdown: {
              ...candidates[1]!.scoreBreakdown,
              contextualReasoningScore: 11,
            },
          },
          candidates[0]!,
        ],
        trace: {
          status: 'accepted',
          source: 'llm',
          requestId: 'prioritize-tick-agent-1',
          choices: [
            {
              branchId: 'recovery',
              subtaskId: 'eat',
              priorityScore: 13,
              rationale: 'Low satiety makes food recovery more urgent than wage work.',
            },
            {
              branchId: 'income',
              subtaskId: 'work',
              priorityScore: 6,
              rationale: 'Work can resume after recovery.',
            },
          ],
        },
      };
    };

    const result = await runWorkerSimulationTick({
      tickId: 'tick-contextual-prioritization',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: [
        {
          agentId: agentOne,
          observedStateSummary: 'agent-1 satiety=30',
          plan: createBranchPlan({
            objective: 'balance survival and income',
            branches: [
              {
                id: 'income',
                objective: 'earn currency',
                subtasks: [{ id: 'work', description: 'work shift', basePriority: 6 }],
              },
              {
                id: 'recovery',
                objective: 'restore satiety',
                subtasks: [{ id: 'eat', description: 'eat before work', basePriority: 2 }],
              },
            ],
          }),
          signals: [],
          subtaskPrioritizer: prioritizer,
          microPlanners: [
            {
              domain: 'eat',
              supports: ({ subtaskId }) => subtaskId === 'eat',
              propose: () => [
                {
                  id: 'eat-action',
                  description: 'eat before work',
                  commandType: 'AgentStudy',
                  payload: { durationSeconds: 60, educationRatePerSecond: 1 },
                },
              ],
            },
            {
              domain: 'work',
              supports: ({ subtaskId }) => subtaskId === 'work',
              propose: () => [
                {
                  id: 'work-action',
                  description: 'work shift',
                  commandType: 'AgentStudy',
                  payload: { durationSeconds: 60, educationRatePerSecond: 1 },
                },
              ],
            },
          ],
          simulate: ({ action, selectedSubtask }) => {
            simulatedSubtasks.push(
              `${action.id}:${selectedSubtask.branchId}/${selectedSubtask.subtaskId}`,
            );
            return { status: 'accepted', action };
          },
        },
      ],
      ...repositories,
    });

    expect(simulatedSubtasks).toEqual(['eat-action:recovery/eat']);
    expect(result.agentResults[0]?.cycleResult.selectedSubtask).toMatchObject({
      branchId: 'recovery',
      subtaskId: 'eat',
      score: 13,
    });
    expect(result.traces[0]?.contextualPrioritization).toMatchObject({
      status: 'accepted',
      source: 'llm',
      requestId: 'prioritize-tick-agent-1',
      choices: [{ subtaskId: 'eat' }, { subtaskId: 'work' }],
    });
  });

  test('passes tick agent action sequence generator into cycle traces', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const simulatedActions: string[] = [];
    const actionSequenceGenerator: ActionSequenceGenerator = async ({
      deterministicActions,
      selectedSubtask,
      worldDecisionContext,
    }) => {
      await Promise.resolve();
      expect(deterministicActions.map((action) => action.id)).toEqual(['study-fallback']);
      expect(selectedSubtask).toMatchObject({ branchId: 'development', subtaskId: 'study' });
      expect(worldDecisionContext?.agent.educationScore).toBe(10);
      return {
        actions: [
          {
            id: 'llm-study-focused',
            description: 'study with a focused two minute routine',
            commandType: 'AgentStudy',
            payload: { durationSeconds: 120, educationRatePerSecond: 1 },
            priority: 11,
          },
        ],
        trace: {
          status: 'accepted',
          source: 'llm',
          selectedSubtask: { branchId: 'development', subtaskId: 'study' },
          requestId: 'sequence-tick-agent-1',
          actions: [
            {
              id: 'llm-study-focused',
              commandType: 'AgentStudy',
              rationale: 'Use a longer study action because health and energy can support it.',
            },
          ],
        },
      };
    };

    const result = await runWorkerSimulationTick({
      tickId: 'tick-action-sequence-generation',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: [
        {
          agentId: agentOne,
          observedStateSummary: 'agent-1 education=10',
          plan: createBranchPlan({
            objective: 'develop education',
            branches: [
              {
                id: 'development',
                objective: 'improve education',
                subtasks: [{ id: 'study', description: 'self study', basePriority: 5 }],
              },
            ],
          }),
          signals: [],
          actionSequenceGenerator,
          microPlanners: [
            {
              domain: 'study',
              supports: ({ subtaskId }) => subtaskId === 'study',
              propose: () => [
                {
                  id: 'study-fallback',
                  description: 'study fallback for one minute',
                  commandType: 'AgentStudy',
                  payload: { durationSeconds: 60, educationRatePerSecond: 1 },
                },
              ],
            },
          ],
          simulate: ({ action, selectedSubtask }) => {
            simulatedActions.push(
              `${action.id}:${selectedSubtask.branchId}/${selectedSubtask.subtaskId}`,
            );
            return { status: 'accepted', action };
          },
        },
      ],
      ...repositories,
    });

    expect(simulatedActions).toEqual(['llm-study-focused:development/study']);
    expect(
      result.agentResults[0]?.dispatchResult?.commands.map((command) => command.payload),
    ).toEqual([{ durationSeconds: 120, educationRatePerSecond: 1 }]);
    expect(result.traces[0]?.actionSequenceGeneration).toEqual([
      {
        status: 'accepted',
        source: 'llm',
        selectedSubtask: { branchId: 'development', subtaskId: 'study' },
        requestId: 'sequence-tick-agent-1',
        actions: [
          {
            id: 'llm-study-focused',
            commandType: 'AgentStudy',
            rationale: 'Use a longer study action because health and energy can support it.',
          },
        ],
      },
    ]);
  });

  test('passes tick agent social dialogue generator into command payloads and cycle traces', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const socialDialogueGenerator: SocialDialogueGenerator = async (input) => {
      await Promise.resolve();
      expect(input.action.id).toBe('conversation-party');
      expect(input.deterministicPayload.topic).toBe('Valentine party');
      return {
        payload: {
          ...input.deterministicPayload,
          topic: 'LLM coordinated Valentine party planning',
          turns: [
            {
              speakerAgentId: agentOne,
              utterance: 'I can bring snacks if you invite nearby classmates.',
              intent: 'coordinate-party-task',
            },
            {
              speakerAgentId: agentThree,
              utterance: 'I will invite them and check whether the classroom is free.',
              intent: 'accept-party-task',
            },
          ],
        },
        trace: {
          status: 'accepted',
          source: 'llm',
          selectedSubtask: { branchId: 'social', subtaskId: 'socialize' },
          actionId: 'conversation-party',
          targetAgentId: agentThree,
          requestId: 'social-dialogue-tick-agent-1',
          turnCount: 2,
          rationale: 'Generate a concrete two-party party planning exchange.',
        },
      };
    };

    const result = await runWorkerSimulationTick({
      tickId: 'tick-social-dialogue',
      simulationId,
      issuedAt: 910,
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      projection: createCoLocatedConversationProjection(),
      agents: [
        {
          agentId: agentOne,
          observedStateSummary: 'agent-1 socializing at school',
          plan: createSocialPlan(),
          signals: [],
          microPlanners: [createConversationPlanner()],
          socialDialogueGenerator,
          simulate: ({ action }) => ({ status: 'accepted', action }),
        },
      ],
      ...repositories,
    });

    expect(result.agentResults[0]?.dispatchResult?.commands[0]?.payload).toMatchObject({
      topic: 'LLM coordinated Valentine party planning',
      turns: [
        {
          speakerAgentId: 'agent-1',
          utterance: 'I can bring snacks if you invite nearby classmates.',
          intent: 'coordinate-party-task',
        },
        {
          speakerAgentId: 'agent-3',
          utterance: 'I will invite them and check whether the classroom is free.',
          intent: 'accept-party-task',
        },
      ],
    });
    expect(result.traces[0]?.socialDialogueGeneration).toEqual([
      {
        status: 'accepted',
        source: 'llm',
        selectedSubtask: { branchId: 'social', subtaskId: 'socialize' },
        actionId: 'conversation-party',
        targetAgentId: 'agent-3',
        requestId: 'social-dialogue-tick-agent-1',
        turnCount: 2,
        rationale: 'Generate a concrete two-party party planning exchange.',
      },
    ]);
    // No signal extractor is configured: the keyword adjudication path is recorded.
    expect(result.traces[0]?.socialSignalExtraction).toEqual([
      {
        status: 'deterministic',
        source: 'deterministic',
        policyVersion: 'llm-social-signal-extraction-v2',
        agentId: 'agent-1',
        targetAgentId: 'agent-3',
        topic: 'LLM coordinated Valentine party planning',
        turnCount: 2,
        extractedSignalCount: 0,
      },
    ]);
  });

  test('passes tick agent social signal extractor into command payloads and cycle traces', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const socialSignalExtractor: SocialSignalExtractor = (input) =>
      Promise.resolve({
        turnSignals: [{ turnIndex: 0, signals: [{ signal: 'cooperation', severity: 0.75 }] }],
        trace: {
          status: 'accepted',
          source: 'llm',
          policyVersion: 'llm-social-signal-extraction-v2',
          agentId: input.agentId,
          targetAgentId: input.targetAgentId,
          topic: input.topic,
          turnCount: input.turns.length,
          extractedSignalCount: 1,
          requestId: 'social-signals-tick-agent-1',
          providerId: 'scripted-social-signals',
          model: 'signal-model',
        },
      });

    const result = await runWorkerSimulationTick({
      tickId: 'tick-social-signals',
      simulationId,
      issuedAt: 911,
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      projection: createCoLocatedConversationProjection(),
      agents: [
        {
          agentId: agentOne,
          observedStateSummary: 'agent-1 socializing at school',
          plan: createSocialPlan(),
          signals: [],
          microPlanners: [createConversationPlanner()],
          socialSignalExtractor,
          simulate: ({ action }) => ({ status: 'accepted', action }),
        },
      ],
      ...repositories,
    });

    expect(result.agentResults[0]?.dispatchResult?.commands[0]?.payload).toMatchObject({
      turnSignals: [{ turnIndex: 0, signals: [{ signal: 'cooperation', severity: 0.75 }] }],
    });
    expect(result.traces[0]?.socialSignalExtraction).toEqual([
      {
        status: 'accepted',
        source: 'llm',
        policyVersion: 'llm-social-signal-extraction-v2',
        agentId: 'agent-1',
        targetAgentId: 'agent-3',
        topic: 'Valentine party',
        turnCount: 2,
        extractedSignalCount: 1,
        requestId: 'social-signals-tick-agent-1',
        providerId: 'scripted-social-signals',
        model: 'signal-model',
      },
    ]);
  });

  test('maps social signal extraction no-proposal traces to the fallback stage state', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const socialSignalExtractor: SocialSignalExtractor = (input) =>
      Promise.resolve({
        trace: {
          status: 'no-proposal',
          source: 'deterministic-fallback',
          policyVersion: 'llm-social-signal-extraction-v2',
          agentId: input.agentId,
          targetAgentId: input.targetAgentId,
          topic: input.topic,
          turnCount: input.turns.length,
          extractedSignalCount: 0,
          requestId: 'social-signals-tick-no-proposal',
          failureReason: 'provider-error',
          message: 'signal provider offline',
        },
      });

    const result = await runWorkerSimulationTick({
      tickId: 'tick-social-signals-fallback',
      simulationId,
      issuedAt: 912,
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      projection: createCoLocatedConversationProjection(),
      agents: [
        {
          agentId: agentOne,
          observedStateSummary: 'agent-1 socializing at school',
          plan: createSocialPlan(),
          signals: [],
          microPlanners: [createConversationPlanner()],
          socialSignalExtractor,
          simulate: ({ action }) => ({ status: 'accepted', action }),
        },
      ],
      ...repositories,
    });

    expect(result.agentResults[0]?.dispatchResult?.commands[0]?.payload).not.toHaveProperty(
      'turnSignals',
    );
    expect(result.traces[0]?.socialSignalExtraction).toEqual([
      {
        status: 'fallback',
        source: 'deterministic-fallback',
        policyVersion: 'llm-social-signal-extraction-v2',
        agentId: 'agent-1',
        targetAgentId: 'agent-3',
        topic: 'Valentine party',
        turnCount: 2,
        extractedSignalCount: 0,
        requestId: 'social-signals-tick-no-proposal',
        failureReason: 'provider-error',
        message: 'signal provider offline',
      },
    ]);
  });

  test('passes tick agent global synthesizer into cycle traces', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const simulatedActions: string[] = [];
    const globalSynthesizer: GlobalActionSynthesizer = async ({
      candidateActions,
      deterministicSynthesisResult,
      worldDecisionContext,
    }) => {
      await Promise.resolve();
      expect(candidateActions.map((action) => action.id)).toEqual([
        'study-intensive',
        'recover-basics',
      ]);
      expect(deterministicSynthesisResult.acceptedActions.map((action) => action.id)).toEqual([
        'study-intensive',
      ]);
      expect(worldDecisionContext?.agent.educationScore).toBe(10);
      return {
        actions: [
          {
            ...candidateActions[1]!,
            priority: 20,
            synthesisContext: {
              ...candidateActions[1]!.synthesisContext,
              strategicAlignment: 4,
              branchUrgency: 9,
            },
          },
          {
            ...candidateActions[0]!,
            priority: 10,
            synthesisContext: {
              ...candidateActions[0]!.synthesisContext,
              strategicAlignment: 8,
              branchUrgency: 3,
            },
          },
        ],
        trace: {
          status: 'accepted',
          source: 'llm',
          requestId: 'global-synthesis-tick-agent-1',
          choices: [
            {
              actionId: 'recover-basics',
              priorityScore: 20,
              strategicAlignment: 4,
              branchUrgency: 9,
              rationale: 'Recovery should interleave before longer study work.',
            },
            {
              actionId: 'study-intensive',
              priorityScore: 10,
              strategicAlignment: 8,
              branchUrgency: 3,
              rationale: 'Study remains aligned after recovery.',
            },
          ],
        },
      };
    };

    const result = await runWorkerSimulationTick({
      tickId: 'tick-global-synthesis',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: [
        {
          agentId: agentOne,
          observedStateSummary: 'agent-1 education=10',
          plan: createBranchPlan({
            objective: 'balance study and recovery',
            branches: [
              {
                id: 'development',
                objective: 'improve education',
                subtasks: [{ id: 'study', description: 'study intensively', basePriority: 7 }],
              },
              {
                id: 'recovery',
                objective: 'maintain wellbeing',
                subtasks: [{ id: 'recover', description: 'recover before study', basePriority: 6 }],
              },
            ],
          }),
          signals: [],
          actionSynthesis: {
            maxActions: 1,
            candidateSubtasks: { maxSubtasks: 2 },
          },
          globalSynthesizer,
          microPlanners: [
            {
              domain: 'study',
              supports: ({ subtaskId }) => subtaskId === 'study',
              propose: () => [
                {
                  id: 'study-intensive',
                  description: 'study intensively for one minute',
                  commandType: 'AgentStudy',
                  payload: { durationSeconds: 60, educationRatePerSecond: 1 },
                  priority: 12,
                },
              ],
            },
            {
              domain: 'recover',
              supports: ({ subtaskId }) => subtaskId === 'recover',
              propose: () => [
                {
                  id: 'recover-basics',
                  description: 'review basics before intensive study',
                  commandType: 'AgentStudy',
                  payload: { durationSeconds: 30, educationRatePerSecond: 1 },
                  priority: 4,
                },
              ],
            },
          ],
          simulate: ({ action, selectedSubtask }) => {
            simulatedActions.push(
              `${action.id}:${selectedSubtask.branchId}/${selectedSubtask.subtaskId}`,
            );
            return { status: 'accepted', action };
          },
        },
      ],
      ...repositories,
    });

    expect(simulatedActions).toEqual(['recover-basics:recovery/recover']);
    expect(result.traces[0]?.globalSynthesis).toEqual({
      status: 'accepted',
      source: 'llm',
      requestId: 'global-synthesis-tick-agent-1',
      choices: [
        {
          actionId: 'recover-basics',
          priorityScore: 20,
          strategicAlignment: 4,
          branchUrgency: 9,
          rationale: 'Recovery should interleave before longer study work.',
        },
        {
          actionId: 'study-intensive',
          priorityScore: 10,
          strategicAlignment: 8,
          branchUrgency: 3,
          rationale: 'Study remains aligned after recovery.',
        },
      ],
    });
  });

  test('passes tick agent reactive corrector into cycle traces', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const simulatedActions: string[] = [];
    const reactiveCorrector: ReactiveCorrector = async () => {
      await Promise.resolve();
      return {
        action: {
          id: 'study-instead',
          description: 'study briefly instead of working hungry',
          commandType: 'AgentStudy',
          payload: { durationSeconds: 30, educationRatePerSecond: 1 },
        },
        trace: {
          status: 'accepted',
          source: 'llm',
          requestId: 'reactive-correction-tick-agent-1',
          decision: {
            kind: 'propose-action',
            rationale: 'Use a safe short study action after work rejection.',
            evidenceRecordIds: [],
            action: {
              id: 'study-instead',
              description: 'study briefly instead of working hungry',
              commandType: 'AgentStudy',
            },
          },
        },
      };
    };

    const result = await runWorkerSimulationTick({
      tickId: 'tick-reactive-correction',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: [
        {
          agentId: agentOne,
          observedStateSummary: 'agent-1 satiety=20',
          plan: createBranchPlan({
            objective: 'earn income without unsafe work',
            branches: [
              {
                id: 'income',
                objective: 'earn wage',
                subtasks: [{ id: 'work', description: 'work shift', basePriority: 7 }],
              },
            ],
          }),
          signals: [],
          reactiveCorrector,
          microPlanners: [
            {
              domain: 'work',
              supports: ({ subtaskId }) => subtaskId === 'work',
              propose: () => [
                {
                  id: 'work-hungry',
                  description: 'work while hungry',
                  commandType: 'AgentWork',
                  payload: { occupationName: 'Cleaner', laborSeconds: 3600 },
                },
              ],
            },
          ],
          simulate: ({ action, selectedSubtask }) => {
            simulatedActions.push(
              `${action.id}:${selectedSubtask.branchId}/${selectedSubtask.subtaskId}`,
            );
            if (action.id === 'study-instead') {
              return { status: 'accepted', action };
            }
            return { status: 'rejected', action, reason: 'satiety too low' };
          },
        },
      ],
      ...repositories,
    });

    expect(simulatedActions).toEqual(['work-hungry:income/work', 'study-instead:income/work']);
    expect(result.traces[0]?.actionRepair).toMatchObject([
      {
        actionId: 'work-hungry',
        localRepair: { status: 'skipped' },
        reactiveCorrection: {
          status: 'accepted',
          source: 'llm',
          requestId: 'reactive-correction-tick-agent-1',
          simulatorResult: { status: 'accepted' },
        },
        outcome: 'repaired',
      },
    ]);
  });

  test('passes tick agent memory retrieval budget into cycle traces', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    await repositories.shortTermMemoryRepository.append(
      createShortTermMemoryRecord({
        id: 'memory-agent-1-observed-study',
        agentId: agentOne,
        kind: 'observation',
        status: 'observed',
        summary: 'Observed a productive study routine at School.',
        occurredAt: 50,
        importanceScore: 0.9,
        source: { eventIds: [] },
        tags: ['ambient-observation', 'study'],
      }),
    );

    const result = await runWorkerSimulationTick({
      tickId: 'tick-memory-context',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: [
        {
          agentId: agentOne,
          observedStateSummary: 'agent-1 education=10',
          plan: createStudyPlan(),
          signals: [],
          memoryRetrievalLimit: 1,
          microPlanners: [
            createStudyPlanner({
              id: 'study-agent-1',
              description: 'agent 1 studies with retrieved context',
              commandType: 'AgentStudy',
              payload: { durationSeconds: 60, educationRatePerSecond: 1 },
            }),
          ],
          simulate: ({ action }) => ({ status: 'accepted', action }),
        },
      ],
      ...repositories,
    });

    expect(result.traces[0]?.memoryContextIds).toEqual(['memory-agent-1-observed-study']);
  });

  test('writes ambient observation memories for co-located bystanders when configured', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();

    const result = await runWorkerSimulationTick({
      tickId: 'tick-ambient-observation',
      simulationId,
      issuedAt: 100,
      projection: createCoLocatedStudyProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      ambientObservationMemory: {
        enabled: true,
        visibleEventTypes: CANONICAL_AMBIENT_OBSERVATION_VISIBLE_EVENT_TYPES,
      },
      agents: [
        {
          agentId: agentOne,
          observedStateSummary: 'agent-1 studies while agent-2 is nearby',
          plan: createStudyPlan(),
          signals: [],
          microPlanners: [
            createStudyPlanner({
              id: 'study-agent-1',
              description: 'agent 1 studies',
              commandType: 'AgentStudy',
              payload: { durationSeconds: 60, educationRatePerSecond: 1 },
            }),
          ],
          simulate: ({ action }) => ({ status: 'accepted', action }),
        },
      ],
      ...repositories,
    });

    expect(result.ambientObservationMemory).toMatchObject({
      observedEventCount: 1,
      recordCount: 1,
    });
    await expect(
      repositories.shortTermMemoryRepository.retrieve({
        agentId: agentTwo,
        kinds: ['observation'],
        requiredTags: ['ambient-observation', 'EducationChanged'],
        limit: 10,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'tick-ambient-observation:ambient:tick-ambient-observation-1-agent-1-command-1:event:0:agent-2',
        summary: 'Observed agent-1 study at School.',
        source: {
          commandId: 'tick-ambient-observation-1-agent-1-command-1',
          eventIds: ['tick-ambient-observation-1-agent-1-command-1:event:0'],
        },
      }),
    ]);
  });

  test('seeds social follow-up intentions from ambient conversation observations', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();

    const result = await runWorkerSimulationTick({
      tickId: 'tick-social-observation-intention',
      simulationId,
      issuedAt: 100,
      projection: createCoLocatedConversationProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      ambientObservationMemory: {
        enabled: true,
        visibleEventTypes: CANONICAL_AMBIENT_OBSERVATION_VISIBLE_EVENT_TYPES,
      },
      agents: [
        {
          agentId: agentOne,
          observedStateSummary: 'agent-1 discusses a party while agent-2 listens nearby',
          plan: createSocialPlan(),
          signals: [],
          microPlanners: [createConversationPlanner()],
          simulate: ({ action }) => ({ status: 'accepted', action }),
        },
      ],
      ...repositories,
    });

    expect(result.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'SimulationTimeAdvanced',
        'ConversationRecorded',
        'SocialInteractionCompleted',
      ]),
    );
    expect(result.ambientObservationMemory).toMatchObject({
      observedEventCount: 3,
      recordCount: 3,
    });
    const conversationMemories = await repositories.shortTermMemoryRepository.retrieve({
      agentId: agentTwo,
      kinds: ['observation'],
      requiredTags: ['ambient-observation', 'ConversationRecorded'],
      limit: 10,
    });
    expect(conversationMemories).toHaveLength(1);
    const conversationMemory = conversationMemories[0];
    if (conversationMemory === undefined) {
      throw new Error('expected conversation memory');
    }
    await expect(repositories.intentionRepository.getOrCreate(agentTwo)).resolves.toMatchObject({
      scheduledIntentions: [
        {
          id: `social-observation:agent-2:${conversationMemory.id}`,
          agentId: agentTwo,
          description:
            'Follow up on observed social event: Observed agent-1 and agent-3 discuss Valentine party at School.',
          priority: 4,
          startsAt: 100,
          endsAt: 2 * 60 * 60 * 1000 + 100,
          status: 'planned',
          affinityTags: [
            'social',
            'community',
            'relationship',
            'observation-follow-up',
            'ConversationRecorded',
            'school',
            'agent-1',
            'agent-3',
            'Valentine party',
          ],
          provenanceRecordIds: [conversationMemory.id],
          createdAt: 100,
          updatedAt: 100,
        },
      ],
    });
  });

  test('forwards injected ambient reaction evaluator before seeding social intentions', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const evaluatedMemoryIds: string[] = [];

    await runWorkerSimulationTick({
      tickId: 'tick-social-observation-ignore',
      simulationId,
      issuedAt: 100,
      projection: createCoLocatedConversationProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      ambientObservationMemory: {
        enabled: true,
        visibleEventTypes: CANONICAL_AMBIENT_OBSERVATION_VISIBLE_EVENT_TYPES,
        reactionEvaluator: ({ memory }) => {
          evaluatedMemoryIds.push(memory.id);
          return {
            kind: 'ignore',
            confidence: 0.95,
            rationale: 'The bystander is deliberately ignoring this social cue.',
          };
        },
      },
      agents: [
        {
          agentId: agentOne,
          observedStateSummary: 'agent-1 discusses a party while agent-2 listens nearby',
          plan: createSocialPlan(),
          signals: [],
          microPlanners: [createConversationPlanner()],
          simulate: ({ action }) => ({ status: 'accepted', action }),
        },
      ],
      ...repositories,
    });

    const conversationMemories = await repositories.shortTermMemoryRepository.retrieve({
      agentId: agentTwo,
      kinds: ['observation'],
      requiredTags: ['ambient-observation', 'ConversationRecorded'],
      limit: 10,
    });
    expect(conversationMemories).toHaveLength(1);
    expect(evaluatedMemoryIds).toEqual(conversationMemories.map((memory) => memory.id));
    await expect(repositories.intentionRepository.getOrCreate(agentTwo)).resolves.toMatchObject({
      scheduledIntentions: [],
    });
  });

  test('hydrates ambient reaction evaluator with profile and memory context from repositories', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const captured: CapturedAmbientReactionContext[] = [];
    const priorMemory = createShortTermMemoryRecord({
      id: 'agent-2-prior-party-help',
      agentId: agentTwo,
      kind: 'observation',
      status: 'observed',
      summary: 'agent-2 previously noticed agent-1 preparing Valentine party food.',
      occurredAt: 50,
      importanceScore: 0.8,
      source: { eventIds: [asEventId('prior-party-event')] },
      tags: ['party', 'agent-1'],
    });
    await repositories.shortTermMemoryRepository.appendMany([priorMemory]);
    await repositories.longTermProfileRepository.applyPatches(agentTwo, [
      {
        id: 'agent-2-community-value',
        agentId: agentTwo,
        section: 'values',
        key: 'community-helper',
        statement: 'Help neighbors coordinate social gatherings.',
        confidence: 0.9,
        provenanceRecordIds: [priorMemory.id],
        proposedAt: 60,
      },
    ]);

    await runWorkerSimulationTick({
      tickId: 'tick-social-observation-reaction-context',
      simulationId,
      issuedAt: 100,
      projection: createCoLocatedConversationProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      ambientObservationMemory: {
        enabled: true,
        visibleEventTypes: CANONICAL_AMBIENT_OBSERVATION_VISIBLE_EVENT_TYPES,
        reactionEvaluator: (input) => {
          captured.push({
            agentId: input.agentId,
            longTermProfile: input.longTermProfile,
            memoryContext: input.memoryContext,
            worldDecisionContext: input.worldDecisionContext,
          });
          return { kind: 'ignore', confidence: 0.95, rationale: 'captured context' };
        },
      },
      agents: [
        {
          agentId: agentOne,
          observedStateSummary: 'agent-1 discusses a party while agent-2 listens nearby',
          plan: createSocialPlan(),
          signals: [],
          microPlanners: [createConversationPlanner()],
          simulate: ({ action }) => ({ status: 'accepted', action }),
        },
      ],
      ...repositories,
    });

    expect(captured).toHaveLength(1);
    const context = captured[0];
    if (context === undefined) {
      throw new Error('expected captured ambient reaction context');
    }
    expect(context.agentId).toBe(agentTwo);
    expect(context.longTermProfile?.values.map((entry) => entry.key)).toEqual(['community-helper']);
    expect(context.memoryContext?.map((memory) => memory.id)).toContain(priorMemory.id);
    expect(context.worldDecisionContext?.agent.agentId).toBe(agentTwo);
    const rules = context.worldDecisionContext?.rules;
    if (rules === undefined) {
      throw new Error('expected ambient reaction world decision rules');
    }
    expect(rules.criticalThresholds).toEqual(policies.criticalThresholds);
    expect(
      rules.occupations.some(
        (rule) => rule.occupationName.length > 0 && rule.applicationQuota?.residentialTier === 1,
      ),
    ).toBe(true);
    expect(
      rules.production.some(
        (rule) => rule.commodity.length > 0 && Number.isFinite(rule.timeCostSeconds),
      ),
    ).toBe(true);
  });

  test('records ambient reaction evaluations to a worker trace sink', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const reactionTraces: ReactionEvaluationTrace[] = [];

    await runWorkerSimulationTick({
      tickId: 'tick-social-observation-reaction-trace',
      simulationId,
      issuedAt: 100,
      projection: createCoLocatedConversationProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      ambientObservationMemory: {
        enabled: true,
        visibleEventTypes: CANONICAL_AMBIENT_OBSERVATION_VISIBLE_EVENT_TYPES,
        reactionEvaluator: () => ({
          decision: {
            kind: 'ignore',
            confidence: 0.95,
            rationale: 'The bystander intentionally ignores this social cue.',
          },
          reactionTrace: {
            status: 'accepted',
            source: 'llm',
            requestId: 'reaction-trace-ignore',
            providerId: 'scripted-reaction',
            model: 'reaction-model',
          },
        }),
      },
      reactionEvaluationTraceSink: {
        simulationId,
        partitionKey: partition.partitionKey,
        record: (trace) => {
          reactionTraces.push(trace);
          return Promise.resolve();
        },
      },
      agents: [
        {
          agentId: agentOne,
          observedStateSummary: 'agent-1 discusses a party while agent-2 listens nearby',
          plan: createSocialPlan(),
          signals: [],
          microPlanners: [createConversationPlanner()],
          simulate: ({ action }) => ({ status: 'accepted', action }),
        },
      ],
      ...repositories,
    });

    const conversationMemories = await repositories.shortTermMemoryRepository.retrieve({
      agentId: agentTwo,
      kinds: ['observation'],
      requiredTags: ['ambient-observation', 'ConversationRecorded'],
      limit: 10,
    });
    const memoryRecordId = conversationMemories[0]?.id;
    if (memoryRecordId === undefined) {
      throw new Error('expected ambient conversation memory');
    }

    expect(reactionTraces).toEqual([
      {
        traceId: `reaction-evaluation:sim-1:world-main:agent-2:${memoryRecordId}:100`,
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        agentId: 'agent-2',
        memoryRecordId,
        decision: {
          kind: 'ignore',
          confidence: 0.95,
          rationale: 'The bystander intentionally ignores this social cue.',
        },
        reactionTrace: {
          status: 'accepted',
          source: 'llm',
          requestId: 'reaction-trace-ignore',
          providerId: 'scripted-reaction',
          model: 'reaction-model',
        },
        issuedAt: 100,
      },
    ]);
  });

  test('advances simulation time when no agents are scheduled', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const result = await runWorkerSimulationTick({
      tickId: 'tick-empty-agent-phase',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: [],
      ...repositories,
    });

    expect(result.agentResults).toEqual([]);
    expect(result.events.map((event) => [event.sequence, event.type])).toEqual([
      [1, 'SimulationTimeAdvanced'],
    ]);
    expect(result.projection.clock).toEqual({ now: 1000, tickDurationMs: 1000 });
    expect(result.streamVersion).toBe(1);
    expect(eventStore.getStreamVersion(partition.eventStreamName)).toBe(1);
  });

  test('applies sleep deprivation health decay during the worker time phase', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const result = await runWorkerSimulationTick({
      tickId: 'tick-sleep-deprivation',
      simulationId,
      issuedAt: 100,
      projection: createSleepDeprivedProjection(),
      policies: {
        ...policies,
        sleepDeprivation: {
          energyThreshold: 20,
          healthDecayPerSecond: 0.5,
          minHealth: 10,
        },
      },
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: [],
      timeDeltaMs: 60_000,
      ...repositories,
    });

    expect(result.agentResults).toEqual([]);
    expect(result.events.map((event) => [event.sequence, event.type])).toEqual([
      [1, 'SimulationTimeAdvanced'],
      [2, 'PhysiologyChanged'],
    ]);
    expect(result.projection.agents[agentOne]?.physiology).toEqual({
      energy: 10,
      satiety: 80,
      health: 60,
    });
    expect(result.streamVersion).toBe(2);
    expect(eventStore.getStreamVersion(partition.eventStreamName)).toBe(2);
  });

  test('applies stochastic illness health decay during the worker time phase', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const result = await runWorkerSimulationTick({
      tickId: 'tick-stochastic-illness',
      simulationId,
      issuedAt: 100,
      projection: createIllnessProjection(),
      policies: {
        ...policies,
        stochasticIllness: {
          policyVersion: 'stochastic-illness-test-v2',
          settlementCadenceMs: 3_600_000,
          illnessProbabilityPercentPerHour: 100,
          healthDamage: 12,
          minHealth: 10,
        },
      },
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: [],
      timeDeltaMs: 3_600_000,
      ...repositories,
    });

    expect(result.agentResults).toEqual([]);
    expect(result.events.map((event) => [event.sequence, event.type])).toEqual([
      [1, 'SimulationTimeAdvanced'],
      [2, 'PhysiologyChanged'],
    ]);
    expect(result.events[1]).toMatchObject({
      payload: {
        agentId: agentOne,
        previous: { energy: 80, satiety: 80, health: 90 },
        next: { energy: 80, satiety: 80, health: 78 },
        reason: 'stochastic-illness',
      },
    });
    expect(result.projection.agents[agentOne]?.physiology).toEqual({
      energy: 80,
      satiety: 80,
      health: 78,
    });
    expect(result.streamVersion).toBe(2);
    expect(eventStore.getStreamVersion(partition.eventStreamName)).toBe(2);
  });

  test('caps recovery by residential tier during worker action dispatch', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const result = await runWorkerSimulationTick({
      tickId: 'tick-residential-physiology-cap',
      simulationId,
      issuedAt: 100,
      projection: createTierCappedSleepProjection(),
      policies: {
        ...policies,
        sleep: { energyRecoveryPerSecond: 0.1, maxEnergy: 500 },
        residentialPhysiologyCaps: {
          caps: [
            { residentialTier: 1, maxEnergy: 80, maxSatiety: 70, maxHealth: 90 },
            { residentialTier: 2, maxEnergy: 120, maxSatiety: 90, maxHealth: 110 },
          ],
        },
      },
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: [createSleepTickAgent()],
      ...repositories,
    });

    expect(result.events.map((event) => [event.sequence, event.type])).toEqual([
      [1, 'SimulationTimeAdvanced'],
      [2, 'PhysiologyChanged'],
      [3, 'AgentActivityTimeCommitted'],
      [4, 'ShortTermMemoryRecorded'],
    ]);
    expect(result.events[1]).toMatchObject({
      payload: {
        agentId: agentOne,
        previous: { energy: 40, satiety: 70, health: 90 },
        next: { energy: 120, satiety: 70, health: 90 },
        reason: 'sleep',
      },
    });
    expect(result.projection.agents[agentOne]?.physiology.energy).toBe(120);
    expect(result.streamVersion).toBe(4);
    expect(eventStore.getStreamVersion(partition.eventStreamName)).toBe(4);
  });

  test('applies safety net subsidies during the worker time phase', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const result = await runWorkerSimulationTick({
      tickId: 'tick-safety-net',
      simulationId,
      issuedAt: 100,
      projection: createLowBalanceProjection(),
      policies: {
        ...policies,
        safetyNetSubsidy: {
          minimumBalance: 50,
          maxSubsidy: 25,
        },
      },
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: [],
      ...repositories,
    });

    expect(result.agentResults).toEqual([]);
    expect(result.events.map((event) => [event.sequence, event.type])).toEqual([
      [1, 'SimulationTimeAdvanced'],
      [2, 'SubsidyPaid'],
    ]);
    expect(result.events[1]).toMatchObject({
      payload: {
        agentId: agentOne,
        amount: 25,
        previousBalance: 10,
        nextBalance: 35,
        reason: 'safety-net',
      },
    });
    expect(result.projection.agents[agentOne]?.balance).toBe(35);
    expect(result.projection.moneySupply).toBe(125);
    expect(result.streamVersion).toBe(2);
    expect(eventStore.getStreamVersion(partition.eventStreamName)).toBe(2);
  });

  test('applies residential upkeep during the worker time phase', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const result = await runWorkerSimulationTick({
      tickId: 'tick-residential-upkeep',
      simulationId,
      issuedAt: 100,
      projection: createResidentialUpkeepProjection(),
      policies: {
        ...policies,
        residentialUpkeep: {
          costs: [{ residentialTier: 2, currencyCostPerHour: 20 }],
        },
      },
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: [],
      timeDeltaMs: 1800_000,
      ...repositories,
    });

    expect(result.agentResults).toEqual([]);
    expect(result.events.map((event) => [event.sequence, event.type])).toEqual([
      [1, 'SimulationTimeAdvanced'],
      [2, 'ResidentialUpkeepCharged'],
    ]);
    expect(result.events[1]).toMatchObject({
      payload: {
        agentId: agentOne,
        residentialTier: 2,
        amount: 10,
        unpaidAmount: 0,
        previousBalance: 100,
        nextBalance: 90,
        reason: 'residential-upkeep',
      },
    });
    expect(result.projection.agents[agentOne]?.balance).toBe(90);
    expect(result.projection.moneySupply).toBe(990);
    expect(result.streamVersion).toBe(2);
    expect(eventStore.getStreamVersion(partition.eventStreamName)).toBe(2);
  });

  test('applies centralized default survival time policies during the worker time phase', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const result = await runWorkerSimulationTick({
      tickId: 'tick-default-survival-time-policies',
      simulationId,
      issuedAt: 100,
      projection: createDefaultSurvivalTimePolicyProjection(),
      policies: createAivilizationWorldCommandPolicies(),
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: [],
      timeDeltaMs: 3_600_000,
      ...repositories,
    });

    expect(result.agentResults).toEqual([]);
    expect(
      result.events
        .filter(
          (event) =>
            event.type !== 'PhysiologyChanged' || event.payload.reason !== 'stochastic-illness',
        )
        .map((event) => [event.sequence, event.type]),
    ).toEqual([
      [1, 'SimulationTimeAdvanced'],
      [2, 'PhysiologyChanged'],
      [3, 'ResidentialUpkeepCharged'],
      [4, 'ResidentialUpkeepArrearsUpdated'],
      [5, 'PhysiologicalDistressChanged'],
      [6, 'SafetyNetGranted'],
      [7, 'ShortTermMemoryRecorded'],
    ]);
    expect(result.events[3]).toMatchObject({
      payload: {
        agentId: agentOne,
        previousArrears: 0,
        nextArrears: 10,
        reason: 'upkeep-arrears',
      },
    });
    expect(result.events[1]).toMatchObject({
      payload: {
        agentId: agentOne,
        previous: { energy: 10, satiety: 80, health: 90 },
        next: { energy: 10, satiety: 80, health: 72 },
        reason: 'sleep-deprivation',
      },
    });
    expect(result.projection.agents[agentOne]?.physiology.health).toBe(72);
    expect(result.projection.agents[agentOne]?.balance).toBe(0);
    expect(result.projection.agents[agentOne]?.inventory).toEqual({ Apple: 2 });
    expect(result.projection.moneySupply).toBe(990);
    expect(result.projection.physiologicalDistressByAgent[agentOne]).toEqual({
      policyVersion: 'physiological-safety-net-v1',
      distressStartedAt: 0,
      lowAxes: ['energy'],
      lastGrantedAt: 3_600_000,
    });
    expect(eventStore.getStreamVersion(partition.eventStreamName)).toBe(result.streamVersion);
  });

  test('persists deterministic production rewards during worker action dispatch', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const result = await runWorkerSimulationTick({
      tickId: 'tick-production-reward',
      simulationId,
      issuedAt: 100,
      projection: createRewardProductionProjection(),
      policies: {
        ...policies,
        production: {
          recipeOverrides: [{ output: 'Chip', rewardProbabilityPercent: 100 }],
        },
      },
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: [createRewardProductionTickAgent()],
      ...repositories,
    });

    expect(result.events.map((event) => [event.sequence, event.type])).toEqual([
      [1, 'SimulationTimeAdvanced'],
      [2, 'CommodityProduced'],
      [3, 'AgentActivityTimeCommitted'],
      [4, 'ShortTermMemoryRecorded'],
    ]);
    expect(result.events[1]).toMatchObject({
      payload: {
        agentId: agentOne,
        produced: { Chip: 1, 'Gold Apple': 1 },
        consumedInputs: { Transistor: 1, 'Circuit Board': 1 },
      },
    });
    expect(result.projection.agents[agentOne]?.inventory).toEqual({
      Chip: 1,
      'Gold Apple': 1,
    });
    expect(result.streamVersion).toBe(4);
    expect(eventStore.getStreamVersion(partition.eventStreamName)).toBe(4);
  });

  test('records a market price index after agent actions when market metrics are configured', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const baselineProjection = createMarketProjection();

    const result = await runWorkerSimulationTick({
      tickId: 'tick-market-index',
      simulationId,
      issuedAt: 100,
      projection: baselineProjection,
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: [createTradeTickAgent()],
      marketMetrics: { baselineProjection, baselineAt: 0 },
      ...repositories,
    });

    expect(result.events.map((event) => [event.sequence, event.type])).toEqual([
      [1, 'SimulationTimeAdvanced'],
      [2, 'TradeExecuted'],
      [3, 'ShortTermMemoryRecorded'],
      [4, 'MarketPriceIndexRecorded'],
      [5, 'EconomicCompositionRecorded'],
    ]);
    expect(result.projection.marketPriceIndices[0]).toMatchObject({
      baselineAt: 0,
      recordedAt: 100,
      foodCount: 1,
      nonFoodCount: 0,
    });
    expect(result.projection.marketPriceIndices[0]?.overall).toBeCloseTo(1.2345679012);
    expect(result.projection.marketPriceIndices[0]?.ratios['Apple']).toBeCloseTo(1.2345679012);
    // The same append carries the economic composition of the post-trade
    // projection: agent-1 paid 111.11… from the circulating agent account into
    // the (non-circulating) Apple pool, so moneySupply drops by the same amount.
    expect(result.projection.economicComposition).toMatchObject({
      recordedAt: 100,
      composition: {
        treasury: 0,
        bank: 0,
        externalNetInflow: 0,
      },
      enterprises: { total: 0, active: 0, insolvent: 0, bankruptTotal: 0 },
      gini: 0,
      deposits: 0,
      loansOutstanding: 0,
    });
    expect(result.projection.economicComposition?.moneySupply).toBeCloseTo(888.8888888889, 8);
    expect(result.projection.economicComposition?.composition.agents).toBeCloseTo(
      888.8888888889,
      8,
    );
    expect(result.projection.economicComposition?.composition.ammPoolCurrency).toBeCloseTo(
      1111.1111111111,
      8,
    );
    expect(result.streamVersion).toBe(5);
    expect(eventStore.getStreamVersion(partition.eventStreamName)).toBe(5);
  });

  test('records no market metric events when market metrics are not configured', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();

    const result = await runWorkerSimulationTick({
      tickId: 'tick-without-market-metrics',
      simulationId,
      issuedAt: 100,
      projection: createMarketProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: [createTradeTickAgent()],
      ...repositories,
    });

    expect(result.events.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'TradeExecuted',
      'ShortTermMemoryRecorded',
    ]);
    expect(result.projection.marketPriceIndices).toHaveLength(0);
    expect(result.projection.economicComposition).toBeUndefined();
  });

  test('records market observations after all tick events when configured', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const repository = new InMemoryMarketObservationRepository();

    const result = await runWorkerSimulationTick({
      tickId: 'tick-market-observations',
      simulationId,
      issuedAt: 100,
      projection: createMarketProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: [createTradeTickAgent()],
      marketObservations: {
        repository,
        priceBinning: { intervalMs: 1000, originAt: 0 },
      },
      ...repositories,
    });

    expect(result.marketObservationRecording).toEqual({
      tradeObservationCount: 1,
      ohlcBarCount: 1,
    });
    const trades = await repository.queryTrades({ simulationId, commodityId: 'Apple' });
    expect(trades).toMatchObject([
      {
        simulationId,
        commodityId: 'Apple',
        sourceSequence: 2,
        side: 'buy',
        observedAt: 1000,
        commodityQuantity: 10,
      },
    ]);
    expect(trades[0]?.observationId).toContain(`${simulationId}:trade:2:`);
    expect(trades[0]?.sourceEventId).toContain('tick-market-observations');
    await expect(
      repository.queryOhlcBars({ simulationId, commodityId: 'Apple' }),
    ).resolves.toMatchObject([
      {
        barId: `${simulationId}:ohlc:1000:0:Apple:1000`,
        simulationId,
        commodityId: 'Apple',
        intervalStartedAt: 1000,
        intervalEndedAt: 2000,
        tradeCount: 1,
      },
    ]);
  });

  test('saves the final projection snapshot and checkpoint when checkpointing is configured', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const checkpointStore = new InMemoryProjectionCheckpointStore();
    const snapshotStore = new FileProjectionSnapshotStore<WorldProjection>({
      rootDir: createRootDir(),
    });

    const result = await runWorkerSimulationTick({
      tickId: 'tick-1',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      checkpointing: {
        partitionKey: partition.partitionKey,
        checkpointStore,
        snapshotStore,
      },
      agents: createTickAgents(),
      ...repositories,
    });

    if (result.snapshot === undefined || result.checkpoint === undefined) {
      throw new Error('expected tick checkpointing to save a snapshot and checkpoint');
    }
    expect(result.snapshot).toMatchObject({
      simulationId,
      partitionKey: partition.partitionKey,
      sequence: result.streamVersion,
      createdAt: 100,
    });
    expect(result.checkpoint).toEqual({
      simulationId,
      partitionKey: partition.partitionKey,
      lastAppliedSequence: result.streamVersion,
      snapshot: result.snapshot,
    });
    expect(
      checkpointStore.getLatestCheckpoint({
        simulationId,
        partitionKey: partition.partitionKey,
      }),
    ).toEqual(result.checkpoint);
    expect(snapshotStore.loadSnapshot(result.snapshot)).toEqual(result.projection);
  });

  test('skips the tick checkpoint when the command router applied authority-settled events off-stream', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const checkpointStore = new InMemoryProjectionCheckpointStore();
    const snapshotStore = new FileProjectionSnapshotStore<WorldProjection>({
      rootDir: createRootDir(),
    });
    // A stand-in for the simulation command router: authority-settled events
    // are applied to the tick projection but only reach the partition stream
    // later through the materializer inbox. Checkpointing that projection
    // against the stream version would replay the delivered events onto a
    // snapshot that already contains them.
    const commandRouter: NonNullable<
      Parameters<typeof runWorkerSimulationTick>[0]['commandRouter']
    > = {
      syncPartitionState: () => undefined,
      routeCommandDrafts: (routeInput) =>
        Promise.resolve({
          ...dispatchCommandDraftsToWorldEventStream(routeInput),
          hasUnstreamedAuthorityEvents: true as const,
        }),
    };

    const result = await runWorkerSimulationTick({
      tickId: 'tick-1',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      checkpointing: {
        partitionKey: partition.partitionKey,
        checkpointStore,
        snapshotStore,
      },
      commandRouter,
      agents: createTickAgents(),
      ...repositories,
    });

    expect(result.checkpoint).toBeUndefined();
    expect(result.snapshot).toBeUndefined();
    expect(
      checkpointStore.getLatestCheckpoint({
        simulationId,
        partitionKey: partition.partitionKey,
      }),
    ).toBeUndefined();
  });

  test('materializes each authority result before the next Agent and saves a stream-consistent checkpoint', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const checkpointStore = new InMemoryProjectionCheckpointStore();
    const snapshotStore = new FileProjectionSnapshotStore<WorldProjection>({
      rootDir: createRootDir(),
    });
    const commandRouter: NonNullable<
      Parameters<typeof runWorkerSimulationTick>[0]['commandRouter']
    > = {
      syncPartitionState: () => undefined,
      routeCommandDrafts: (routeInput) =>
        Promise.resolve({
          ...dispatchCommandDraftsToWorldEventStream(routeInput),
          hasUnstreamedAuthorityEvents: true as const,
        }),
    };
    const materializedAgentBalances: number[] = [];

    const result = await runWorkerSimulationTick({
      tickId: 'tick-authority-materialization-boundary',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      checkpointing: {
        partitionKey: partition.partitionKey,
        checkpointStore,
        snapshotStore,
      },
      commandRouter,
      materializeAuthorityEvents: ({ projection }) => {
        materializedAgentBalances.push(
          Object.values(projection.agents).reduce((total, agent) => total + agent.balance, 0),
        );
        return Promise.resolve({ projection });
      },
      agents: createTickAgents(),
      ...repositories,
    });

    expect(materializedAgentBalances).toHaveLength(2);
    if (result.snapshot === undefined) {
      throw new Error('expected authority-materialized tick to save a snapshot');
    }
    expect(result.checkpoint?.lastAppliedSequence).toBe(result.streamVersion);
    expect(snapshotStore.loadSnapshot(result.snapshot)).toEqual(result.projection);
  });

  test('does not checkpoint when interrupted recovery defers an authority inbox append', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const checkpointStore = new InMemoryProjectionCheckpointStore();
    const snapshotStore = new FileProjectionSnapshotStore<WorldProjection>({
      rootDir: createRootDir(),
    });
    const commandRouter: NonNullable<
      Parameters<typeof runWorkerSimulationTick>[0]['commandRouter']
    > = {
      syncPartitionState: () => undefined,
      routeCommandDrafts: (routeInput) =>
        Promise.resolve({
          ...dispatchCommandDraftsToWorldEventStream(routeInput),
          hasUnstreamedAuthorityEvents: true as const,
        }),
    };

    const result = await runWorkerSimulationTick({
      tickId: 'tick-interrupted-authority-recovery',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      checkpointing: {
        partitionKey: partition.partitionKey,
        checkpointStore,
        snapshotStore,
      },
      commandRouter,
      materializeAuthorityEvents: ({ projection }) =>
        Promise.resolve({ projection, authorityEventsMaterialized: false }),
      agents: createTickAgents(),
      ...repositories,
    });

    expect(result.checkpoint).toBeUndefined();
    expect(result.snapshot).toBeUndefined();
    expect(
      checkpointStore.getLatestCheckpoint({
        simulationId,
        partitionKey: partition.partitionKey,
      }),
    ).toBeUndefined();
  });

  test('replays a whole tick idempotently from the same starting expected version', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const input = {
      tickId: 'tick-1',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: createTickAgents(),
      ...repositories,
    } satisfies Parameters<typeof runWorkerSimulationTick>[0];

    await runWorkerSimulationTick(input);
    const replay = await runWorkerSimulationTick(input);

    expect(
      replay.agentResults.map((result) => result.dispatchResult?.appendResult.idempotentReplay),
    ).toEqual([true, true]);
    expect(eventStore.readStream(partition.eventStreamName).map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'EducationChanged',
      'AgentActivityTimeCommitted',
      'ShortTermMemoryRecorded',
      'EducationChanged',
      'AgentActivityTimeCommitted',
      'ShortTermMemoryRecorded',
    ]);
    await expect(
      repositories.shortTermMemoryRepository.retrieve({
        agentId: agentOne,
        statuses: ['succeeded'],
        requiredTags: ['study'],
        limit: 10,
      }),
    ).resolves.toHaveLength(1);
    await expect(
      repositories.shortTermMemoryRepository.retrieve({
        agentId: agentTwo,
        statuses: ['succeeded'],
        requiredTags: ['study'],
        limit: 10,
      }),
    ).resolves.toHaveLength(1);
  });

  test('recovers persisted tick append stages without recomputing them from a changed retry request', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const baselineProjection = createMarketProjection();
    const input = {
      tickId: 'tick-interrupted-recovery',
      simulationId,
      issuedAt: 100,
      projection: baselineProjection,
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: [createTradeTickAgent()],
      marketMetrics: { baselineProjection, baselineAt: 0 },
      ...repositories,
    } satisfies Parameters<typeof runWorkerSimulationTick>[0];
    const first = await runWorkerSimulationTick(input);

    const recovered = await runWorkerSimulationTick({
      ...input,
      issuedAt: 9_999,
      replayExistingAgentAppends: true,
    });

    expect(recovered.events).toEqual(first.events);
    expect(recovered.streamVersion).toBe(first.streamVersion);
    expect(eventStore.getStreamVersion(partition.eventStreamName)).toBe(first.streamVersion);
  });

  test('hydrates the starting projection from the event stream when no explicit projection is provided', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    await runWorkerSimulationTick({
      tickId: 'tick-1',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: createTickAgents(),
      ...repositories,
    });

    const result = await runWorkerSimulationTick({
      tickId: 'tick-2',
      simulationId,
      issuedAt: 200,
      projectionHydration: { initialProjection: createProjection() },
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      agents: createTickAgents(),
      ...repositories,
    });

    expect(result.events.map((event) => [event.sequence, event.type])).toEqual([
      [8, 'SimulationTimeAdvanced'],
    ]);
    expect(result.events[0]).toMatchObject({
      payload: {
        previous: { now: 1000, tickDurationMs: 1000 },
        next: { now: 2000, tickDurationMs: 1000 },
        deltaMs: 1000,
      },
    });
    expect(result.projection.clock).toEqual({ now: 2000, tickDurationMs: 1000 });
    expect(result.projection.agents['agent-1']?.educationScore).toBe(70);
    expect(result.projection.agents['agent-2']?.educationScore).toBe(50);
    expect(result.skippedBusyAgentIds).toEqual([agentOne, agentTwo]);
    expect(result.streamVersion).toBe(8);
    expect(eventStore.getStreamVersion(partition.eventStreamName)).toBe(8);
  });

  test('hydrates the starting projection from a checkpoint snapshot when available', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const checkpointStore = new InMemoryProjectionCheckpointStore();
    const snapshotStore = new FileProjectionSnapshotStore<WorldProjection>({
      rootDir: createRootDir(),
    });
    const firstResult = await runWorkerSimulationTick({
      tickId: 'tick-1',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      checkpointing: {
        partitionKey: partition.partitionKey,
        checkpointStore,
        snapshotStore,
      },
      agents: createTickAgents(),
      ...repositories,
    });

    expect(firstResult.checkpoint).toEqual(
      checkpointStore.getLatestCheckpoint({
        simulationId,
        partitionKey: partition.partitionKey,
      }),
    );

    const result = await runWorkerSimulationTick({
      tickId: 'tick-2',
      simulationId,
      issuedAt: 200,
      projectionHydration: {
        initialProjection: createProjection(),
        checkpoint: {
          partitionKey: partition.partitionKey,
          checkpointStore,
          snapshotStore,
        },
      },
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      agents: createTickAgents(),
      ...repositories,
    });

    expect(result.events.map((event) => [event.sequence, event.type])).toEqual([
      [8, 'SimulationTimeAdvanced'],
    ]);
    expect(result.events[0]).toMatchObject({
      payload: {
        previous: { now: 1000, tickDurationMs: 1000 },
        next: { now: 2000, tickDurationMs: 1000 },
        deltaMs: 1000,
      },
    });
    expect(result.projection.clock).toEqual({ now: 2000, tickDurationMs: 1000 });
    expect(result.projection.agents['agent-1']?.educationScore).toBe(70);
    expect(result.projection.agents['agent-2']?.educationScore).toBe(50);
    expect(result.skippedBusyAgentIds).toEqual([agentOne, agentTwo]);
    expect(result.streamVersion).toBe(8);
  });

  test('continues later agents when an earlier agent requires replanning', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const agents = createTickAgents();
    const firstAgent = agents[0];
    const secondAgent = agents[1];
    if (firstAgent === undefined || secondAgent === undefined) {
      throw new Error('expected two tick agents');
    }
    const result = await runWorkerSimulationTick({
      tickId: 'tick-replan',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: [
        {
          ...firstAgent,
          simulate: ({ action }) => ({ status: 'rejected', action, reason: 'energy too low' }),
        },
        secondAgent,
      ],
      ...repositories,
    });

    expect(result.agentResults[0]?.dispatchResult).toBeUndefined();
    expect(result.agentResults[0]?.cycleResult.needsReplan).toBe(true);
    expect(result.events.map((event) => [event.sequence, event.type])).toEqual([
      [1, 'SimulationTimeAdvanced'],
      [2, 'EducationChanged'],
      [3, 'AgentActivityTimeCommitted'],
      [4, 'ShortTermMemoryRecorded'],
    ]);
    expect(result.projection.clock).toEqual({ now: 1000, tickDurationMs: 1000 });
    expect(result.projection.agents['agent-1']?.educationScore).toBe(10);
    expect(result.projection.agents['agent-2']?.educationScore).toBe(50);
    expect(result.streamVersion).toBe(4);
    expect(result.traces.map((trace) => trace.simulatorResult.status)).toEqual([
      'rejected',
      'accepted',
    ]);
  });

  test('materializes replacement plans during repository-backed full replanning ticks', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const planRepository = new InMemoryBranchPlanRepository();
    const planProgressRepository = new InMemoryBranchPlanProgressRepository();
    const objective = {
      id: 'study-plan',
      agentId: agentOne,
      statement: 'study safely',
      priority: 8,
      source: 'agent' as const,
      affinityTags: ['study', 'energy'],
      createdAt: 50,
      updatedAt: 50,
    };
    const replacementPlan = createBranchPlan({
      objective: objective.statement,
      branches: [
        {
          id: 'recovery',
          objective: 'recover before studying',
          subtasks: [{ id: 'sleep-first', description: 'sleep before studying', basePriority: 9 }],
        },
      ],
    });
    await repositories.intentionRepository.setObjective(agentOne, objective);
    await planRepository.save({
      planId: objective.id,
      agentId: agentOne,
      plan: createStudyPlan(),
      createdAt: 50,
      updatedAt: 50,
    });
    await planProgressRepository.getOrCreate({
      planId: objective.id,
      agentId: agentOne,
      createdAt: 50,
    });
    await repositories.shortTermMemoryRepository.appendMany([
      createStudyFailureMemory({
        id: 'study-energy-failure-1',
        agentId: agentOne,
        occurredAt: 80,
      }),
      createStudyFailureMemory({
        id: 'study-energy-failure-2',
        agentId: agentOne,
        occurredAt: 90,
      }),
    ]);

    const result = await runWorkerSimulationTick({
      tickId: 'tick-materialize-replan',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      planRepository,
      planProgressRepository,
      materializeFullReplan: {
        strategicPlanCompiler: ({ objective: compilerObjective, issuedAt }) => {
          expect(compilerObjective).toEqual(objective);
          expect(issuedAt).toBe(100);
          return replacementPlan;
        },
      },
      agents: [
        {
          agentId: agentOne,
          observedStateSummary: 'agent-1 energy=0',
          planId: objective.id,
          signals: [],
          memoryRetrievalLimit: 10,
          microPlanners: [
            createStudyPlanner({
              id: 'study-agent-1',
              description: 'agent 1 studies',
              commandType: 'AgentStudy',
              payload: { durationSeconds: 60, educationRatePerSecond: 1 },
            }),
          ],
          simulate: ({ action }) => ({ status: 'rejected', action, reason: 'energy too low' }),
        },
      ],
      ...repositories,
    });

    expect(result.agentResults[0]?.replanMaterialization).toMatchObject({
      status: 'replanned',
      planId: objective.id,
      agentId: agentOne,
      progressReset: true,
      trigger: 'repeated-failure',
    });
    await expect(
      planRepository.require({ planId: objective.id, agentId: agentOne }),
    ).resolves.toMatchObject({
      plan: replacementPlan,
      createdAt: 50,
      updatedAt: 100,
    });
    await expect(
      planProgressRepository.get({ planId: objective.id, agentId: agentOne }),
    ).resolves.toEqual({
      planId: objective.id,
      agentId: agentOne,
      completedSubtaskIds: [],
      blockedSubtasks: [],
      updatedAt: 100,
    });
  });

  test('passes agent replanning policies into cycle decisions', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();

    const result = await runWorkerSimulationTick({
      tickId: 'tick-agent-replanning-policy',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: [
        {
          agentId: agentOne,
          observedStateSummary: 'agent-1 needs replanning policy drill',
          plan: createStudyPlan(),
          signals: [],
          replanningPolicy: {
            consecutiveFailureThreshold: 2,
            majorContextShift: {
              key: 'policy-drill',
              reason: 'policy drill requires a replacement plan',
            },
          },
          microPlanners: [
            createStudyPlanner({
              id: 'study-agent-1',
              description: 'agent 1 studies',
              commandType: 'AgentStudy',
              payload: { durationSeconds: 60, educationRatePerSecond: 1 },
            }),
          ],
          simulate: ({ action }) => ({ status: 'accepted', action }),
        },
      ],
      ...repositories,
    });

    expect(result.agentResults[0]?.cycleResult.replanningDecision).toMatchObject({
      kind: 'full-replan',
      trigger: 'major-context-shift',
      reason: 'policy drill requires a replacement plan',
    });
  });

  test('loads per-agent branch plans through a shared repository', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const planRepository = new InMemoryBranchPlanRepository();
    await planRepository.save({
      planId: 'study-plan',
      agentId: agentOne,
      plan: createStudyPlan(),
      createdAt: 50,
      updatedAt: 50,
    });
    await planRepository.save({
      planId: 'study-plan',
      agentId: agentTwo,
      plan: createStudyPlan(),
      createdAt: 50,
      updatedAt: 50,
    });

    const result = await runWorkerSimulationTick({
      tickId: 'tick-plan-repository',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      planRepository,
      agents: [
        {
          agentId: agentOne,
          observedStateSummary: 'agent-1 education=10',
          planId: 'study-plan',
          signals: [],
          microPlanners: [
            createStudyPlanner({
              id: 'study-agent-1',
              description: 'agent 1 studies',
              commandType: 'AgentStudy',
              payload: { durationSeconds: 60, educationRatePerSecond: 1 },
            }),
          ],
          simulate: ({ action }) => ({ status: 'accepted', action }),
        },
        {
          agentId: agentTwo,
          observedStateSummary: 'agent-2 education=20',
          planId: 'study-plan',
          signals: [],
          microPlanners: [
            createStudyPlanner({
              id: 'study-agent-2',
              description: 'agent 2 studies',
              commandType: 'AgentStudy',
              payload: { durationSeconds: 30, educationRatePerSecond: 1 },
            }),
          ],
          simulate: ({ action }) => ({ status: 'accepted', action }),
        },
      ],
      ...repositories,
    });

    expect(result.events.map((event) => [event.sequence, event.type])).toEqual([
      [1, 'SimulationTimeAdvanced'],
      [2, 'EducationChanged'],
      [3, 'AgentActivityTimeCommitted'],
      [4, 'ShortTermMemoryRecorded'],
      [5, 'EducationChanged'],
      [6, 'AgentActivityTimeCommitted'],
      [7, 'ShortTermMemoryRecorded'],
    ]);
    expect(
      result.agentResults.map((agentResult) => agentResult.cycleResult.selectedSubtask),
    ).toEqual([
      {
        branchId: 'development',
        subtaskId: 'study',
        description: 'self study',
        score: 5,
      },
      {
        branchId: 'development',
        subtaskId: 'study',
        description: 'self study',
        score: 5,
      },
    ]);
    expect(result.projection.agents['agent-1']?.educationScore).toBe(70);
    expect(result.projection.agents['agent-2']?.educationScore).toBe(50);
  });

  test('saves plan progress for durable branch plans during a tick', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const planRepository = new InMemoryBranchPlanRepository();
    const planProgressRepository = new InMemoryBranchPlanProgressRepository();
    await planRepository.save({
      planId: 'study-plan',
      agentId: agentOne,
      plan: createStudyPlan(),
      createdAt: 50,
      updatedAt: 50,
    });

    await runWorkerSimulationTick({
      tickId: 'tick-plan-progress',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      planRepository,
      planProgressRepository,
      agents: [
        {
          agentId: agentOne,
          observedStateSummary: 'agent-1 education=10',
          planId: 'study-plan',
          signals: [],
          microPlanners: [
            createStudyPlanner({
              id: 'study-agent-1',
              description: 'agent 1 studies',
              commandType: 'AgentStudy',
              payload: { durationSeconds: 60, educationRatePerSecond: 1 },
            }),
          ],
          simulate: ({ action }) => ({ status: 'accepted', action }),
        },
      ],
      ...repositories,
    });

    await expect(
      planProgressRepository.getOrCreate({
        planId: 'study-plan',
        agentId: agentOne,
        createdAt: 999,
      }),
    ).resolves.toEqual({
      planId: 'study-plan',
      agentId: agentOne,
      completedSubtaskIds: ['study'],
      blockedSubtasks: [],
      updatedAt: 100,
    });
  });
});
