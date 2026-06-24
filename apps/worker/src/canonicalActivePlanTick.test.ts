import {
  createBranchPlan,
  createBranchPlanProgress,
  InMemoryBranchPlanProgressRepository,
  InMemoryBranchPlanRepository,
  markSubtaskCompleted,
} from '@aivilization/agent-runtime';
import {
  InMemoryAgentIntentionRepository,
  InMemoryLongTermProfileRepository,
  InMemoryShortTermMemoryRepository,
  createShortTermMemoryRecord,
  type LongHorizonObjective,
} from '@aivilization/memory';
import {
  InMemoryEventStore,
  asAgentId,
  asLocationId,
  asSimulationId,
  createCommandEnvelope,
  createSimulationPartition,
  type AgentId,
  type LocationId,
} from '@aivilization/sim-core';
import {
  createWorldProjection,
  type WorldAgentState,
  type WorldCommandPolicies,
  type WorldEvent,
  type WorldProjection,
} from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import { handleWorkerSteeringCommand, runCanonicalWorkerActivePlanTick } from './index';

const simulationId = asSimulationId('sim-canonical-active-plan');
const agentA = asAgentId('agent-a');
const agentB = asAgentId('agent-b');
const partition = createSimulationPartition({ simulationId, partitionKey: 'world-main' });

const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: { Apple: 10 },
  maxSatiety: 100,
  wageCalculator: () => 10,
  laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
  criticalThresholds: { energy: 1, health: 1 },
  sleep: { energyRecoveryPerSecond: 1, maxEnergy: 100 },
  jobApplication: {
    populationEducationScores: [0],
    quotaByResidentialTier: [1, 1, 1, 1, 1],
  },
  residentialTierUpgrade: {
    maxResidentialTier: 5,
    costs: [
      { targetResidentialTier: 2, currencyCost: 100 },
      { targetResidentialTier: 3, currencyCost: 100 },
      { targetResidentialTier: 4, currencyCost: 100 },
      { targetResidentialTier: 5, currencyCost: 100 },
    ],
  },
};

