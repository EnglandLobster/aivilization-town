import {
  createBranchPlan,
  type AtomicActionProposal,
  type DomainMicroPlanner,
  type ReactiveLocalizedPlanner,
} from '@aivilization/agent-runtime';
import { createAmmPool } from '@aivilization/economy';
import { createShortTermMemoryRecord } from '@aivilization/memory';
import { asAgentId, asLocationId, createCommandEnvelope } from '@aivilization/sim-core';
import { createWorldProjection, type WorldCommandPolicies } from '@aivilization/world';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createLocalWorldRuntimeStorage, runLocalWorldRuntimeStep } from './index';
import { CANONICAL_AMBIENT_OBSERVATION_VISIBLE_EVENT_TYPES } from './ambientObservationMemory';

const agentOne = asAgentId('agent-1');
const agentTwo = asAgentId('agent-2');
const agentThree = asAgentId('agent-3');

const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 10,
  laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
  criticalThresholds: { energy: 1, health: 1 },
};

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-local-runtime-step-'));
  tmpRoots.push(root);
  return root;
}

describe('local world runtime step', () => {
  test('marks every materialization phase while replaying an interrupted tick', async () => {
    const storage = createLocalWorldRuntimeStorage({
      rootDir: createRootDir(),
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    const recoveryPhases: Array<{
      readonly phase: 'pre-tick' | 'post-authority' | 'post-tick';
      readonly recoveringInterruptedTick: boolean;
    }> = [];
    const baseInput: Omit<
      Parameters<typeof runLocalWorldRuntimeStep>[0],
      'preTickMaterialize' | 'recoveryToSequence'
    > = {
      storage,
      tickId: 'tick-recovery-materialization',
      simulationId: 'sim-1',
      issuedAt: 200,
      initialProjection: createInitialProjection(),
      policies,
      commandConsumerId: 'worker-main',
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted' as const, action }),
      agents: [],
    };

    await runLocalWorldRuntimeStep(baseInput);
    await runLocalWorldRuntimeStep({
      ...baseInput,
      recoveryToSequence: 0,
      preTickMaterialize: ({ projection, phase, recoveringInterruptedTick }) => {
        recoveryPhases.push({
          phase,
          recoveringInterruptedTick: recoveringInterruptedTick === true,
        });
        return Promise.resolve({ projection });
      },
    });

    expect(recoveryPhases).toEqual([
      { phase: 'pre-tick', recoveringInterruptedTick: true },
      { phase: 'post-tick', recoveringInterruptedTick: true },
    ]);
  });

  test('drains command inbox into world events before running the next simulation tick', async () => {
    const storage = createLocalWorldRuntimeStorage({
      rootDir: createRootDir(),
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    storage.commandStore.appendToStream({
      streamName: storage.partition.commandStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-command-1',
      commands: [
        createCommandEnvelope({
          id: 'cmd-reactive-study',
          simulationId: 'sim-1',
          actorId: agentOne,
          source: 'human',
          type: 'IssueReactiveCommand',
          payload: {
            reactiveCommandId: 'reactive-study',
            summary: 'study for one minute before the tick',
            tags: ['study'],
          },
          issuedAt: 100,
        }),
      ],
    });

    const result = await runLocalWorldRuntimeStep({
      storage,
      tickId: 'tick-1',
      simulationId: 'sim-1',
      issuedAt: 200,
      initialProjection: createInitialProjection(),
      policies,
      commandConsumerId: 'worker-main',
      commandCheckpointUpdatedAt: 200,
      localizedPlanners: [reactiveStudyPlanner()],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [
        {
          agentId: agentOne,
          observedStateSummary: 'agent-1 education=70 after command drain',
          plan: createStudyPlan(),
          signals: [],
          microPlanners: [
            studyMicroPlanner({
              id: 'study-during-tick',
              description: 'study during tick',
              commandType: 'AgentStudy',
              payload: { durationSeconds: 30, educationRatePerSecond: 1 },
            }),
          ],
          simulate: ({ action }) => ({ status: 'accepted', action }),
        },
      ],
    });

    if (result.status !== 'ticked') {
      throw new Error('expected local runtime step to tick after draining commands');
    }
    expect(result.commandDrain.status).toBe('drained');
    expect(result.commandDrain.checkpoint).toMatchObject({
      consumerId: 'worker-main',
      streamName: storage.partition.commandStreamName,
      lastConsumedSequence: 1,
      updatedAt: 200,
    });
    expect(result.tick.events.map((event) => [event.sequence, event.type])).toEqual([
      [4, 'SimulationTimeAdvanced'],
    ]);
    expect(
      storage.eventStore
        .readStream(storage.partition.eventStreamName)
        .map((event) => [event.sequence, event.type]),
    ).toEqual([
      [1, 'EducationChanged'],
      [2, 'AgentActivityTimeCommitted'],
      [3, 'ShortTermMemoryRecorded'],
      [4, 'SimulationTimeAdvanced'],
    ]);
    expect(result.tick.skippedBusyAgentIds).toEqual([agentOne]);
    expect(result.projection.agents['agent-1']?.educationScore).toBe(70);
    expect(result.tick.checkpoint).toMatchObject({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
      lastAppliedSequence: 4,
    });
    expect(
      storage.checkpointStore.getLatestCheckpoint({
        simulationId: storage.partition.simulationId,
        partitionKey: storage.partition.partitionKey,
      }),
    ).toEqual(result.tick.checkpoint);
  });

  test('builds tick agents from a provider after command drain updates projection', async () => {
    const storage = createLocalWorldRuntimeStorage({
      rootDir: createRootDir(),
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    storage.commandStore.appendToStream({
      streamName: storage.partition.commandStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-command-provider',
      commands: [
        createCommandEnvelope({
          id: 'cmd-provider-study',
          simulationId: 'sim-1',
          actorId: agentOne,
          source: 'human',
          type: 'IssueReactiveCommand',
          payload: {
            reactiveCommandId: 'reactive-provider-study',
            summary: 'study before provider resolves agents',
            tags: ['study'],
          },
          issuedAt: 100,
        }),
      ],
    });
    const providerObservedEducation: number[] = [];
    const providerObservedClock: number[] = [];

    const result = await runLocalWorldRuntimeStep({
      storage,
      tickId: 'tick-provider',
      simulationId: 'sim-1',
      issuedAt: 200,
      initialProjection: createInitialProjection(),
      policies,
      commandConsumerId: 'worker-main',
      localizedPlanners: [reactiveStudyPlanner()],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      agentProvider: ({ projection }) => {
        providerObservedEducation.push(projection.agents['agent-1']?.educationScore ?? -1);
        providerObservedClock.push(projection.clock.now);
        return [
          {
            agentId: agentOne,
            observedStateSummary: 'provider-built study agent',
            plan: createStudyPlan(),
            signals: [],
            microPlanners: [
              studyMicroPlanner({
                id: 'study-from-provider',
                description: 'study from provider',
                commandType: 'AgentStudy',
                payload: { durationSeconds: 30, educationRatePerSecond: 1 },
              }),
            ],
            simulate: ({ action }) => ({ status: 'accepted', action }),
          },
        ];
      },
    });

    expect(providerObservedEducation).toEqual([70]);
    expect(providerObservedClock).toEqual([1_000]);
    if (result.status !== 'ticked') {
      throw new Error('expected ticked result');
    }
    expect(result.tick.skippedBusyAgentIds).toEqual([agentOne]);
    expect(result.projection.agents['agent-1']?.educationScore).toBe(70);
  });

  test('materializes full replans through local runtime steps', async () => {
    const storage = createLocalWorldRuntimeStorage({
      rootDir: createRootDir(),
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    const objective = createStudyObjective();
    const replacementPlan = createRecoveryPlan();
    await storage.intentionRepository.setObjective(agentOne, objective);
    await storage.planRepository.save({
      planId: objective.id,
      agentId: agentOne,
      plan: createStudyPlan(),
      createdAt: 100,
      updatedAt: 100,
    });
    await storage.planProgressRepository.getOrCreate({
      planId: objective.id,
      agentId: agentOne,
      createdAt: 100,
    });
    await storage.shortTermMemoryRepository.appendMany([
      createStudyFailureMemory('runtime-study-failure-1', 140),
      createStudyFailureMemory('runtime-study-failure-2', 150),
    ]);

    const result = await runLocalWorldRuntimeStep({
      storage,
      tickId: 'tick-runtime-full-replan',
      simulationId: 'sim-1',
      issuedAt: 200,
      initialProjection: createInitialProjection(),
      policies,
      commandConsumerId: 'worker-main',
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      strategicPlanCompiler: ({ objective: compilerObjective, issuedAt }) => {
        expect(compilerObjective).toEqual(objective);
        expect(issuedAt).toBe(200);
        return replacementPlan;
      },
      agents: [
        {
          agentId: agentOne,
          observedStateSummary: 'agent-1 energy=0 study failure',
          planId: objective.id,
          signals: [],
          memoryRetrievalLimit: 10,
          microPlanners: [
            studyMicroPlanner({
              id: 'runtime-study-failure',
              description: 'study during runtime failure',
              commandType: 'AgentStudy',
              payload: { durationSeconds: 30, educationRatePerSecond: 1 },
            }),
          ],
          simulate: ({ action }) => ({ status: 'rejected', action, reason: 'energy too low' }),
        },
      ],
    });

    if (result.status !== 'ticked') {
      throw new Error('expected runtime step to tick');
    }
    expect(result.tick.agentResults[0]?.replanMaterialization).toMatchObject({
      status: 'replanned',
      planId: objective.id,
      agentId: agentOne,
      progressReset: true,
      trigger: 'repeated-failure',
    });
    await expect(
      storage.planRepository.require({ planId: objective.id, agentId: agentOne }),
    ).resolves.toMatchObject({ plan: replacementPlan, createdAt: 100, updatedAt: 200 });
    await expect(
      storage.planProgressRepository.get({ planId: objective.id, agentId: agentOne }),
    ).resolves.toEqual({
      planId: objective.id,
      agentId: agentOne,
      completedSubtaskIds: [],
      blockedSubtasks: [],
      updatedAt: 200,
    });
  });

  test('records market observations through local storage during a runtime step', async () => {
    const rootDir = createRootDir();
    const storage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });

    const result = await runLocalWorldRuntimeStep({
      storage,
      tickId: 'tick-market-observations',
      simulationId: 'sim-1',
      issuedAt: 200,
      initialProjection: createInitialMarketProjection(),
      policies,
      commandConsumerId: 'worker-main',
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [
        {
          agentId: agentOne,
          observedStateSummary: 'agent-1 needs food from the Apple market',
          plan: createTradePlan(),
          signals: [],
          microPlanners: [
            tradeMicroPlanner({
              id: 'buy-apple',
              description: 'buy Apple from AMM',
              commandType: 'AgentTrade',
              payload: { side: 'buy', commodityName: 'Apple', quantity: 10 },
            }),
          ],
          simulate: ({ action }) => ({ status: 'accepted', action }),
        },
      ],
      marketObservations: { priceBinning: { intervalMs: 1000, originAt: 0 } },
    });

    if (result.status !== 'ticked') {
      throw new Error('expected ticked result');
    }
    expect(result.tick.marketObservationRecording).toEqual({
      tradeObservationCount: 1,
      ohlcBarCount: 1,
    });
    await expect(
      storage.marketObservationRepository.queryTrades({
        simulationId: 'sim-1',
        commodityId: 'Apple',
      }),
    ).resolves.toMatchObject([
      {
        simulationId: 'sim-1',
        commodityId: 'Apple',
        sourceSequence: 2,
        side: 'buy',
        observedAt: 1000,
      },
    ]);

    const restarted = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    await expect(
      restarted.marketObservationRepository.queryOhlcBars({
        simulationId: 'sim-1',
        commodityId: 'Apple',
      }),
    ).resolves.toMatchObject([
      {
        simulationId: 'sim-1',
        commodityId: 'Apple',
        intervalStartedAt: 1000,
        intervalEndedAt: 2000,
        tradeCount: 1,
      },
    ]);
  });

  test('enables ambient observation memory by default and allows explicit disabling', async () => {
    const enabledStorage = createLocalWorldRuntimeStorage({
      rootDir: createRootDir(),
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });

    const enabled = await runLocalWorldRuntimeStep({
      storage: enabledStorage,
      tickId: 'tick-ambient-enabled',
      simulationId: 'sim-1',
      issuedAt: 200,
      initialProjection: createCoLocatedProjection(),
      policies,
      commandConsumerId: 'worker-main',
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [createStudyTickAgent()],
    });

    if (enabled.status !== 'ticked') {
      throw new Error('expected enabled runtime step to tick');
    }
    expect(enabled.tick.ambientObservationMemory).toMatchObject({
      observedEventCount: 1,
      recordCount: 1,
    });
    await expect(
      enabledStorage.shortTermMemoryRepository.retrieve({
        agentId: asAgentId('agent-2'),
        kinds: ['observation'],
        requiredTags: ['ambient-observation', 'EducationChanged'],
        limit: 10,
      }),
    ).resolves.toHaveLength(1);

    const disabledStorage = createLocalWorldRuntimeStorage({
      rootDir: createRootDir(),
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    const disabled = await runLocalWorldRuntimeStep({
      storage: disabledStorage,
      tickId: 'tick-ambient-disabled',
      simulationId: 'sim-1',
      issuedAt: 200,
      initialProjection: createCoLocatedProjection(),
      policies,
      commandConsumerId: 'worker-main',
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      ambientObservationMemory: { enabled: false },
      agents: [createStudyTickAgent()],
    });

    if (disabled.status !== 'ticked') {
      throw new Error('expected disabled runtime step to tick');
    }
    expect(disabled.tick.ambientObservationMemory).toBeUndefined();
    await expect(
      disabledStorage.shortTermMemoryRepository.retrieve({
        agentId: asAgentId('agent-2'),
        kinds: ['observation'],
        requiredTags: ['ambient-observation', 'EducationChanged'],
        limit: 10,
      }),
    ).resolves.toEqual([]);
  });

  test('persists ambient reaction evaluation traces through local runtime storage', async () => {
    const storage = createLocalWorldRuntimeStorage({
      rootDir: createRootDir(),
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });

    const result = await runLocalWorldRuntimeStep({
      storage,
      tickId: 'tick-reaction-trace',
      simulationId: 'sim-1',
      issuedAt: 200,
      initialProjection: createCoLocatedConversationProjection(),
      policies,
      commandConsumerId: 'worker-main',
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      ambientObservationMemory: {
        enabled: true,
        visibleEventTypes: CANONICAL_AMBIENT_OBSERVATION_VISIBLE_EVENT_TYPES,
        reactionEvaluator: () => ({
          decision: {
            kind: 'ignore',
            confidence: 0.93,
            rationale: 'The bystander notices but chooses not to follow up.',
          },
          reactionTrace: {
            status: 'accepted',
            source: 'llm',
            requestId: 'local-runtime-reaction-ignore',
            providerId: 'scripted-reaction',
            model: 'reaction-model',
          },
        }),
      },
      agents: [createConversationTickAgent()],
    });

    if (result.status !== 'ticked') {
      throw new Error('expected reaction trace runtime step to tick');
    }
    await expect(
      storage.reactionEvaluationTraceRepository.query({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        agentId: agentThree,
        decisionKind: 'ignore',
        limit: 1,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        agentId: 'agent-3',
        decision: {
          kind: 'ignore',
          confidence: 0.93,
          rationale: 'The bystander notices but chooses not to follow up.',
        },
        reactionTrace: {
          status: 'accepted',
          source: 'llm',
          requestId: 'local-runtime-reaction-ignore',
          providerId: 'scripted-reaction',
          model: 'reaction-model',
        },
        issuedAt: 200,
      }),
    ]);
  });
});

function createInitialProjection() {
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
    ],
  });
}

function createInitialMarketProjection() {
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

function createCoLocatedProjection() {
  return createWorldProjection({
    locations: [
      {
        locationId: asLocationId('school'),
        name: 'School',
        kind: 'education',
        activityAffinities: ['study', 'socialize'],
        capacity: null,
      },
    ],
    agents: [
      {
        agentId: agentOne,
        locationId: asLocationId('school'),
        physiology: { energy: 50, satiety: 80, health: 100 },
        educationScore: 10,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
      {
        agentId: asAgentId('agent-2'),
        locationId: asLocationId('school'),
        physiology: { energy: 50, satiety: 80, health: 100 },
        educationScore: 10,
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
        locationId: asLocationId('school'),
        name: 'School',
        kind: 'education',
        activityAffinities: ['study', 'socialize'],
        capacity: null,
      },
    ],
    agents: [
      {
        agentId: agentOne,
        locationId: asLocationId('school'),
        physiology: { energy: 50, satiety: 80, health: 100 },
        educationScore: 10,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
      {
        agentId: agentTwo,
        locationId: asLocationId('school'),
        physiology: { energy: 50, satiety: 80, health: 100 },
        educationScore: 10,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
      {
        agentId: agentThree,
        locationId: asLocationId('school'),
        physiology: { energy: 50, satiety: 80, health: 100 },
        educationScore: 10,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
    ],
  });
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

function createTradePlan() {
  return createBranchPlan({
    objective: 'buy food from the market',
    branches: [
      {
        id: 'market',
        objective: 'buy Apple',
        subtasks: [{ id: 'buy-apple', description: 'buy Apple', basePriority: 5 }],
      },
    ],
  });
}

function createRecoveryPlan() {
  return createBranchPlan({
    objective: 'recover before studying',
    branches: [
      {
        id: 'recovery',
        objective: 'restore enough energy to study',
        subtasks: [{ id: 'sleep-first', description: 'sleep before studying', basePriority: 9 }],
      },
    ],
  });
}

function createStudyObjective() {
  return {
    id: 'objective-study',
    agentId: agentOne,
    statement: 'Improve education without exhausting energy.',
    priority: 8,
    source: 'agent' as const,
    affinityTags: ['study', 'energy'],
    createdAt: 100,
    updatedAt: 100,
  };
}

function createStudyFailureMemory(id: string, occurredAt: number) {
  return createShortTermMemoryRecord({
    id,
    agentId: agentOne,
    kind: 'action',
    status: 'failed',
    summary: 'Failed to study because energy was too low.',
    occurredAt,
    importanceScore: 0.9,
    source: { eventIds: [] },
    tags: ['study', 'energy'],
  });
}

function createConversationPlan() {
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

function createStudyTickAgent() {
  return {
    agentId: agentOne,
    observedStateSummary: 'agent-1 studies while agent-2 is nearby',
    plan: createStudyPlan(),
    signals: [],
    microPlanners: [
      studyMicroPlanner({
        id: 'study-with-bystander',
        description: 'study with bystander nearby',
        commandType: 'AgentStudy',
        payload: { durationSeconds: 30, educationRatePerSecond: 1 },
      }),
    ],
    simulate: ({ action }) => ({ status: 'accepted' as const, action }),
  } satisfies Parameters<typeof runLocalWorldRuntimeStep>[0]['agents'][number];
}

function createConversationTickAgent() {
  return {
    agentId: agentOne,
    observedStateSummary: 'agent-1 discusses a party while agent-3 listens nearby',
    plan: createConversationPlan(),
    signals: [],
    microPlanners: [
      {
        domain: 'social',
        supports: ({ subtaskId }) => subtaskId === 'socialize',
        propose: () => [
          {
            id: 'conversation-party',
            description: 'Discuss Valentine party with agent-2.',
            commandType: 'AgentStartConversation',
            payload: {
              targetAgentId: agentTwo,
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
                  speakerAgentId: agentTwo,
                  utterance: 'Yes, let us invite more neighbors.',
                  intent: 'accept-party-planning',
                },
              ],
            },
          },
        ],
      },
    ],
    simulate: ({ action }) => ({ status: 'accepted' as const, action }),
  } satisfies Parameters<typeof runLocalWorldRuntimeStep>[0]['agents'][number];
}

function reactiveStudyPlanner(): ReactiveLocalizedPlanner {
  return {
    domain: 'study',
    supports: ({ summary }) => summary.includes('study'),
    propose: () => [
      {
        id: 'study-before-tick',
        description: 'study before tick',
        commandType: 'AgentStudy',
        payload: { durationSeconds: 60, educationRatePerSecond: 1 },
      },
    ],
  };
}

function studyMicroPlanner(action: AtomicActionProposal): DomainMicroPlanner {
  return {
    domain: 'study',
    supports: ({ subtaskId }) => subtaskId === 'study',
    propose: () => [action],
  };
}

function tradeMicroPlanner(action: AtomicActionProposal): DomainMicroPlanner {
  return {
    domain: 'trade',
    supports: ({ subtaskId }) => subtaskId === 'buy-apple',
    propose: () => [action],
  };
}
