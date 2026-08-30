import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, test } from 'vitest';
import type { CommandDraft } from '@aivilization/agent-runtime';
import {
  InMemoryEventStore,
  asAgentId,
  asLocationId,
  asSimulationId,
  createSimulationPartition,
  type PartitionKey,
} from '@aivilization/sim-core';
import { applyWorldEvent, createWorldProjection, type WorldEvent } from '@aivilization/world';
import { createAivilizationWorldCommandPolicies } from './aivilizationWorldPolicies';
import type { AgentCognitiveSnapshot } from './agentCognitiveSnapshot';
import { createSimulationCommandRouter } from './simulationCommandRouter';
import { createSimulationWideAuthority } from './simulationWideAuthority';

const partitionA = 'partition-a' as PartitionKey;
const partitionB = 'partition-b' as PartitionKey;
const simulationId = asSimulationId('unified-town');
const agentA = asAgentId('agent-a');
const agentB = asAgentId('agent-b');
const lease = { workerId: 'router-worker', observedAt: 1, durationMs: 30_000 };

describe('simulation command router', () => {
  test('settles banking against one authority and fans the bank snapshot to every partition', async () => {
    const authority = createRouterAuthority({
      agentALocationId: 'town-square',
      agentBLocationId: 'market',
    });
    const router = createSimulationCommandRouter({
      authority,
      lease: () => lease,
      partitionKey: partitionA,
    });
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const partition = createSimulationPartition({
      simulationId: 'sim-1',
      partitionKey: partitionA,
    });

    const result = await router.routeCommandDrafts({
      commandDrafts: [createDepositDraft(agentA, 25)],
      projection: createPartitionProjection({
        agentId: agentA,
        locationId: asLocationId('town-square'),
      }),
      policies: createAivilizationWorldCommandPolicies('router-test'),
      eventStore,
      streamName: partition.eventStreamName,
      appendIdempotencyKey: 'tick-credit:agent-a',
      commandIdPrefix: 'tick-credit:agent-a',
    });

    expect(result.events.map((event) => event.type)).toContain('DepositMade');
    expect(result.events.at(-1)?.type).toBe('TownBankSnapshotRecorded');
    expect(authority.getSnapshot().projection).toMatchObject({
      agents: { [agentA]: { balance: 475 } },
      bank: { balance: 25, deposits: { [agentA]: 25 } },
    });
    const ownerDelivery = authority.readInbox({
      partitionKey: partitionA,
      consumerId: 'credit-owner',
    }).deliveries[0];
    const replicaDelivery = authority.readInbox({
      partitionKey: partitionB,
      consumerId: 'credit-replica',
    }).deliveries[0];
    expect(ownerDelivery?.events.map((event) => event.type)).toEqual([
      'DepositMade',
      'ShortTermMemoryRecorded',
      'TownBankSnapshotRecorded',
    ]);
    expect(replicaDelivery?.events.map((event) => event.type)).toEqual([
      'TownBankSnapshotRecorded',
    ]);
  });

  test('synchronizes mutable Agent state before global trade settlement', async () => {
    const authority = createRouterAuthority({
      agentALocationId: 'town-square',
      agentBLocationId: 'market',
    });
    const router = createSimulationCommandRouter({
      authority,
      lease: () => lease,
      partitionKey: partitionA,
    });
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const partition = createSimulationPartition({
      simulationId: 'sim-1',
      partitionKey: partitionA,
    });
    const projection = createPartitionProjection({
      agentId: agentA,
      locationId: asLocationId('town-square'),
      balance: 0,
    });

    const result = await router.routeCommandDrafts({
      commandDrafts: [createTradeDraft(agentA)],
      projection,
      policies: createAivilizationWorldCommandPolicies('router-test'),
      eventStore,
      streamName: partition.eventStreamName,
      appendIdempotencyKey: 'tick-stale-balance:agent-a',
      commandIdPrefix: 'tick-stale-balance:agent-a',
    });

    expect(authority.getSnapshot().projection.agents[agentA]?.balance).toBe(0);
    expect(authority.getSnapshot().projection.marketPools['Fish']?.commodityReserve).toBe(100);
    expect(result.events.some((event) => event.type === 'ActionRejected')).toBe(true);
    expect(result.events.some((event) => event.type === 'TradeExecuted')).toBe(false);
  });

  test('decides and reports mixed local/global drafts in durable replay order', async () => {
    const authority = createRouterAuthority({
      agentALocationId: 'town-square',
      agentBLocationId: 'market',
    });
    const router = createSimulationCommandRouter({
      authority,
      lease: () => lease,
      partitionKey: partitionA,
    });
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const partition = createSimulationPartition({
      simulationId: 'sim-1',
      partitionKey: partitionA,
    });
    const projection = {
      ...createPartitionProjection({
        agentId: agentA,
        locationId: asLocationId('town-square'),
      }),
      treasury: 0,
    };

    const result = await router.routeCommandDrafts({
      commandDrafts: [createTradeDraft(agentA), createStudyDraft(agentA)],
      projection,
      policies: createAivilizationWorldCommandPolicies('router-test'),
      eventStore,
      streamName: partition.eventStreamName,
      appendIdempotencyKey: 'tick-mixed-order:agent-a',
      commandIdPrefix: 'tick-mixed-order:agent-a',
    });

    const educationIndex = result.events.findIndex((event) => event.type === 'EducationChanged');
    const rejectionIndex = result.events.findIndex((event) => event.type === 'ActionRejected');
    expect(educationIndex).toBeGreaterThanOrEqual(0);
    expect(rejectionIndex).toBeGreaterThan(educationIndex);
    expect(result.events.some((event) => event.type === 'TradeExecuted')).toBe(false);
    expect(eventStore.readStream(partition.eventStreamName).map((event) => event.type)).toEqual(
      result.events.slice(0, rejectionIndex).map((event) => event.type),
    );
    const rejectionDeliveries = authority.readInbox({
      partitionKey: partitionA,
      consumerId: 'mixed-replay',
    }).deliveries;
    expect(rejectionDeliveries).toHaveLength(1);
    expect(rejectionDeliveries[0]?.operationKind).toBe('command-rejected');
    expect(rejectionDeliveries[0]?.events.some((event) => event.type === 'ActionRejected')).toBe(
      true,
    );
    expect(result.hasUnstreamedAuthorityEvents).toBe(true);
  });

  test('journals an accepted global command followed by a rejection in replay order', async () => {
    const authority = createRouterAuthority({
      agentALocationId: 'town-square',
      agentBLocationId: 'market',
    });
    const router = createSimulationCommandRouter({
      authority,
      lease: () => lease,
      partitionKey: partitionA,
    });
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const partition = createSimulationPartition({
      simulationId: 'sim-1',
      partitionKey: partitionA,
    });

    const result = await router.routeCommandDrafts({
      commandDrafts: [createTradeDraft(agentA), createTradeDraft(agentA)],
      projection: createPartitionProjection({
        agentId: agentA,
        locationId: asLocationId('town-square'),
      }),
      policies: createAivilizationWorldCommandPolicies('router-test'),
      eventStore,
      streamName: partition.eventStreamName,
      appendIdempotencyKey: 'tick-global-accept-reject:agent-a',
      commandIdPrefix: 'tick-global-accept-reject:agent-a',
    });

    const tradeIndex = result.events.findIndex((event) => event.type === 'TradeExecuted');
    const rejectionIndex = result.events.findIndex((event) => event.type === 'ActionRejected');
    expect(tradeIndex).toBeGreaterThanOrEqual(0);
    expect(rejectionIndex).toBeGreaterThan(tradeIndex);
    expect(eventStore.readStream(partition.eventStreamName)).toEqual([]);
    expect(
      authority
        .readInbox({ partitionKey: partitionA, consumerId: 'global-replay' })
        .deliveries.map((delivery) => delivery.operationKind),
    ).toEqual(['trade', 'command-rejected']);
    expect(result.hasUnstreamedAuthorityEvents).toBe(true);
  });

  test('syncs the partition location view into the authority before settlement', async () => {
    // Seed says agent-a stands at the market, but its owner partition's durable
    // reality (the routed projection) is the town square. Routing any draft
    // must report that reality before global settlement can run.
    const authority = createRouterAuthority({
      agentALocationId: 'market',
      agentBLocationId: 'market',
    });
    const router = createSimulationCommandRouter({
      authority,
      lease: () => lease,
      partitionKey: partitionA,
    });
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const partition = createSimulationPartition({
      simulationId: 'sim-1',
      partitionKey: partitionA,
    });

    await router.routeCommandDrafts({
      commandDrafts: [createStudyDraft(agentA)],
      projection: createPartitionProjection({
        agentId: agentA,
        locationId: asLocationId('town-square'),
      }),
      policies: createAivilizationWorldCommandPolicies('router-test'),
      eventStore,
      streamName: partition.eventStreamName,
      appendIdempotencyKey: 'tick-1:agent-a',
      commandIdPrefix: 'tick-1:agent-a',
    });

    expect(authority.getSnapshot().projection.agents[agentA]?.locationId).toBe(
      asLocationId('town-square'),
    );
    // Unchanged location views are not journaled again on the next route.
    const operationCount = Object.keys(authority.getSnapshot().operations).length;
    await router.routeCommandDrafts({
      commandDrafts: [createStudyDraft(agentA)],
      projection: createPartitionProjection({
        agentId: agentA,
        locationId: asLocationId('town-square'),
      }),
      policies: createAivilizationWorldCommandPolicies('router-test'),
      eventStore,
      streamName: partition.eventStreamName,
      appendIdempotencyKey: 'tick-2:agent-a',
      commandIdPrefix: 'tick-2:agent-a',
    });
    expect(Object.keys(authority.getSnapshot().operations).length).toBe(operationCount);
  });

  test('settles a cross-owner conversation once the initiator sync makes co-location true', async () => {
    // Seed reality: agent-a is at the town square, agent-b at the market.
    // agent-b's owner partition has since moved it locally to the town square;
    // only the partition location sync can teach the authority that fact.
    const authority = createRouterAuthority({
      agentALocationId: 'town-square',
      agentBLocationId: 'market',
    });
    const routerB = createSimulationCommandRouter({
      authority,
      lease: () => lease,
      partitionKey: partitionB,
    });
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const partition = createSimulationPartition({
      simulationId: 'sim-1',
      partitionKey: partitionB,
    });

    const result = await routerB.routeCommandDrafts({
      commandDrafts: [createConversationDraft(agentB, agentA)],
      projection: createPartitionProjection({
        agentId: agentB,
        locationId: asLocationId('town-square'),
      }),
      policies: createAivilizationWorldCommandPolicies('router-test'),
      eventStore,
      streamName: partition.eventStreamName,
      appendIdempotencyKey: 'tick-1:agent-b',
      commandIdPrefix: 'tick-1:agent-b',
    });

    // The sync ran before settlement, so the co-location check passed against
    // fresh global state and the conversation settled instead of rejecting.
    const conversationEvents = result.events.filter(
      (event) => event.type === 'ConversationRecorded',
    );
    expect(conversationEvents).toHaveLength(1);

    // Both owner partitions receive the settled conversation through inboxes.
    const deliveriesA = authority.readInbox({ partitionKey: partitionA, consumerId: 'm-a' });
    const deliveriesB = authority.readInbox({ partitionKey: partitionB, consumerId: 'm-b' });
    expect(deliveriesA.deliveries).toMatchObject([
      { operationKind: 'conversation', partitionKey: partitionA },
    ]);
    expect(deliveriesB.deliveries).toMatchObject([
      { operationKind: 'conversation', partitionKey: partitionB },
    ]);
  });
  test('routes a move draft through authority settlement instead of the partition stream', async () => {
    const authority = createRouterAuthority({
      agentALocationId: 'town-square',
      agentBLocationId: 'market',
    });
    const router = createSimulationCommandRouter({
      authority,
      lease: () => lease,
      partitionKey: partitionA,
    });
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const partition = createSimulationPartition({
      simulationId: 'sim-1',
      partitionKey: partitionA,
    });

    const result = await router.routeCommandDrafts({
      commandDrafts: [
        {
          simulationId: asSimulationId('sim-1'),
          actorId: agentA,
          source: 'agent-runtime',
          type: 'AgentMoveTo',
          payload: { targetLocationId: asLocationId('school'), reason: 'attend class' },
          issuedAt: 100,
        },
      ],
      projection: createPartitionProjection({
        agentId: agentA,
        locationId: asLocationId('town-square'),
      }),
      policies: createAivilizationWorldCommandPolicies('router-test'),
      eventStore,
      streamName: partition.eventStreamName,
      appendIdempotencyKey: 'tick-1:agent-a',
      commandIdPrefix: 'tick-1:agent-a',
    });

    // The move settled globally: settlement events carry the location change
    // and the authority records a completed same-owner move operation.
    expect(result.events.some((event) => event.type === 'AgentLocationChanged')).toBe(true);
    expect(authority.getSnapshot().projection.agents[agentA]?.locationId).toBe(
      asLocationId('school'),
    );
    const moveOperations = Object.values(authority.getSnapshot().operations)
      .map((entry) => entry.operation)
      .filter((operation) => operation.kind === 'move');
    expect(moveOperations).toMatchObject([
      { status: 'completed', ownerPartitionKey: partitionA, destinationPartitionKey: partitionA },
    ]);
    // Settlement events reach the owner through the inbox, not a direct append.
    expect(
      authority.readInbox({ partitionKey: partitionA, consumerId: 'm-a' }).deliveries,
    ).toMatchObject([{ operationKind: 'move', partitionKey: partitionA }]);
    expect(eventStore.getStreamVersion(partition.eventStreamName)).toBe(0);
  });
  test('catches the authority clock up to the partition clock before settling global drafts', async () => {
    // Locations are connected (town-square -> school takes 120s), so the move
    // settles as a transit whose AgentActivityTimeCommitted embeds the
    // authority clock as startedAt.
    const connectedLocations = [
      {
        locationId: asLocationId('town-square'),
        name: 'Town square',
        kind: 'social' as const,
        activityAffinities: ['social'],
        capacity: 20,
        connections: [{ targetLocationId: asLocationId('school'), travelDurationSeconds: 120 }],
      },
      {
        locationId: asLocationId('school'),
        name: 'School',
        kind: 'education' as const,
        activityAffinities: ['study'],
        capacity: 20,
        connections: [
          { targetLocationId: asLocationId('town-square'), travelDurationSeconds: 120 },
        ],
      },
    ];
    const agentSeed = {
      agentId: agentA,
      locationId: asLocationId('town-square'),
      physiology: { energy: 100, satiety: 100, health: 100 },
      educationScore: 0,
      balance: 500,
      residentialTier: 1,
      job: null,
      inventory: {},
    };
    const authority = createSimulationWideAuthority({
      rootDir: mkdtempSync(join(tmpdir(), 'aivilization-router-clock-')),
      policies: createAivilizationWorldCommandPolicies('router-test'),
      seed: {
        manifestId: 'router-clock-manifest',
        simulationId: asSimulationId('sim-1'),
        projection: createWorldProjection({
          clock: { now: 0, tickDurationMs: 1_000 },
          locations: connectedLocations,
          agents: [agentSeed],
          marketPools: [{ commodity: 'Fish', commodityReserve: 100, currencyReserve: 1_000 }],
          moneySupply: 1_000,
        }),
        owners: [{ agentId: agentA, partitionKey: partitionA }],
        partitionKeys: [partitionA],
      },
    });
    const router = createSimulationCommandRouter({
      authority,
      lease: () => lease,
      partitionKey: partitionA,
    });
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const partition = createSimulationPartition({
      simulationId: 'sim-1',
      partitionKey: partitionA,
    });
    // The tick already advanced the partition clock to 7000 while the
    // authority still sits at the bootstrap clock (0): the pre-tick
    // materializer only catches the authority up to the pre-tick clock.
    // Settlement events embed the authority clock (the transit commits
    // AgentActivityTimeCommitted.startedAt), so applying them onto the
    // partition projection breaks its clock invariants unless the router
    // levels the authority first.
    const partitionProjection = {
      ...createWorldProjection({
        clock: { now: 0, tickDurationMs: 1_000 },
        locations: connectedLocations,
        agents: [agentSeed],
        marketPools: [{ commodity: 'Fish', commodityReserve: 100, currencyReserve: 1_000 }],
        moneySupply: 1_000,
      }),
      clock: { now: 7_000, tickDurationMs: 1_000 },
    };

    const result = await router.routeCommandDrafts({
      commandDrafts: [
        {
          simulationId: asSimulationId('sim-1'),
          actorId: agentA,
          source: 'agent-runtime',
          type: 'AgentMoveTo',
          payload: { targetLocationId: asLocationId('school'), reason: 'attend class' },
          issuedAt: 100,
        },
      ],
      projection: partitionProjection,
      policies: createAivilizationWorldCommandPolicies('router-test'),
      eventStore,
      streamName: partition.eventStreamName,
      appendIdempotencyKey: 'tick-1:agent-a',
      commandIdPrefix: 'tick-1:agent-a',
    });

    expect(authority.getSnapshot().projection.clock.now).toBe(7_000);
    const activityCommit = result.events.find(
      (event) => event.type === 'AgentActivityTimeCommitted',
    );
    expect(activityCommit?.payload.startedAt).toBe(7_000);
    // The settlement events apply cleanly onto the partition's working
    // projection, and the result is marked as carrying authority-settled
    // events the stream has not seen yet (no tick checkpoint against it).
    expect(() => result.events.reduce(applyWorldEvent, partitionProjection)).not.toThrow();
    expect(result.hasUnstreamedAuthorityEvents).toBe(true);
  });
  test('admits runtime-registered agents to the authority ledger on their first route', async () => {
    const authority = createRouterAuthority({
      agentALocationId: 'town-square',
      agentBLocationId: 'market',
    });
    const router = createSimulationCommandRouter({
      authority,
      lease: () => lease,
      partitionKey: partitionA,
    });
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const partition = createSimulationPartition({
      simulationId: 'sim-1',
      partitionKey: partitionA,
    });
    // participant-agent registered partition-locally (command drain); the
    // authority ledger only knows the seed agents.
    const newcomer = asAgentId('participant-agent');
    const projection = createWorldProjection({
      clock: { now: 0, tickDurationMs: 1_000 },
      locations: [
        {
          locationId: asLocationId('town-square'),
          name: 'Town square',
          kind: 'social',
          activityAffinities: ['social'],
          capacity: 20,
        },
        {
          locationId: asLocationId('school'),
          name: 'School',
          kind: 'education',
          activityAffinities: ['study'],
          capacity: 20,
        },
      ],
      agents: [
        {
          agentId: newcomer,
          locationId: asLocationId('town-square'),
          physiology: { energy: 90, satiety: 90, health: 100 },
          educationScore: 0,
          balance: 100,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      marketPools: [{ commodity: 'Fish', commodityReserve: 100, currencyReserve: 1_000 }],
      moneySupply: 1_000,
    });

    await router.routeCommandDrafts({
      commandDrafts: [createStudyDraft(newcomer)],
      projection,
      policies: createAivilizationWorldCommandPolicies('router-test'),
      eventStore,
      streamName: partition.eventStreamName,
      appendIdempotencyKey: 'tick-1:newcomer',
      commandIdPrefix: 'tick-1:newcomer',
    });

    const snapshot = authority.getSnapshot();
    expect(snapshot.ownerPartitionKeyByAgentId[newcomer]).toBe(partitionA);
    expect(snapshot.projection.agents[newcomer]).toMatchObject({
      locationId: asLocationId('town-square'),
      physiology: { energy: 90, satiety: 90, health: 100 },
    });
    expect(Object.values(snapshot.operations).map((entry) => entry.operation)).toContainEqual(
      expect.objectContaining({ kind: 'location-sync', registeredAgentIds: [newcomer] }),
    );

    // A later sync with an unchanged location view is a no-op: no new
    // authority operation is journaled for the repeat route.
    const operationCount = Object.keys(authority.getSnapshot().operations).length;
    await router.routeCommandDrafts({
      commandDrafts: [createStudyDraft(newcomer)],
      projection,
      policies: createAivilizationWorldCommandPolicies('router-test'),
      eventStore,
      streamName: partition.eventStreamName,
      appendIdempotencyKey: 'tick-2:newcomer',
      commandIdPrefix: 'tick-2:newcomer',
    });
    expect(Object.keys(authority.getSnapshot().operations).length).toBe(operationCount);
  });
  test('routes a cross-owner move resolved by location affinity with a captured snapshot', async () => {
    const authority = createRouterAuthority({
      agentALocationId: 'town-square',
      agentBLocationId: 'market',
    });
    const capturedSnapshots: { agentId: string; capturedAt: number }[] = [];
    const router = createSimulationCommandRouter({
      authority,
      lease: () => lease,
      partitionKey: partitionA,
      // Affinity: the school belongs to partition-b; everything else keeps the
      // mover's current owner.
      resolveLocationOwner: (locationId) => (locationId === 'school' ? partitionB : undefined),
      captureCognitiveSnapshot: ({ agentId, capturedAt }) => {
        capturedSnapshots.push({ agentId, capturedAt });
        return Promise.resolve({
          schemaVersion: 'agent-cognitive-snapshot-v1',
          agentId: asAgentId(agentId),
          sourcePartitionKey: partitionA,
          capturedAt,
          shortTermMemory: [],
          longTermProfile: {
            agentId: asAgentId(agentId),
            beliefs: [],
            habits: [],
            mood: [],
            values: [],
            personality: [],
            socialRecords: [],
          },
          intention: {
            agentId: asAgentId(agentId),
            completedObjectives: [],
            scheduledIntentions: [],
            updatedAt: 0,
          },
        } satisfies AgentCognitiveSnapshot);
      },
    });
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const partition = createSimulationPartition({
      simulationId: 'sim-1',
      partitionKey: partitionA,
    });

    await router.routeCommandDrafts({
      commandDrafts: [
        {
          simulationId: asSimulationId('sim-1'),
          actorId: agentA,
          source: 'agent-runtime',
          type: 'AgentMoveTo',
          payload: { targetLocationId: asLocationId('school'), reason: 'attend class' },
          issuedAt: 100,
        },
      ],
      projection: createPartitionProjection({
        agentId: agentA,
        locationId: asLocationId('town-square'),
      }),
      policies: createAivilizationWorldCommandPolicies('router-test'),
      eventStore,
      streamName: partition.eventStreamName,
      appendIdempotencyKey: 'tick-1:agent-a',
      commandIdPrefix: 'tick-1:agent-a',
    });

    // Affinity resolved the destination, the snapshot was captured once, and
    // ownership flipped on immediate arrival.
    expect(capturedSnapshots).toEqual([{ agentId: agentA, capturedAt: lease.observedAt }]);
    expect(authority.getSnapshot().ownerPartitionKeyByAgentId[agentA]).toBe(partitionB);

    // The destination's delivery carries the arrival event and the snapshot.
    const destinationDeliveries = authority.readInbox({
      partitionKey: partitionB,
      consumerId: 'm-b',
    }).deliveries;
    expect(destinationDeliveries).toMatchObject([
      { operationKind: 'move', partitionKey: partitionB },
    ]);
    expect(destinationDeliveries[0]!.cognitiveSnapshot?.agentId).toBe(agentA);
    expect(
      destinationDeliveries[0]!.events.some((event) => event.type === 'AgentOwnershipArrived'),
    ).toBe(true);

    // The source's own delivery includes its departure.
    const sourceDeliveries = authority.readInbox({
      partitionKey: partitionA,
      consumerId: 'm-a',
    }).deliveries;
    expect(
      sourceDeliveries[0]!.events.some((event) => event.type === 'AgentOwnershipDeparted'),
    ).toBe(true);
  });
});

function createRouterAuthority(seedLocations: {
  readonly agentALocationId: string;
  readonly agentBLocationId: string;
}) {
  return createSimulationWideAuthority({
    rootDir: mkdtempSync(join(tmpdir(), 'aivilization-router-authority-')),
    policies: createAivilizationWorldCommandPolicies('router-test'),
    seed: {
      manifestId: 'manifest-1',
      simulationId,
      partitionKeys: [partitionA, partitionB],
      owners: [
        { agentId: agentA, partitionKey: partitionA },
        { agentId: agentB, partitionKey: partitionB },
      ],
      projection: createWorldProjection({
        clock: { now: 0, tickDurationMs: 1_000 },
        locations: [
          {
            locationId: asLocationId('town-square'),
            name: 'Town square',
            kind: 'social',
            activityAffinities: ['social'],
            capacity: 20,
          },
          {
            locationId: asLocationId('market'),
            name: 'Market',
            kind: 'market',
            activityAffinities: ['trade'],
            capacity: 20,
          },
          {
            locationId: asLocationId('school'),
            name: 'School',
            kind: 'education',
            activityAffinities: ['study'],
            capacity: 20,
          },
        ],
        agents: [
          {
            agentId: agentA,
            locationId: asLocationId(seedLocations.agentALocationId),
            physiology: { energy: 100, satiety: 100, health: 100 },
            educationScore: 0,
            balance: 500,
            residentialTier: 1,
            job: null,
            inventory: {},
          },
          {
            agentId: agentB,
            locationId: asLocationId(seedLocations.agentBLocationId),
            physiology: { energy: 100, satiety: 100, health: 100 },
            educationScore: 0,
            balance: 500,
            residentialTier: 1,
            job: null,
            inventory: {},
          },
        ],
        marketPools: [{ commodity: 'Fish', commodityReserve: 100, currencyReserve: 1_000 }],
        moneySupply: 1_000,
      }),
    },
  });
}

function createPartitionProjection(input: {
  readonly agentId: typeof agentA;
  readonly locationId: ReturnType<typeof asLocationId>;
  readonly balance?: number;
}) {
  return createWorldProjection({
    clock: { now: 0, tickDurationMs: 1_000 },
    locations: [
      {
        locationId: asLocationId('town-square'),
        name: 'Town square',
        kind: 'social',
        activityAffinities: ['social'],
        capacity: 20,
      },
      {
        locationId: asLocationId('school'),
        name: 'School',
        kind: 'education',
        activityAffinities: ['study'],
        capacity: 20,
      },
    ],
    agents: [
      {
        agentId: input.agentId,
        locationId: input.locationId,
        physiology: { energy: 100, satiety: 100, health: 100 },
        educationScore: 0,
        balance: input.balance ?? 500,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
    ],
    marketPools: [{ commodity: 'Fish', commodityReserve: 100, currencyReserve: 1_000 }],
    moneySupply: 1_000,
  });
}

function createStudyDraft(actorId: typeof agentA): CommandDraft {
  return {
    simulationId: asSimulationId('sim-1'),
    actorId,
    source: 'agent-runtime',
    type: 'AgentStudy',
    payload: { durationSeconds: 120, educationRatePerSecond: 0.5 },
    issuedAt: 100,
  };
}

function createTradeDraft(actorId: typeof agentA): CommandDraft {
  return {
    simulationId: asSimulationId('sim-1'),
    actorId,
    source: 'agent-runtime',
    type: 'AgentTrade',
    payload: { side: 'buy', commodityName: 'Fish', quantity: 1 },
    issuedAt: 100,
  };
}

function createDepositDraft(actorId: typeof agentA, amount: number): CommandDraft {
  return {
    simulationId: asSimulationId('sim-1'),
    actorId,
    source: 'agent-runtime',
    type: 'AgentDeposit',
    payload: { amount },
    issuedAt: 100,
  };
}

function createConversationDraft(initiator: typeof agentA, target: typeof agentB): CommandDraft {
  return {
    simulationId: asSimulationId('sim-1'),
    actorId: initiator,
    source: 'agent-runtime',
    type: 'AgentStartConversation',
    payload: {
      targetAgentId: target,
      topic: 'town square routines',
      relationDelta: 0,
      attitudeDelta: 0,
      turns: [
        { speakerAgentId: initiator, utterance: 'Good to see you here.', intent: 'cooperate' },
        { speakerAgentId: target, utterance: 'Likewise.', intent: 'cooperate' },
      ],
    },
    issuedAt: 100,
  };
}