describe('canonical active-plan worker tick', () => {
  test('runs a direct-projection tick from active durable study plans', async () => {
    const repositories = createRepositories();
    const eventStore = new InMemoryEventStore<WorldEvent>();
    await repositories.intentionRepository.setObjective(agentA, createObjective(agentA));
    await repositories.planRepository.save(createStudyPlanRecord(agentA));

    const result = await runCanonicalWorkerActivePlanTick({
      tickId: 'tick-1',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      objectiveProposer: () => undefined,
      ...repositories,
    });

    expect(result.agentResults).toHaveLength(1);
    expect(result.agentResults[0]?.cycleResult.commandDrafts[0]).toMatchObject({
      type: 'AgentStudy',
      payload: { durationSeconds: 1800, educationRatePerSecond: 1 },
    });
    expect(result.events.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'EducationChanged',
      'ShortTermMemoryRecorded',
    ]);
    expect(result.projection.clock.now).toBe(1000);
    expect(result.projection.agents[agentA]?.educationScore).toBe(1800);
  });

  test('moves to the study location before completing the active study plan', async () => {
    const repositories = createRepositories();
    const planProgressRepository = new InMemoryBranchPlanProgressRepository();
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const initialProjection = createProjection({
      agents: [
        createAgent(agentA, { locationId: asLocationId('residential-block') }),
        createAgent(agentB),
      ],
      locations: [residentialBlock(), school()],
    });
    await repositories.intentionRepository.setObjective(agentA, createObjective(agentA));
    await repositories.planRepository.save(createStudyPlanRecord(agentA));

    const first = await runCanonicalWorkerActivePlanTick({
      tickId: 'tick-study-move',
      simulationId,
      issuedAt: 100,
      projection: initialProjection,
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      planProgressRepository,
      objectiveProposer: () => undefined,
      ...repositories,
    });

    expect(first.agentResults[0]?.cycleResult.commandDrafts[0]).toMatchObject({
      type: 'AgentMoveTo',
      payload: { targetLocationId: 'school', reason: 'study' },
    });
    expect(first.events.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'AgentLocationChanged',
      'ShortTermMemoryRecorded',
    ]);
    expect(first.projection.agents[agentA]?.locationId).toBe(asLocationId('school'));
    expect(first.projection.agents[agentA]?.educationScore).toBe(0);
    await expect(
      planProgressRepository.getOrCreate({
        planId: 'objective-study',
        agentId: agentA,
        createdAt: 999,
      }),
    ).resolves.toMatchObject({
      completedSubtaskIds: [],
      blockedSubtasks: [],
      updatedAt: 100,
    });
    await expect(repositories.intentionRepository.getOrCreate(agentA)).resolves.toMatchObject({
      activeObjective: createObjective(agentA),
      completedObjectives: [],
    });

    const second = await runCanonicalWorkerActivePlanTick({
      tickId: 'tick-study-at-school',
      simulationId,
      issuedAt: 200,
      projectionHydration: { initialProjection },
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      planProgressRepository,
      objectiveProposer: () => undefined,
      ...repositories,
    });

    expect(second.agentResults[0]?.cycleResult.commandDrafts[0]).toMatchObject({
      type: 'AgentStudy',
      payload: { durationSeconds: 1800, educationRatePerSecond: 1 },
    });
    expect(second.events.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'EducationChanged',
      'ShortTermMemoryRecorded',
    ]);
    expect(second.events[0]?.sequence).toBe(first.streamVersion + 1);
    expect(second.projection.agents[agentA]?.locationId).toBe(asLocationId('school'));
    expect(second.projection.agents[agentA]?.educationScore).toBe(1800);
    await expect(
      planProgressRepository.getOrCreate({
        planId: 'objective-study',
        agentId: agentA,
        createdAt: 999,
      }),
    ).resolves.toMatchObject({
      completedSubtaskIds: ['study-step'],
      blockedSubtasks: [],
      updatedAt: 200,
    });
    const completedIntentionState = await repositories.intentionRepository.getOrCreate(agentA);
    expect(completedIntentionState.activeObjective).toBeUndefined();
    expect(completedIntentionState.completedObjectives).toMatchObject([
      {
        objective: createObjective(agentA),
        completedAt: 200,
        reason: 'plan-completed',
        planId: 'objective-study',
      },
    ]);
  });

  test('runs production subtasks through the canonical active-plan pipeline', async () => {
    const repositories = createRepositories();
    const eventStore = new InMemoryEventStore<WorldEvent>();
    await repositories.intentionRepository.setObjective(agentA, createProductionObjective(agentA));
    await repositories.planRepository.save(createProductionPlanRecord(agentA));

    const result = await runCanonicalWorkerActivePlanTick({
      tickId: 'tick-production',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      objectiveProposer: () => undefined,
      ...repositories,
    });

    expect(result.agentResults).toHaveLength(1);
    expect(result.agentResults[0]?.cycleResult.commandDrafts[0]).toMatchObject({
      type: 'AgentProduce',
      payload: { commodityName: 'Apple', quantity: 1, availableLaborSeconds: 3600 },
    });
    expect(result.events.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'CommodityProduced',
      'ShortTermMemoryRecorded',
    ]);
    expect(result.events.find((event) => event.type === 'CommodityProduced')?.payload).toEqual({
      agentId: agentA,
      produced: { Apple: 1 },
      consumedInputs: {},
      energyCost: 2,
      satietyCost: 0,
      laborSeconds: 0.1,
    });
    expect(result.projection.agents[agentA]?.inventory).toEqual({ Apple: 1 });
    expect(result.projection.agents[agentA]?.physiology).toEqual({
      energy: 48,
      satiety: 50,
      health: 100,
    });
    expect(result.traces[0]?.actionSynthesis.acceptedActions).toMatchObject([
      {
        id: 'canonical-production-produce-step',
        commandType: 'AgentProduce',
        resourceEstimate: {
          actionSeconds: 0.1,
          energyCost: 2,
          satietyCost: 0,
        },
      },
    ]);
  });

  test('runs residential upgrades through the canonical active-plan pipeline', async () => {
    const repositories = createRepositories();
    const planProgressRepository = new InMemoryBranchPlanProgressRepository();
    const eventStore = new InMemoryEventStore<WorldEvent>();
    await repositories.intentionRepository.setObjective(agentA, createResidentialObjective(agentA));
    await repositories.planRepository.save(createResidentialPlanRecord(agentA));

    const result = await runCanonicalWorkerActivePlanTick({
      tickId: 'tick-residential-upgrade',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      planProgressRepository,
      objectiveProposer: () => undefined,
      ...repositories,
    });

    expect(result.agentResults).toHaveLength(1);
    expect(result.agentResults[0]?.cycleResult.commandDrafts[0]).toMatchObject({
      type: 'AgentUpgradeResidentialTier',
      payload: { targetResidentialTier: 2 },
    });
    expect(result.events.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'ResidentialTierUpgraded',
      'ShortTermMemoryRecorded',
    ]);
    expect(
      result.events.find((event) => event.type === 'ResidentialTierUpgraded')?.payload,
    ).toEqual({
      agentId: agentA,
      previousResidentialTier: 1,
      nextResidentialTier: 2,
      currencyCost: 100,
      consumedInventory: {},
    });
    expect(result.projection.agents[agentA]).toMatchObject({
      residentialTier: 2,
      balance: 900,
    });
    await expect(
      planProgressRepository.getOrCreate({
        planId: 'objective-residential',
        agentId: agentA,
        createdAt: 999,
      }),
    ).resolves.toEqual({
      planId: 'objective-residential',
      agentId: agentA,
      completedSubtaskIds: ['residential-upgrade-step'],
      blockedSubtasks: [],
      updatedAt: 100,
    });
    const intentionState = await repositories.intentionRepository.getOrCreate(agentA);
    expect(intentionState.activeObjective).toBeUndefined();
    expect(intentionState.completedObjectives).toEqual([
      {
        objective: createResidentialObjective(agentA),
        completedAt: 100,
        reason: 'plan-completed',
        planId: 'objective-residential',
      },
    ]);
  });

  test('infers job application occupation from active plan context', async () => {
    const repositories = createRepositories();
    const planProgressRepository = new InMemoryBranchPlanProgressRepository();
    const eventStore = new InMemoryEventStore<WorldEvent>();
    await repositories.intentionRepository.setObjective(agentA, createStockClerkObjective(agentA));
    await repositories.planRepository.save(createStockClerkPlanRecord(agentA));

    const result = await runCanonicalWorkerActivePlanTick({
      tickId: 'tick-stock-clerk-application',
      simulationId,
      issuedAt: 100,
      projection: createWorldProjection({
        agents: [
          createAgent(agentA, {
            residentialTier: 2,
            educationScore: 20,
            inventory: { Beef: 1 },
          }),
        ],
      }),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      planProgressRepository,
      objectiveProposer: () => undefined,
      ...repositories,
    });

    expect(result.agentResults).toHaveLength(1);
    expect(result.agentResults[0]?.cycleResult.commandDrafts[0]).toMatchObject({
      type: 'AgentApplyJob',
      payload: { occupationName: 'Stock Clerk' },
    });
    expect(result.events.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'InventoryChanged',
      'JobApplicationSubmitted',
      'JobAssigned',
      'ShortTermMemoryRecorded',
    ]);
    expect(result.projection.agents[agentA]).toMatchObject({
      job: 'Stock Clerk',
      inventory: {},
    });
    await expect(
      planProgressRepository.getOrCreate({
        planId: 'objective-stock-clerk',
        agentId: agentA,
        createdAt: 999,
      }),
    ).resolves.toEqual({
      planId: 'objective-stock-clerk',
      agentId: agentA,
      completedSubtaskIds: ['stock-clerk-step'],
      blockedSubtasks: [],
      updatedAt: 100,
    });
  });

  test('executes production chain upstream steps across ticks before completing the active plan', async () => {
    const repositories = createRepositories();
    const planProgressRepository = new InMemoryBranchPlanProgressRepository();
    const eventStore = new InMemoryEventStore<WorldEvent>();
    await repositories.intentionRepository.setObjective(agentA, createProductionObjective(agentA));
    await repositories.planRepository.save(createProductionPlanRecord(agentA));

    const first = await runCanonicalWorkerActivePlanTick({
      tickId: 'tick-production-chain-1',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      planProgressRepository,
      domainConfig: { production: { commodityName: 'Book', quantity: 1 } },
      objectiveProposer: () => undefined,
      ...repositories,
    });

    expect(first.agentResults).toHaveLength(1);
    expect(first.agentResults[0]?.cycleResult.commandDrafts[0]).toMatchObject({
      type: 'AgentProduce',
      payload: { commodityName: 'Wood', quantity: 1, availableLaborSeconds: 3600 },
    });
    expect(first.projection.agents[agentA]?.inventory).toEqual({ Wood: 1 });
    await expect(
      planProgressRepository.getOrCreate({
        planId: 'objective-production',
        agentId: agentA,
        createdAt: 999,
      }),
    ).resolves.toEqual({
      planId: 'objective-production',
      agentId: agentA,
      completedSubtaskIds: [],
      blockedSubtasks: [],
      updatedAt: 100,
    });
    await expect(repositories.intentionRepository.getOrCreate(agentA)).resolves.toMatchObject({
      activeObjective: { id: 'objective-production' },
      completedObjectives: [],
    });

    const second = await runCanonicalWorkerActivePlanTick({
      tickId: 'tick-production-chain-2',
      simulationId,
      issuedAt: 200,
      projectionHydration: { initialProjection: createProjection() },
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      planProgressRepository,
      domainConfig: { production: { commodityName: 'Book', quantity: 1 } },
      objectiveProposer: () => undefined,
      ...repositories,
    });

    expect(second.agentResults).toHaveLength(1);
    expect(second.agentResults[0]?.cycleResult.commandDrafts[0]).toMatchObject({
      type: 'AgentProduce',
      payload: { commodityName: 'Book', quantity: 1, availableLaborSeconds: 3600 },
    });
    expect(second.projection.agents[agentA]?.inventory).toEqual({ Book: 1 });
    await expect(
      planProgressRepository.getOrCreate({
        planId: 'objective-production',
        agentId: agentA,
        createdAt: 999,
      }),
    ).resolves.toEqual({
      planId: 'objective-production',
      agentId: agentA,
      completedSubtaskIds: ['produce-step'],
      blockedSubtasks: [],
      updatedAt: 200,
    });
    const intentionState = await repositories.intentionRepository.getOrCreate(agentA);
    expect(intentionState.activeObjective).toBeUndefined();
    expect(intentionState.completedObjectives).toEqual([
      {
        objective: createProductionObjective(agentA),
        completedAt: 200,
        reason: 'plan-completed',
        planId: 'objective-production',
      },
    ]);
  });

  test('infers production chain target from active plan context across ticks', async () => {
    const repositories = createRepositories();
    const planProgressRepository = new InMemoryBranchPlanProgressRepository();
    const eventStore = new InMemoryEventStore<WorldEvent>();
    await repositories.intentionRepository.setObjective(
      agentA,
      createBookProductionObjective(agentA),
    );
    await repositories.planRepository.save(createBookProductionPlanRecord(agentA));

    const first = await runCanonicalWorkerActivePlanTick({
      tickId: 'tick-inferred-production-chain-1',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      planProgressRepository,
      objectiveProposer: () => undefined,
      ...repositories,
    });

    expect(first.agentResults).toHaveLength(1);
    expect(first.agentResults[0]?.cycleResult.commandDrafts[0]).toMatchObject({
      type: 'AgentProduce',
      payload: { commodityName: 'Wood', quantity: 1, availableLaborSeconds: 3600 },
    });
    await expect(
      planProgressRepository.getOrCreate({
        planId: 'objective-book-production',
        agentId: agentA,
        createdAt: 999,
      }),
    ).resolves.toEqual({
      planId: 'objective-book-production',
      agentId: agentA,
      completedSubtaskIds: [],
      blockedSubtasks: [],
      updatedAt: 100,
    });

    const second = await runCanonicalWorkerActivePlanTick({
      tickId: 'tick-inferred-production-chain-2',
      simulationId,
      issuedAt: 200,
      projectionHydration: { initialProjection: createProjection() },
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      planProgressRepository,
      objectiveProposer: () => undefined,
      ...repositories,
    });

    expect(second.agentResults).toHaveLength(1);
    expect(second.agentResults[0]?.cycleResult.commandDrafts[0]).toMatchObject({
      type: 'AgentProduce',
      payload: { commodityName: 'Book', quantity: 1, availableLaborSeconds: 3600 },
    });
    await expect(
      planProgressRepository.getOrCreate({
        planId: 'objective-book-production',
        agentId: agentA,
        createdAt: 999,
      }),
    ).resolves.toEqual({
      planId: 'objective-book-production',
      agentId: agentA,
      completedSubtaskIds: ['produce-book-step'],
      blockedSubtasks: [],
      updatedAt: 200,
    });
    const intentionState = await repositories.intentionRepository.getOrCreate(agentA);
    expect(intentionState.activeObjective).toBeUndefined();
    expect(intentionState.completedObjectives).toEqual([
      {
        objective: createBookProductionObjective(agentA),
        completedAt: 200,
        reason: 'plan-completed',
        planId: 'objective-book-production',
      },
    ]);
  });

  test('executes a complex strategic town objective across residential work and production ticks', async () => {
    const repositories = createRepositories();
    const planProgressRepository = new InMemoryBranchPlanProgressRepository();
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const statement =
      'Upgrade residential tier, apply for Stock Clerk work, then craft Chip for the electronics market.';
    const initialProjection = createWorldProjection({
      agents: [
        createAgent(agentA, {
          physiology: { energy: 1000, satiety: 1000, health: 100 },
          balance: 10000,
          educationScore: 100,
          inventory: { Beef: 1 },
        }),
      ],
      marketPools: [{ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }],
    });
    await handleWorkerSteeringCommand({
      command: createCommandEnvelope({
        id: 'objective-town-stack',
        simulationId,
        actorId: agentA,
        source: 'human',
        type: 'SetLongHorizonObjective',
        payload: {
          objectiveId: 'objective-town-stack',
          statement,
          priority: 3,
          affinityTags: ['residential', 'work', 'production'],
        },
        issuedAt: 50,
      }),
      localizedPlanners: [],
      simulate: ({ action }) => ({ status: 'accepted', action }),
      ...repositories,
    });
    await expect(
      repositories.planRepository.require({
        planId: 'objective-town-stack',
        agentId: agentA,
      }),
    ).resolves.toMatchObject({
      plan: {
        branches: [{ id: 'residential-readiness' }, { id: 'employment' }, { id: 'production' }],
      },
    });

    let result: Awaited<ReturnType<typeof runCanonicalWorkerActivePlanTick>> | undefined;
    for (let tickIndex = 0; tickIndex < 20; tickIndex += 1) {
      result = await runCanonicalWorkerActivePlanTick({
        tickId: `tick-town-stack-${tickIndex + 1}`,
        simulationId,
        issuedAt: 100 + tickIndex * 100,
        ...(tickIndex === 0
          ? { projection: initialProjection }
          : { projectionHydration: { initialProjection } }),
        policies,
        eventStore,
        streamName: partition.eventStreamName,
        planProgressRepository,
        objectiveProposer: () => undefined,
        ...repositories,
      });
      if (tickIndex === 0) {
        expect(result.agentResults[0]?.cycleResult.selectedSubtask).toMatchObject({
          branchId: 'residential-readiness',
          subtaskId: 'upgrade-residential-tier',
        });
        const firstSimulationResult = result.agentResults[0]?.cycleResult.simulationResults[0];
        if (firstSimulationResult?.status !== 'accepted') {
          throw new Error('expected first town-stack simulation result to be accepted');
        }
        expect(firstSimulationResult.action).toMatchObject({
          commandType: 'AgentUpgradeResidentialTier',
          payload: { targetResidentialTier: 2 },
        });
        expect(result.agentResults[0]?.cycleResult.commandDrafts).toMatchObject([
          {
            type: 'AgentUpgradeResidentialTier',
            payload: { targetResidentialTier: 2 },
          },
        ]);
        expect(
          result.events
            .filter((event) => event.type === 'ResidentialTierUpgraded')
            .map((event) => event.payload.nextResidentialTier),
        ).toEqual([2]);
        expect(result.projection.agents[agentA]?.residentialTier).toBe(2);
      }

      const intentionState = await repositories.intentionRepository.getOrCreate(agentA);
      if (intentionState.activeObjective === undefined) {
        break;
      }
    }

    if (result === undefined) {
      throw new Error('expected at least one active-plan tick');
    }
    expect(result.projection.agents[agentA]).toMatchObject({
      residentialTier: 5,
      job: 'Stock Clerk',
      inventory: { Chip: 1 },
    });
    expect(result.projection.agents[agentA]?.inventory.Beef).toBeUndefined();
    const progress = await planProgressRepository.getOrCreate({
      planId: 'objective-town-stack',
      agentId: agentA,
      createdAt: 999,
    });
    expect(progress).toMatchObject({
      planId: 'objective-town-stack',
      agentId: agentA,
      blockedSubtasks: [],
      updatedAt: 1600,
    });
    expect(progress.completedSubtaskIds).toEqual(
      expect.arrayContaining(['upgrade-residential-tier', 'apply-for-work', 'produce-target']),
    );
    expect(progress.completedSubtaskIds).toHaveLength(3);
    const intentionState = await repositories.intentionRepository.getOrCreate(agentA);
    expect(intentionState.activeObjective).toBeUndefined();
    expect(intentionState.completedObjectives).toMatchObject([
      {
        objective: {
          id: 'objective-town-stack',
          statement,
        },
        completedAt: 1600,
        reason: 'plan-completed',
        planId: 'objective-town-stack',
      },
    ]);

    const events = eventStore.readStream(partition.eventStreamName);
    expect(
      events
        .filter((event) => event.type === 'ResidentialTierUpgraded')
        .map((event) => event.payload.nextResidentialTier),
    ).toEqual([2, 3, 4, 5]);
    expect(events.some((event) => event.type === 'JobAssigned')).toBe(true);
    expect(
      events
        .filter((event) => event.type === 'CommodityProduced')
        .map((event) => event.payload.produced),
    ).toContainEqual({ Chip: 1 });
  });

  test('renews idle agents with autonomous objectives before scheduling', async () => {
    const repositories = createRepositories();
    const eventStore = new InMemoryEventStore<WorldEvent>();

    const result = await runCanonicalWorkerActivePlanTick({
      tickId: 'tick-renew-idle-agent',
      simulationId,
      issuedAt: 100,
      projection: createWorldProjection({
        agents: [createAgent(agentA)],
        marketPools: [{ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }],
      }),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      ...repositories,
    });

    expect(result.agentResults).toHaveLength(1);
    expect(result.events.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'EducationChanged',
      'ShortTermMemoryRecorded',
    ]);
    expect(result.projection.agents[agentA]?.educationScore).toBe(1800);
    await expect(repositories.intentionRepository.getOrCreate(agentA)).resolves.toMatchObject({
      activeObjective: {
        id: 'auto-objective-agent-a-100',
        statement: 'Improve education to qualify for better town opportunities.',
      },
    });
    await expect(
      repositories.planRepository.require({
        planId: 'auto-objective-agent-a-100',
        agentId: agentA,
      }),
    ).resolves.toMatchObject({
      planId: 'auto-objective-agent-a-100',
      agentId: agentA,
      plan: {
        objective: 'Improve education to qualify for better town opportunities.',
      },
    });
  });

  test('renews hungry idle agents and executes eating through the canonical active-plan pipeline', async () => {
    const repositories = createRepositories();
    const planProgressRepository = new InMemoryBranchPlanProgressRepository();
    const eventStore = new InMemoryEventStore<WorldEvent>();

    const result = await runCanonicalWorkerActivePlanTick({
      tickId: 'tick-renew-hungry-agent',
      simulationId,
      issuedAt: 100,
      projection: createWorldProjection({
        agents: [
          createAgent(agentA, {
            physiology: { energy: 90, satiety: 10, health: 100 },
            educationScore: 150,
            balance: 200,
            inventory: { Apple: 2 },
          }),
        ],
        marketPools: [{ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }],
      }),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      planProgressRepository,
      ...repositories,
    });

    expect(result.agentResults[0]?.cycleResult.selectedSubtask).toMatchObject({
      branchId: 'satiety',
      subtaskId: 'eat',
    });
    expect(result.agentResults[0]?.cycleResult.commandDrafts[0]).toMatchObject({
      type: 'AgentEat',
      payload: { commodityName: 'Apple', quantity: 1 },
    });
    expect(result.events.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'InventoryChanged',
      'PhysiologyChanged',
      'ShortTermMemoryRecorded',
    ]);
    expect(result.projection.agents[agentA]?.inventory).toEqual({ Apple: 1 });
    expect(result.projection.agents[agentA]?.physiology).toEqual({
      energy: 90,
      satiety: 20,
      health: 100,
    });
    expect(result.projection.memoryRecords[0]).toMatchObject({
      agentId: agentA,
      summary: 'Ate 1 Apple.',
      status: 'succeeded',
      tags: ['eat', 'Apple'],
    });
    await expect(
      planProgressRepository.getOrCreate({
        planId: 'auto-objective-agent-a-100',
        agentId: agentA,
        createdAt: 999,
      }),
    ).resolves.toEqual({
      planId: 'auto-objective-agent-a-100',
      agentId: agentA,
      completedSubtaskIds: ['eat'],
      blockedSubtasks: [],
      updatedAt: 100,
    });
    const intentionState = await repositories.intentionRepository.getOrCreate(agentA);
    expect(intentionState.activeObjective).toBeUndefined();
    expect(intentionState.completedObjectives).toMatchObject([
      {
        objective: {
          id: 'auto-objective-agent-a-100',
          statement: 'Recover satiety before pursuing growth.',
          affinityTags: ['maintain', 'eat', 'satiety'],
        },
        completedAt: 100,
        reason: 'plan-completed',
        planId: 'auto-objective-agent-a-100',
      },
    ]);
  });

  test('emits objective renewal decision traces before canonical scheduling', async () => {
    const repositories = createRepositories();
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const renewalTraces: unknown[] = [];

    await runCanonicalWorkerActivePlanTick({
      tickId: 'tick-renew-idle-agent-trace',
      simulationId,
      issuedAt: 100,
      projection: createWorldProjection({
        agents: [createAgent(agentA)],
        marketPools: [{ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }],
      }),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      objectiveRenewalTraceSink: {
        record: (trace) => {
          renewalTraces.push(trace);
        },
      },
      ...repositories,
    });

    expect(renewalTraces).toEqual([
      {
        agentId: agentA,
        objectiveId: 'auto-objective-agent-a-100',
        selectedCandidateId: 'education-growth',
        rationale: 'Education score is below the threshold for better town opportunities.',
        score: 41,
        shortTermMemoryContextIds: [],
        profileEntryKeys: [],
        profileEvidenceRecordIds: [],
        issuedAt: 100,
      },
    ]);
  });

  test('passes memory context into objective renewal before canonical scheduling', async () => {
    const repositories = createRepositories();
    const eventStore = new InMemoryEventStore<WorldEvent>();
    await repositories.shortTermMemoryRepository.append(
      createShortTermMemoryRecord({
        id: 'memory-canonical-study',
        agentId: agentA,
        kind: 'observation',
        status: 'observed',
        summary: 'The school has a quiet study room available.',
        occurredAt: 90,
        importanceScore: 0.9,
        source: { eventIds: [] },
        tags: ['study', 'education'],
      }),
    );
    const seenMemoryIds: string[][] = [];

    const result = await runCanonicalWorkerActivePlanTick({
      tickId: 'tick-renew-from-memory',
      simulationId,
      issuedAt: 100,
      projection: createWorldProjection({
        agents: [createAgent(agentA)],
        marketPools: [{ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }],
      }),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      objectiveMemoryRetrievalLimit: 1,
      objectiveProposer: (input) => {
        const memoryContext = input.shortTermMemoryContext;
        seenMemoryIds.push(memoryContext.map((record) => record.id));
        if (!memoryContext.some((record) => record.id === 'memory-canonical-study')) {
          return undefined;
        }

        return createObjective(input.agentId);
      },
      ...repositories,
    });

    expect(seenMemoryIds).toEqual([['memory-canonical-study']]);
    expect(result.agentResults).toHaveLength(1);
    expect(result.agentResults[0]?.cycleResult.commandDrafts[0]).toMatchObject({
      type: 'AgentStudy',
    });
  });

  test('saves progress for active durable plans', async () => {
    const repositories = createRepositories();
    const planProgressRepository = new InMemoryBranchPlanProgressRepository();
    const eventStore = new InMemoryEventStore<WorldEvent>();
    await repositories.intentionRepository.setObjective(agentA, createObjective(agentA));
    await repositories.planRepository.save(createStudyPlanRecord(agentA));

    await runCanonicalWorkerActivePlanTick({
      tickId: 'tick-progress',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      planProgressRepository,
      objectiveProposer: () => undefined,
      ...repositories,
    });

    await expect(
      planProgressRepository.getOrCreate({
        planId: 'objective-study',
        agentId: agentA,
        createdAt: 999,
      }),
    ).resolves.toEqual({
      planId: 'objective-study',
      agentId: agentA,
      completedSubtaskIds: ['study-step'],
      blockedSubtasks: [],
      updatedAt: 100,
    });
    const intentionState = await repositories.intentionRepository.getOrCreate(agentA);
    expect(intentionState.activeObjective).toBeUndefined();
    expect(intentionState.completedObjectives).toEqual([
      {
        objective: createObjective(agentA),
        completedAt: 100,
        reason: 'plan-completed',
        planId: 'objective-study',
      },
    ]);
  });

  test('skips completed active durable plans and advances time only', async () => {
    const repositories = createRepositories();
    const planProgressRepository = new InMemoryBranchPlanProgressRepository();
    const eventStore = new InMemoryEventStore<WorldEvent>();
    await repositories.intentionRepository.setObjective(agentA, createObjective(agentA));
    await repositories.planRepository.save(createStudyPlanRecord(agentA));
    await planProgressRepository.save(
      markSubtaskCompleted(
        createBranchPlanProgress({
          planId: 'objective-study',
          agentId: agentA,
          createdAt: 100,
        }),
        { subtaskId: 'study-step', completedAt: 200 },
      ),
    );

    const result = await runCanonicalWorkerActivePlanTick({
      tickId: 'tick-completed-plan',
      simulationId,
      issuedAt: 300,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      planProgressRepository,
      objectiveProposer: () => undefined,
      ...repositories,
    });

    expect(result.agentResults).toEqual([]);
    expect(result.events.map((event) => event.type)).toEqual(['SimulationTimeAdvanced']);
    expect(result.projection.clock.now).toBe(1000);
    expect(result.projection.agents[agentA]?.educationScore).toBe(0);
    expect(result.streamVersion).toBe(1);
    const intentionState = await repositories.intentionRepository.getOrCreate(agentA);
    expect(intentionState.activeObjective).toBeUndefined();
    expect(intentionState.completedObjectives).toEqual([
      {
        objective: createObjective(agentA),
        completedAt: 300,
        reason: 'plan-completed',
        planId: 'objective-study',
      },
    ]);
  });

  test('hydrates projection before scheduling the next active-plan tick', async () => {
    const repositories = createRepositories();
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const initialProjection = createProjection();
    await repositories.intentionRepository.setObjective(agentA, createObjective(agentA));
    await repositories.planRepository.save(createStudyPlanRecord(agentA));

    const first = await runCanonicalWorkerActivePlanTick({
      tickId: 'tick-1',
      simulationId,
      issuedAt: 100,
      projection: initialProjection,
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      objectiveProposer: () => undefined,
      ...repositories,
    });
    const second = await runCanonicalWorkerActivePlanTick({
      tickId: 'tick-2',
      simulationId,
      issuedAt: 200,
      projectionHydration: { initialProjection },
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      objectiveProposer: () => undefined,
      ...repositories,
    });

    expect(second.events[0]?.sequence).toBe(first.streamVersion + 1);
    expect(second.projection.clock.now).toBe(2000);
    expect(second.projection.agents[agentA]?.educationScore).toBe(3600);
    expect(second.streamVersion).toBe(first.streamVersion + 3);
  });

  test('advances time when no active plans can be scheduled', async () => {
    const repositories = createRepositories();
    const eventStore = new InMemoryEventStore<WorldEvent>();
    await repositories.intentionRepository.setObjective(agentA, createObjective(agentA));

    const result = await runCanonicalWorkerActivePlanTick({
      tickId: 'tick-empty',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      objectiveProposer: () => undefined,
      ...repositories,
    });

    expect(result.agentResults).toEqual([]);
    expect(result.events.map((event) => event.type)).toEqual(['SimulationTimeAdvanced']);
    expect(result.projection.clock.now).toBe(1000);
    expect(result.streamVersion).toBe(1);
  });
});

