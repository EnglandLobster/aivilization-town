import {
  createBranchPlan,
  InMemoryBranchPlanRepository,
  InMemoryBranchPlanProgressRepository,
  type AtomicActionProposal,
  type DomainMicroPlanner,
} from '@aivilization/agent-runtime';
import { createAmmPool } from '@aivilization/economy';
import { InMemoryMarketObservationRepository } from '@aivilization/observability';
import {
  createShortTermMemoryRecord,
  InMemoryAgentIntentionRepository,
  InMemoryLongTermProfileRepository,
  InMemoryShortTermMemoryRepository,
} from '@aivilization/memory';
import {
  FileProjectionSnapshotStore,
  InMemoryEventStore,
  InMemoryProjectionCheckpointStore,
  asAgentId,
  asLocationId,
  asSimulationId,
  createSimulationPartition,
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
import { createAivilizationWorldCommandPolicies, runWorkerSimulationTick } from './index';

const simulationId = asSimulationId('sim-1');
const agentOne = asAgentId('agent-1');
const agentTwo = asAgentId('agent-2');
const agentThree = asAgentId('agent-3');
const school = asLocationId('school');
const partition = createSimulationPartition({ simulationId, partitionKey: 'world-main' });
const tmpRoots: string[] = [];

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
      ...repositories,
    });

    expect(result.agentResults).toHaveLength(2);
    expect(result.events.map((event) => [event.sequence, event.type])).toEqual([
      [1, 'SimulationTimeAdvanced'],
      [2, 'EducationChanged'],
      [3, 'ShortTermMemoryRecorded'],
      [4, 'EducationChanged'],
      [5, 'ShortTermMemoryRecorded'],
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
    expect(result.streamVersion).toBe(5);
    expect(result.traces.map((trace) => trace.traceId)).toEqual([
      'tick-1:cycle:1:agent-1',
      'tick-1:cycle:2:agent-2',
    ]);
    expect(eventStore.getStreamVersion(partition.eventStreamName)).toBe(5);
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
      'ShortTermMemoryRecorded',
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
      ambientObservationMemory: { enabled: true },
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
      ambientObservationMemory: { enabled: true },
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
      [3, 'ShortTermMemoryRecorded'],
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
    expect(result.streamVersion).toBe(3);
    expect(eventStore.getStreamVersion(partition.eventStreamName)).toBe(3);
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
      [4, 'SubsidyPaid'],
    ]);
    expect(result.events[1]).toMatchObject({
      payload: {
        agentId: agentOne,
        previous: { energy: 10, satiety: 80, health: 90 },
        next: { energy: 10, satiety: 80, health: 72 },
        reason: 'sleep-deprivation',
      },
    });
    expect(result.projection.agents[agentOne]?.physiology.health).toBe(72);
    expect(result.projection.agents[agentOne]?.balance).toBe(25);
    expect(result.projection.moneySupply).toBe(1015);
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
      [3, 'ShortTermMemoryRecorded'],
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
    expect(result.streamVersion).toBe(3);
    expect(eventStore.getStreamVersion(partition.eventStreamName)).toBe(3);
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
    ]);
    expect(result.projection.marketPriceIndices[0]).toMatchObject({
      baselineAt: 0,
      recordedAt: 100,
      foodCount: 1,
      nonFoodCount: 0,
    });
    expect(result.projection.marketPriceIndices[0]?.overall).toBeCloseTo(1.2345679012);
    expect(result.projection.marketPriceIndices[0]?.ratios['Apple']).toBeCloseTo(1.2345679012);
    expect(result.streamVersion).toBe(4);
    expect(eventStore.getStreamVersion(partition.eventStreamName)).toBe(4);
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
        observedAt: 100,
        commodityQuantity: 10,
      },
    ]);
    expect(trades[0]?.observationId).toContain(`${simulationId}:trade:2:`);
    expect(trades[0]?.sourceEventId).toContain('tick-market-observations');
    await expect(
      repository.queryOhlcBars({ simulationId, commodityId: 'Apple' }),
    ).resolves.toMatchObject([
      {
        barId: `${simulationId}:ohlc:1000:0:Apple:0`,
        simulationId,
        commodityId: 'Apple',
        intervalStartedAt: 0,
        intervalEndedAt: 1000,
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
      'ShortTermMemoryRecorded',
      'EducationChanged',
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
      [6, 'SimulationTimeAdvanced'],
      [7, 'EducationChanged'],
      [8, 'ShortTermMemoryRecorded'],
      [9, 'EducationChanged'],
      [10, 'ShortTermMemoryRecorded'],
    ]);
    expect(result.events[0]).toMatchObject({
      payload: {
        previous: { now: 1000, tickDurationMs: 1000 },
        next: { now: 2000, tickDurationMs: 1000 },
        deltaMs: 1000,
      },
    });
    expect(result.projection.clock).toEqual({ now: 2000, tickDurationMs: 1000 });
    expect(result.projection.agents['agent-1']?.educationScore).toBe(130);
    expect(result.projection.agents['agent-2']?.educationScore).toBe(80);
    expect(result.streamVersion).toBe(10);
    expect(eventStore.getStreamVersion(partition.eventStreamName)).toBe(10);
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
      [6, 'SimulationTimeAdvanced'],
      [7, 'EducationChanged'],
      [8, 'ShortTermMemoryRecorded'],
      [9, 'EducationChanged'],
      [10, 'ShortTermMemoryRecorded'],
    ]);
    expect(result.events[0]).toMatchObject({
      payload: {
        previous: { now: 1000, tickDurationMs: 1000 },
        next: { now: 2000, tickDurationMs: 1000 },
        deltaMs: 1000,
      },
    });
    expect(result.projection.clock).toEqual({ now: 2000, tickDurationMs: 1000 });
    expect(result.projection.agents['agent-1']?.educationScore).toBe(130);
    expect(result.projection.agents['agent-2']?.educationScore).toBe(80);
    expect(result.streamVersion).toBe(10);
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
      [3, 'ShortTermMemoryRecorded'],
    ]);
    expect(result.projection.clock).toEqual({ now: 1000, tickDurationMs: 1000 });
    expect(result.projection.agents['agent-1']?.educationScore).toBe(10);
    expect(result.projection.agents['agent-2']?.educationScore).toBe(50);
    expect(result.streamVersion).toBe(3);
    expect(result.traces.map((trace) => trace.simulatorResult.status)).toEqual([
      'rejected',
      'accepted',
    ]);
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
      [3, 'ShortTermMemoryRecorded'],
      [4, 'EducationChanged'],
      [5, 'ShortTermMemoryRecorded'],
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
