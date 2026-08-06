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
import { createWorldProjection, type WorldEvent } from '@aivilization/world';
import { createAivilizationWorldCommandPolicies } from './aivilizationWorldPolicies';
import { createSimulationCommandRouter } from './simulationCommandRouter';
import { createSimulationWideAuthority } from './simulationWideAuthority';

const partitionA = 'partition-a' as PartitionKey;
const partitionB = 'partition-b' as PartitionKey;
const simulationId = asSimulationId('unified-town');
const agentA = asAgentId('agent-a');
const agentB = asAgentId('agent-b');
const lease = { workerId: 'router-worker', observedAt: 1, durationMs: 30_000 };

describe('simulation command router', () => {
  test('syncs the partition location view into the authority before settlement', () => {
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

    router.routeCommandDrafts({
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
    router.routeCommandDrafts({
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

  test('settles a cross-owner conversation once the initiator sync makes co-location true', () => {
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

    const result = routerB.routeCommandDrafts({
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
    const conversationEvents = result.events.filter((event) => event.type === 'ConversationRecorded');
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
        balance: 500,
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