function createRepositories() {
  return {
    intentionRepository: new InMemoryAgentIntentionRepository(),
    longTermProfileRepository: new InMemoryLongTermProfileRepository(),
    shortTermMemoryRepository: new InMemoryShortTermMemoryRepository(),
    planRepository: new InMemoryBranchPlanRepository(),
  };
}

function createProjection(input: {
  readonly agents?: readonly WorldAgentState[];
  readonly locations?: readonly {
    readonly locationId: LocationId;
    readonly name: string;
    readonly kind:
      | 'residence'
      | 'education'
      | 'healthcare'
      | 'food'
      | 'market'
      | 'production'
      | 'social';
    readonly activityAffinities: readonly string[];
    readonly capacity: number | null;
  }[];
  readonly marketPools?: readonly {
    readonly commodity: string;
    readonly commodityReserve: number;
    readonly currencyReserve: number;
  }[];
} = {}): WorldProjection {
  return createWorldProjection({
    agents: input.agents ?? [createAgent(agentA), createAgent(agentB)],
    ...(input.locations === undefined ? {} : { locations: input.locations }),
    marketPools: input.marketPools ?? [
      { commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 },
    ],
  });
}

function createAgent(
  agentId: AgentId,
  overrides: Partial<Omit<WorldAgentState, 'agentId'>> = {},
): WorldAgentState {
  return {
    agentId,
    locationId: overrides.locationId ?? null,
    physiology: overrides.physiology ?? { energy: 50, satiety: 50, health: 100 },
    educationScore: overrides.educationScore ?? 0,
    balance: overrides.balance ?? 1000,
    residentialTier: overrides.residentialTier ?? 1,
    job: overrides.job ?? null,
    inventory: overrides.inventory ?? {},
  };
}

function residentialBlock() {
  return {
    locationId: asLocationId('residential-block'),
    name: 'Residential Block',
    kind: 'residence' as const,
    activityAffinities: ['sleep', 'socialize'],
    capacity: null,
  };
}

function school() {
  return {
    locationId: asLocationId('school'),
    name: 'School',
    kind: 'education' as const,
    activityAffinities: ['study', 'socialize'],
    capacity: null,
  };
}

function createObjective(agentId: AgentId): LongHorizonObjective {
  return {
    id: 'objective-study',
    agentId,
    statement: 'Study for the town routine.',
    priority: 3,
    source: 'human',
    affinityTags: ['study'],
    createdAt: 100,
    updatedAt: 100,
  };
}

function createProductionObjective(agentId: AgentId): LongHorizonObjective {
  return {
    id: 'objective-production',
    agentId,
    statement: 'Produce food for the town routine.',
    priority: 3,
    source: 'human',
    affinityTags: ['production'],
    createdAt: 100,
    updatedAt: 100,
  };
}

function createResidentialObjective(agentId: AgentId): LongHorizonObjective {
  return {
    id: 'objective-residential',
    agentId,
    statement: 'Upgrade residential tier to unlock advanced town opportunities.',
    priority: 3,
    source: 'human',
    affinityTags: ['residential'],
    createdAt: 100,
    updatedAt: 100,
  };
}

function createStockClerkObjective(agentId: AgentId): LongHorizonObjective {
  return {
    id: 'objective-stock-clerk',
    agentId,
    statement: 'Apply for Stock Clerk work.',
    priority: 3,
    source: 'human',
    affinityTags: ['work'],
    createdAt: 100,
    updatedAt: 100,
  };
}

function createBookProductionObjective(agentId: AgentId): LongHorizonObjective {
  return {
    id: 'objective-book-production',
    agentId,
    statement: 'Craft Book for the town library.',
    priority: 3,
    source: 'human',
    affinityTags: ['production'],
    createdAt: 100,
    updatedAt: 100,
  };
}

function createStudyPlanRecord(agentId: AgentId) {
  return {
    planId: 'objective-study',
    agentId,
    plan: createBranchPlan({
      objective: 'Study for the town routine.',
      branches: [
        {
          id: 'study-lane',
          objective: 'Build knowledge.',
          subtasks: [
            {
              id: 'study-step',
              description: 'Attend planned activity.',
              basePriority: 5,
              intentionAffinityTags: ['study'],
            },
          ],
        },
      ],
    }),
    createdAt: 100,
    updatedAt: 100,
  };
}

function createProductionPlanRecord(agentId: AgentId) {
  return {
    planId: 'objective-production',
    agentId,
    plan: createBranchPlan({
      objective: 'Produce food for the town routine.',
      branches: [
        {
          id: 'production-lane',
          objective: 'Keep basic supplies available.',
          subtasks: [
            {
              id: 'produce-step',
              description: 'Produce staple food.',
              basePriority: 5,
              intentionAffinityTags: ['production'],
            },
          ],
        },
      ],
    }),
    createdAt: 100,
    updatedAt: 100,
  };
}

function createResidentialPlanRecord(agentId: AgentId) {
  return {
    planId: 'objective-residential',
    agentId,
    plan: createBranchPlan({
      objective: 'Upgrade residential tier to unlock advanced town opportunities.',
      branches: [
        {
          id: 'residential-lane',
          objective: 'Invest in residential access.',
          subtasks: [
            {
              id: 'residential-upgrade-step',
              description: 'Upgrade residential tier.',
              basePriority: 5,
              intentionAffinityTags: ['residential'],
            },
          ],
        },
      ],
    }),
    createdAt: 100,
    updatedAt: 100,
  };
}

function createStockClerkPlanRecord(agentId: AgentId) {
  return {
    planId: 'objective-stock-clerk',
    agentId,
    plan: createBranchPlan({
      objective: 'Apply for Stock Clerk work.',
      branches: [
        {
          id: 'work-lane',
          objective: 'Enter Stock Clerk occupation.',
          subtasks: [
            {
              id: 'stock-clerk-step',
              description: 'Apply for Stock Clerk.',
              basePriority: 5,
              intentionAffinityTags: ['work'],
            },
          ],
        },
      ],
    }),
    createdAt: 100,
    updatedAt: 100,
  };
}

function createBookProductionPlanRecord(agentId: AgentId) {
  return {
    planId: 'objective-book-production',
    agentId,
    plan: createBranchPlan({
      objective: 'Craft Book for the town library.',
      branches: [
        {
          id: 'production-lane',
          objective: 'Produce Book for the library shelves.',
          subtasks: [
            {
              id: 'produce-book-step',
              description: 'Craft Book for the library.',
              basePriority: 5,
              intentionAffinityTags: ['production'],
            },
          ],
        },
      ],
    }),
    createdAt: 100,
    updatedAt: 100,
  };
}
