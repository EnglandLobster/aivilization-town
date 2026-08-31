import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, test } from 'vitest';
import {
  asAgentId,
  asLocationId,
  asSimulationId,
  type AgentId,
  type PartitionKey,
} from '@aivilization/sim-core';
import { applyWorldEvent, createWorldProjection } from '@aivilization/world';
import { createAivilizationWorldCommandPolicies } from './aivilizationWorldPolicies';
import {
  createAivilizationCollectiveActionPolicy,
  createAivilizationSocialMattersPolicy,
  createAivilizationTownGovernancePolicy,
  createAivilizationTownLifecyclePolicy,
} from './experimentalFeatures';
import type { WorldCommandPolicyResolver } from './worldCommandPolicySource';
import { createShortTermMemoryRecord } from '@aivilization/memory';
import {
  SIMULATION_WIDE_AUTHORITY_JOURNAL_GENESIS_CHAIN_HASH,
  SimulationWideCommandRejectedError,
  createSimulationWideAuthority,
  verifySimulationWideAuthorityJournal,
} from './simulationWideAuthority';
import type { AgentCognitiveSnapshot } from './agentCognitiveSnapshot';

function createTestCognitiveSnapshot(agentId: typeof agentA): AgentCognitiveSnapshot {
  return {
    schemaVersion: 'agent-cognitive-snapshot-v1',
    agentId,
    sourcePartitionKey: partitionA,
    capturedAt: 1,
    shortTermMemory: [],
    longTermProfile: {
      agentId,
      beliefs: [],
      habits: [],
      mood: [],
      values: [],
      personality: [],
      socialRecords: [],
    },
    intention: {
      agentId,
      completedObjectives: [],
      scheduledIntentions: [],
      updatedAt: 0,
    },
  };
}

const partitionA = 'partition-a' as PartitionKey;
const partitionB = 'partition-b' as PartitionKey;
const simulationId = asSimulationId('unified-town');
const agentA = asAgentId('agent-a');
const agentB = asAgentId('agent-b');

describe('simulation-wide authority', () => {
  test('refuses to cross a second time boundary until every partition publishes state', () => {
    const authority = createAuthority();
    authority.advanceTime({
      operationId: 'barrier-advance-1',
      workerId: 'worker-a',
      observedAt: 1_000,
      durationMs: 100,
      deltaMs: 1_000,
    });

    expect(() =>
      authority.advanceTime({
        operationId: 'barrier-advance-too-early',
        workerId: 'worker-a',
        observedAt: 2_000,
        durationMs: 100,
        deltaMs: 1_000,
      }),
    ).toThrow('lagging partition state: partition-a@0, partition-b@0');

    authority.syncPartitionAgentLocations({
      operationId: 'barrier-sync-a',
      workerId: 'worker-a',
      observedAt: 1_001,
      durationMs: 100,
      partitionKey: partitionA,
      partitionClockNow: 1_000,
      agentLocations: [{ agentId: agentA, locationId: 'town-square' }],
    });
    authority.syncPartitionAgentLocations({
      operationId: 'barrier-sync-b',
      workerId: 'worker-b',
      observedAt: 1_001,
      durationMs: 100,
      partitionKey: partitionB,
      partitionClockNow: 1_000,
      agentLocations: [{ agentId: agentB, locationId: 'town-square' }],
    });
    expect(() =>
      authority.advanceTime({
        operationId: 'barrier-advance-2',
        workerId: 'worker-a',
        observedAt: 2_000,
        durationMs: 100,
        deltaMs: 1_000,
      }),
    ).not.toThrow();
  });

  test('settles credit accrual once and delivers owner cash plus a town-wide bank snapshot', () => {
    const authority = createAuthority();
    authority.settleCredit({
      operationId: 'deposit-before-accrual',
      workerId: 'worker-a',
      observedAt: 1,
      durationMs: 100,
      agentId: agentA,
      commandType: 'AgentDeposit',
      payload: { amount: 100 },
    });

    const advanced = authority.advanceTime({
      operationId: 'credit-accrual-day-1',
      workerId: 'worker-a',
      observedAt: 86_400_000,
      durationMs: 100,
      deltaMs: 86_400_000,
    });
    expect(advanced.flatMap((operation) => operation.events).map((event) => event.type)).toContain(
      'DepositInterestPaid',
    );
    expect(advanced.flatMap((operation) => operation.events).at(-1)?.type).toBe(
      'TownBankSnapshotRecorded',
    );
    const accrualDelivery = authority
      .readInbox({ partitionKey: partitionA, consumerId: 'credit-accrual-owner' })
      .deliveries.find((delivery) => delivery.operationId === 'credit-accrual-day-1');
    expect(accrualDelivery?.events.some((event) => event.type === 'BankInterestCredited')).toBe(
      true,
    );
    expect(accrualDelivery?.events.at(-1)?.type).toBe('TownBankSnapshotRecorded');
  });

  test('settles one global AMM trade exactly once across Agent owners', () => {
    const authority = createAuthority();

    const first = authority.settleTrade({
      operationId: 'trade-1',
      workerId: 'worker-a',
      observedAt: 1,
      durationMs: 100,
      agentId: agentA,
      trade: { side: 'buy', commodityName: 'Fish', quantity: 1 },
    });
    const replay = authority.settleTrade({
      operationId: 'trade-1',
      workerId: 'worker-b',
      observedAt: 2,
      durationMs: 100,
      agentId: agentA,
      trade: { side: 'buy', commodityName: 'Fish', quantity: 1 },
    });
    const snapshot = authority.getSnapshot();

    expect(first.ownerPartitionKey).toBe(partitionA);
    expect(replay).toEqual(first);
    expect(snapshot.revision).toBe(1);
    expect(snapshot.latestFencingToken).toBe(1);
    expect(snapshot.projection.agents[agentA]?.inventory['Fish']).toBe(1);
    expect(snapshot.projection.marketPools['Fish']?.commodityReserve).toBe(99);
    expect(snapshot.projection.marketPools['Fish']?.currencyReserve).toBeGreaterThan(1_000);
  });

  test('commits one global social graph and carries it with a later ownership move', () => {
    const authority = createAuthority();

    const result = authority.settleConversation({
      operationId: 'conversation-1',
      workerId: 'worker-a',
      observedAt: 1,
      durationMs: 100,
      initiatorAgentId: agentA,
      targetAgentId: agentB,
      topic: 'fish supply',
      turns: [
        {
          speakerAgentId: agentA,
          utterance: 'I promise to coordinate fish supply.',
          intent: 'make-commitment',
        },
        {
          speakerAgentId: agentB,
          utterance: 'Yes, I can share market information.',
          intent: 'cooperate',
        },
      ],
    });
    const snapshot = authority.getSnapshot();

    expect(result.sourcePartitionKey).toBe(partitionA);
    expect(result.targetPartitionKey).toBe(partitionB);
    expect(snapshot.projection.conversationRecords).toHaveLength(1);
    expect(Object.keys(snapshot.projection.socialRelations)).toHaveLength(2);
    expect(Object.keys(snapshot.projection.socialCommitments)).toHaveLength(1);

    authority.advanceTime({
      operationId: 'advance-after-conversation',
      workerId: 'worker-a',
      observedAt: 300_000,
      durationMs: 100,
      deltaMs: 300_000,
    });
    authority.settleMove({
      operationId: 'move-after-conversation',
      workerId: 'worker-a',
      observedAt: 300_001,
      durationMs: 100,
      agentId: agentA,
      targetLocationId: 'market',
      destinationPartitionKey: partitionB,
      cognitiveSnapshot: createTestCognitiveSnapshot(agentA),
    });
    const arrival = authority
      .readInbox({ partitionKey: partitionB, consumerId: 'social-handoff-materializer' })
      .deliveries.find((delivery) => delivery.operationId === 'move-after-conversation')
      ?.events.find((event) => event.type === 'AgentOwnershipArrived');
    expect(arrival?.type).toBe('AgentOwnershipArrived');
    if (arrival?.type === 'AgentOwnershipArrived') {
      expect(arrival.payload.socialRelations).toHaveLength(2);
      expect(arrival.payload.socialCommitments).toHaveLength(1);
    }
  });

  test('settles a cross-owner resource gift once and materializes each inventory locally', () => {
    const authority = createAuthority(undefined, false, { agentAInventory: { Fish: 2 } });

    const first = authority.settleResourceTransfer({
      operationId: 'resource-transfer-1',
      workerId: 'worker-a',
      observedAt: 1,
      durationMs: 100,
      sourceAgentId: agentA,
      transfer: {
        targetAgentId: agentB,
        commodityName: 'Fish',
        quantity: 1,
        note: 'share food',
      },
    });
    const replay = authority.settleResourceTransfer({
      operationId: 'resource-transfer-1',
      workerId: 'worker-b',
      observedAt: 2,
      durationMs: 100,
      sourceAgentId: agentA,
      transfer: {
        targetAgentId: agentB,
        commodityName: 'Fish',
        quantity: 1,
        note: 'share food',
      },
    });

    expect(replay).toEqual(first);
    expect(authority.getSnapshot().revision).toBe(1);
    expect(authority.getSnapshot().projection.agents[agentA]?.inventory).toEqual({ Fish: 1 });
    expect(authority.getSnapshot().projection.agents[agentB]?.inventory).toEqual({ Fish: 1 });

    const sourceDelivery = authority
      .readInbox({ partitionKey: partitionA, consumerId: 'gift-source' })
      .deliveries.find((delivery) => delivery.operationId === 'resource-transfer-1');
    const targetDelivery = authority
      .readInbox({ partitionKey: partitionB, consumerId: 'gift-target' })
      .deliveries.find((delivery) => delivery.operationId === 'resource-transfer-1');
    expect(sourceDelivery?.operationKind).toBe('resource-transfer');
    expect(targetDelivery?.operationKind).toBe('resource-transfer');

    const sourceProjection = sourceDelivery!.events.reduce(
      applyWorldEvent,
      createWorldProjection({
        agents: [
          {
            ...authority.getSnapshot().projection.agents[agentA]!,
            locationId: null,
            inventory: { Fish: 2 },
          },
        ],
      }),
    );
    const targetProjection = targetDelivery!.events.reduce(
      applyWorldEvent,
      createWorldProjection({
        agents: [
          {
            ...authority.getSnapshot().projection.agents[agentB]!,
            locationId: null,
            inventory: {},
          },
        ],
      }),
    );
    expect(sourceProjection.agents[agentA]?.inventory).toEqual({ Fish: 1 });
    expect(targetProjection.agents[agentB]?.inventory).toEqual({ Fish: 1 });
  });

  test('settles external trade against one town balance and broadcasts no remote cash flow', () => {
    const authority = createAuthority(undefined, false, { agentAInventory: { Fish: 2 } });

    const operation = authority.settleExternalTrade({
      operationId: 'external-export-1',
      workerId: 'worker-a',
      observedAt: 1,
      durationMs: 100,
      agentId: agentA,
      commandType: 'AgentExportCommodity',
      payload: { commodityName: 'Fish', quantity: 1 },
    });
    const exportEvent = operation.events.find((event) => event.type === 'ExternalTradeExecuted');
    expect(exportEvent?.type).toBe('ExternalTradeExecuted');
    expect(authority.getSnapshot().projection.externalTrade?.balancesByCommodity).toEqual({
      Fish: 1,
    });
    expect(authority.getSnapshot().projection.agents[agentA]?.inventory).toEqual({ Fish: 1 });
    expect(authority.getSnapshot().projection.agents[agentA]?.balance).toBeGreaterThan(500);

    const remote = authority
      .readInbox({ partitionKey: partitionB, consumerId: 'external-trade-remote' })
      .deliveries.find((delivery) => delivery.operationId === 'external-export-1');
    expect(remote?.events.map((event) => event.type)).toEqual(['ExternalTradeExecuted']);
    const remoteProjection = remote!.events.reduce(
      applyWorldEvent,
      createWorldProjection({ agents: [], moneySupply: 0 }),
    );
    expect(remoteProjection.externalTrade?.balancesByCommodity).toEqual({ Fish: 1 });
    expect(remoteProjection.moneySupply).toBe(0);

    authority.advanceTime({
      operationId: 'advance-external-trade-balance',
      workerId: 'worker-a',
      observedAt: 86_400_000,
      durationMs: 100,
      deltaMs: 86_400_000,
    });
    const decayDelivery = authority
      .readInbox({ partitionKey: partitionB, consumerId: 'external-trade-decay-remote' })
      .deliveries.find((delivery) => delivery.operationId === 'advance-external-trade-balance');
    expect(
      decayDelivery?.events.some((event) => event.type === 'ExternalTradeBalancesDecayed'),
    ).toBe(true);
    expect(decayDelivery?.events.some((event) => event.type === 'RegionalLandValueUpdated')).toBe(
      true,
    );
  });

  test('moves ownership only after the canonical spatial command has committed', () => {
    const authority = createAuthority();

    const transfer = authority.settleMove({
      operationId: 'transfer-1',
      workerId: 'worker-a',
      observedAt: 1,
      durationMs: 100,
      agentId: agentA,
      destinationPartitionKey: partitionB,
      targetLocationId: 'market',
      reason: 'move to the shared market',
      cognitiveSnapshot: createTestCognitiveSnapshot(agentA),
    });
    const snapshot = authority.getSnapshot();

    expect(transfer.status).toBe('completed');
    expect(snapshot.ownerPartitionKeyByAgentId[agentA]).toBe(partitionB);
    expect(snapshot.projection.agents[agentA]?.locationId).toBe(asLocationId('market'));
    expect(snapshot.pendingTransfers).toEqual({});
    expect(snapshot.pendingMoves ?? {}).toEqual({});
  });

  test('publishes a completed cross-owner move to both owner inboxes after travel finishes', () => {
    const authority = createAuthority(undefined, true);
    const departure = authority.settleMove({
      operationId: 'transfer-with-travel',
      workerId: 'worker-a',
      observedAt: 1,
      durationMs: 100,
      agentId: agentA,
      destinationPartitionKey: partitionB,
      targetLocationId: 'market',
      reason: 'walk to market',
      cognitiveSnapshot: createTestCognitiveSnapshot(agentA),
    });
    const arrival = authority.advanceTime({
      operationId: 'advance-transfer',
      workerId: 'worker-a',
      observedAt: 10_001,
      durationMs: 100,
      deltaMs: 10_000,
    })[0];

    expect(departure.status).toBe('in-transit');
    expect(arrival).toMatchObject({
      kind: 'time-advanced',
      completedMoves: [
        {
          operationId: 'transfer-with-travel',
          agentId: agentA,
          ownerPartitionKey: partitionA,
          destinationPartitionKey: partitionB,
        },
      ],
    });
    expect(
      authority.readInbox({ partitionKey: partitionA, consumerId: 'source-move-materializer' })
        .deliveries,
    ).toMatchObject([
      { operationId: 'transfer-with-travel', operationKind: 'move' },
      { operationId: 'advance-transfer', operationKind: 'time-advanced' },
    ]);
    expect(
      authority.readInbox({ partitionKey: partitionB, consumerId: 'destination-move-materializer' })
        .deliveries,
    ).toMatchObject([{ operationId: 'advance-transfer', operationKind: 'time-advanced' }]);
    expect(authority.getSnapshot().ownerPartitionKeyByAgentId[agentA]).toBe(partitionB);
  });

  test('completes a legacy in-transit transfer restored from persisted v1 state', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'aivilization-authority-legacy-transfer-'));
    const authority = createAuthority(rootDir, true);
    authority.settleMove({
      operationId: 'move-used-to-create-transit-state',
      workerId: 'worker-a',
      observedAt: 1,
      durationMs: 100,
      agentId: agentA,
      destinationPartitionKey: partitionB,
      targetLocationId: 'market',
      reason: 'walk to market',
      cognitiveSnapshot: createTestCognitiveSnapshot(agentA),
    });

    const statePath = join(
      rootDir,
      'simulation-wide-authority',
      encodeURIComponent('unified-town'),
      'state.json',
    );
    const persisted = JSON.parse(readFileSync(statePath, 'utf8')) as {
      pendingTransfers: Record<
        string,
        {
          operationId: string;
          sourcePartitionKey: PartitionKey;
          destinationPartitionKey: PartitionKey;
          destinationLocationId: string;
        }
      >;
      pendingMoves?: Record<
        string,
        {
          operationId: string;
          ownerPartitionKey: PartitionKey;
          destinationPartitionKey: PartitionKey;
        }
      >;
    };
    const pendingMove = persisted.pendingMoves?.[agentA];
    if (pendingMove === undefined) throw new Error('expected an in-transit canonical move');
    persisted.pendingTransfers[agentA] = {
      operationId: 'legacy-transfer-in-transit',
      sourcePartitionKey: pendingMove.ownerPartitionKey,
      destinationPartitionKey: pendingMove.destinationPartitionKey,
      destinationLocationId: 'market',
    };
    delete persisted.pendingMoves?.[agentA];
    writeFileSync(statePath, `${JSON.stringify(persisted, null, 2)}\n`);

    const restarted = createAuthority(rootDir, true);
    const advance = restarted.advanceTime({
      operationId: 'advance-legacy-transfer',
      workerId: 'worker-a',
      observedAt: 10_001,
      durationMs: 100,
      deltaMs: 10_000,
    })[0];

    expect(advance).toMatchObject({
      kind: 'time-advanced',
      completedTransfers: [
        {
          operationId: 'legacy-transfer-in-transit',
          agentId: agentA,
          sourcePartitionKey: partitionA,
          destinationPartitionKey: partitionB,
        },
      ],
    });
    expect(restarted.getSnapshot().ownerPartitionKeyByAgentId[agentA]).toBe(partitionB);
    expect(restarted.getSnapshot().pendingTransfers).toEqual({});
  });

  test('does not duplicate or leak owner credit cash during a completed transfer', () => {
    const authority = createAuthority(undefined, true);
    authority.settleCredit({
      operationId: 'deposit-before-transfer-accrual',
      workerId: 'worker-a',
      observedAt: 1,
      durationMs: 100,
      agentId: agentA,
      commandType: 'AgentDeposit',
      payload: { amount: 100 },
    });
    authority.settleMove({
      operationId: 'transfer-during-credit-accrual',
      workerId: 'worker-a',
      observedAt: 2,
      durationMs: 100,
      agentId: agentA,
      destinationPartitionKey: partitionB,
      targetLocationId: 'market',
      reason: 'walk to market',
      cognitiveSnapshot: createTestCognitiveSnapshot(agentA),
    });
    authority.advanceTime({
      operationId: 'advance-transfer-with-credit',
      workerId: 'worker-a',
      observedAt: 86_400_000,
      durationMs: 100,
      deltaMs: 86_400_000,
    });

    const sourceAdvance = authority
      .readInbox({ partitionKey: partitionA, consumerId: 'credit-transfer-source' })
      .deliveries.find((delivery) => delivery.operationId === 'advance-transfer-with-credit');
    const destinationAdvance = authority
      .readInbox({ partitionKey: partitionB, consumerId: 'credit-transfer-destination' })
      .deliveries.find((delivery) => delivery.operationId === 'advance-transfer-with-credit');
    expect(sourceAdvance?.events.filter((event) => event.type === 'BankInterestCredited')).toEqual(
      [],
    );
    expect(
      destinationAdvance?.events.filter((event) => event.type === 'BankInterestCredited'),
    ).toHaveLength(1);
    expect(
      [sourceAdvance, destinationAdvance].flatMap(
        (delivery) =>
          delivery?.events.filter((event) => event.type === 'DepositInterestPaid') ?? [],
      ),
    ).toEqual([]);
    expect(
      [sourceAdvance, destinationAdvance].every((delivery) =>
        delivery?.events.some((event) => event.type === 'TownBankSnapshotRecorded'),
      ),
    ).toBe(true);
  });

  test('settles a same-owner move against the global spatial view and delivers it to the owner', () => {
    const authority = createAuthority();

    const move = authority.settleMove({
      operationId: 'move-1',
      workerId: 'worker-a',
      observedAt: 1,
      durationMs: 100,
      agentId: agentA,
      targetLocationId: 'market',
      reason: 'walk to market',
    });
    const snapshot = authority.getSnapshot();

    expect(move.status).toBe('completed');
    expect(move.ownerPartitionKey).toBe(partitionA);
    expect(move.destinationPartitionKey).toBe(partitionA);
    // Same-owner move: ownership never changes.
    expect(snapshot.ownerPartitionKeyByAgentId[agentA]).toBe(partitionA);
    expect(snapshot.projection.agents[agentA]?.locationId).toBe(asLocationId('market'));
    expect(
      authority.readInbox({ partitionKey: partitionA, consumerId: 'materializer-a' }).deliveries,
    ).toMatchObject([{ operationId: 'move-1', operationKind: 'move', partitionKey: partitionA }]);
  });

  test('keeps an in-transit move pending and delivers the arrival on the next time advance', () => {
    const authority = createAuthority(undefined, true);

    const departure = authority.settleMove({
      operationId: 'move-with-travel',
      workerId: 'worker-a',
      observedAt: 1,
      durationMs: 100,
      agentId: agentA,
      targetLocationId: 'market',
      reason: 'walk to market',
    });
    expect(departure.status).toBe('in-transit');
    // Departure events reach the owner immediately; arrival is still pending.
    expect(
      authority.readInbox({ partitionKey: partitionA, consumerId: 'materializer-a' }).deliveries,
    ).toMatchObject([{ operationId: 'move-with-travel', operationKind: 'move' }]);

    const arrival = authority.advanceTime({
      operationId: 'advance-move',
      workerId: 'worker-a',
      observedAt: 10_001,
      durationMs: 100,
      deltaMs: 10_000,
    })[0];
    expect(arrival).toMatchObject({
      kind: 'time-advanced',
      completedMoves: [
        {
          operationId: 'move-with-travel',
          agentId: agentA,
          ownerPartitionKey: partitionA,
          destinationPartitionKey: partitionA,
        },
      ],
    });
    // The arrival (carried by the time-advanced operation) is delivered to the
    // owning partition, fixing the pre-move arrival-event loss.
    expect(
      authority.readInbox({ partitionKey: partitionA, consumerId: 'materializer-a' }).deliveries,
    ).toMatchObject([
      { operationId: 'move-with-travel', operationKind: 'move' },
      { operationId: 'advance-move', operationKind: 'time-advanced' },
    ]);
    expect(authority.getSnapshot().projection.agents[agentA]?.locationId).toBe(
      asLocationId('market'),
    );
  });

  test('prices a later partition move against simulation-wide active edge flow', () => {
    const authority = createAuthority(undefined, true);

    authority.settleMove({
      operationId: 'edge-flow-first',
      workerId: 'worker-a',
      observedAt: 1,
      durationMs: 100,
      agentId: agentA,
      targetLocationId: 'market',
    });
    const second = authority.settleMove({
      operationId: 'edge-flow-second',
      workerId: 'worker-b',
      observedAt: 2,
      durationMs: 100,
      agentId: agentB,
      targetLocationId: 'market',
    });
    const travel = second.events.find((event) => event.type === 'AgentTravelStarted');

    expect(second.status).toBe('in-transit');
    expect(travel).toMatchObject({
      payload: {
        spatialPolicyVersion: 'town-spatial-graph-v2',
        routeLocationIds: ['town-square', 'market'],
        routeEdgeFlows: [
          {
            fromLocationId: 'town-square',
            toLocationId: 'market',
            activeTraversalCount: 1,
            congestionMultiplier: 1.009375,
          },
        ],
        baseTravelDurationSeconds: 10,
        edgeCongestionMultiplier: 1.009375,
        destinationCongestionMultiplier: 1.025,
        travelDurationSeconds: 11,
      },
    });
  });

  test('settles an immediate cross-owner move with paired ownership events and snapshot delivery', () => {
    const authority = createAuthority();
    const snapshot = createTestCognitiveSnapshot(agentA);
    const migrant = authority.getSnapshot().projection.agents[agentA]!;
    const moneySupplyBefore = authority.getSnapshot().projection.moneySupply;
    authority.syncPartitionAgentLocations({
      operationId: 'sync-runtime-before-cross-owner-move',
      workerId: 'worker-a',
      observedAt: 0,
      durationMs: 100,
      partitionKey: partitionA,
      agentLocations: [{ agentId: agentA, locationId: 'town-square' }],
      agentStates: [
        {
          ...migrant,
          durableGoods: [
            {
              lotId: 'migrant-durable-lot',
              commodityName: 'Furniture',
              quantity: 1,
              utilityPoints: 10,
              acquiredAt: 0,
              expiresAt: 1_000_000,
            },
          ],
          upkeepArrears: 25,
          registration: {
            registrationId: 'migrant-registration',
            policyVersion: 'runtime-agent-registration-v3',
            creatorId: 'participant-1',
            source: 'human',
            displayName: 'Migrant One',
            registeredAt: 0,
            provenance: 'post-bootstrap-command',
            humanAttribution: {
              principalSubjectId: 'participant-1',
              principalRoles: ['participant'],
              accessPolicyVersion: 'participant-access-v1',
              consentPolicyVersion: 'participant-consent-v1',
            },
          },
        },
      ],
      partitionRuntimeState: {
        activityTimeByAgent: {},
        transitByAgent: {},
        timeSettlementByAgent: { [agentA]: 0 },
        physiologicalDistressByAgent: {
          [agentA]: {
            policyVersion: 'physiological-safety-net-test',
            distressStartedAt: 0,
            lowAxes: ['satiety'],
            lastGrantedAt: null,
          },
        },
      },
    });

    const move = authority.settleMove({
      operationId: 'move-cross-owner',
      workerId: 'worker-a',
      observedAt: 1,
      durationMs: 100,
      agentId: agentA,
      targetLocationId: 'market',
      destinationPartitionKey: partitionB,
      cognitiveSnapshot: snapshot,
    });
    const authoritySnapshot = authority.getSnapshot();

    // Immediate arrival flips ownership at settlement.
    expect(move.status).toBe('completed');
    expect(authoritySnapshot.ownerPartitionKeyByAgentId[agentA]).toBe(partitionB);
    expect(authoritySnapshot.projection.moneySupply).toBe(moneySupplyBefore);

    // The source consumes settlement events plus its departure; the agent is
    // gone from its view.
    const sourceDeliveries = authority.readInbox({
      partitionKey: partitionA,
      consumerId: 'materializer-a',
    }).deliveries;
    expect(sourceDeliveries).toMatchObject([{ operationKind: 'move', partitionKey: partitionA }]);
    expect(
      sourceDeliveries[0]!.events.some((event) => event.type === 'AgentOwnershipDeparted'),
    ).toBe(true);
    expect(
      sourceDeliveries[0]!.events.find((event) => event.type === 'AgentOwnershipDeparted'),
    ).toMatchObject({ payload: { circulatingBalanceTransferred: migrant.balance } });

    // The destination receives the arrival carrying the authoritative world
    // state plus the cognitive snapshot for hydration.
    const destinationDeliveries = authority.readInbox({
      partitionKey: partitionB,
      consumerId: 'materializer-b',
    }).deliveries;
    expect(destinationDeliveries).toMatchObject([
      { operationKind: 'move', partitionKey: partitionB },
    ]);
    expect(destinationDeliveries[0]!.cognitiveSnapshot).toEqual(snapshot);
    const arrivalEvent = destinationDeliveries[0]!.events.find(
      (event) => event.type === 'AgentOwnershipArrived',
    );
    expect(arrivalEvent).toBeDefined();
    if (arrivalEvent?.type === 'AgentOwnershipArrived') {
      expect(arrivalEvent.payload.fromPartitionKey).toBe(partitionA);
      expect(arrivalEvent.payload.circulatingBalanceTransferred).toBe(migrant.balance);
      expect(arrivalEvent.payload.agentState.locationId).toBe(asLocationId('market'));
      expect(arrivalEvent.payload.agentState).toMatchObject({
        durableGoods: [{ lotId: 'migrant-durable-lot', commodityName: 'Furniture' }],
        upkeepArrears: 25,
        registration: {
          creatorId: 'participant-1',
          displayName: 'Migrant One',
          humanAttribution: { principalRoles: ['participant'] },
        },
      });
      expect(arrivalEvent.payload.lastTimeSettledAt).toBe(0);
      expect(arrivalEvent.payload.physiologicalDistress).toMatchObject({
        distressStartedAt: 0,
        lowAxes: ['satiety'],
      });
    }
  });

  test('completes an in-transit cross-owner move on time advance and hands over ownership', () => {
    const authority = createAuthority(undefined, true);
    const snapshot = createTestCognitiveSnapshot(agentA);

    const departure = authority.settleMove({
      operationId: 'move-cross-owner-travel',
      workerId: 'worker-a',
      observedAt: 1,
      durationMs: 100,
      agentId: agentA,
      targetLocationId: 'market',
      destinationPartitionKey: partitionB,
      cognitiveSnapshot: snapshot,
    });
    expect(departure.status).toBe('in-transit');
    // Owner stays with the source while travel is in flight.
    expect(authority.getSnapshot().ownerPartitionKeyByAgentId[agentA]).toBe(partitionA);
    // The destination receives nothing until travel commits.
    expect(
      authority.readInbox({ partitionKey: partitionB, consumerId: 'materializer-b' }).deliveries,
    ).toEqual([]);

    const advance = authority.advanceTime({
      operationId: 'advance-cross-owner-move',
      workerId: 'worker-a',
      observedAt: 10_001,
      durationMs: 100,
      deltaMs: 10_000,
    })[0];
    expect(advance).toMatchObject({
      kind: 'time-advanced',
      completedMoves: [
        {
          operationId: 'move-cross-owner-travel',
          ownerPartitionKey: partitionA,
          destinationPartitionKey: partitionB,
        },
      ],
    });
    expect(authority.getSnapshot().ownerPartitionKeyByAgentId[agentA]).toBe(partitionB);

    // Completion delivers the departure to the source and the arrival plus
    // snapshot to the destination — never the full advance event set.
    const sourceAfter = authority.readInbox({
      partitionKey: partitionA,
      consumerId: 'materializer-a',
    }).deliveries;
    expect(sourceAfter).toMatchObject([
      { operationKind: 'move' },
      { operationKind: 'time-advanced' },
    ]);
    expect(sourceAfter[1]!.events.every((event) => event.type === 'AgentOwnershipDeparted')).toBe(
      true,
    );
    const destinationAfter = authority.readInbox({
      partitionKey: partitionB,
      consumerId: 'materializer-b',
    }).deliveries;
    expect(destinationAfter).toMatchObject([{ operationKind: 'time-advanced' }]);
    expect(destinationAfter[0]!.cognitiveSnapshot).toEqual(snapshot);
    expect(
      destinationAfter[0]!.events.every((event) => event.type === 'AgentOwnershipArrived'),
    ).toBe(true);
  });

  test('rejects a cross-owner move that would split an active enterprise aggregate', () => {
    const authority = createAuthority();
    authority.syncPartitionAgentLocations({
      operationId: 'enterprise-before-cross-owner-move',
      workerId: 'worker-a',
      observedAt: 1,
      durationMs: 100,
      partitionKey: partitionA,
      agentLocations: [{ agentId: agentA, locationId: 'town-square' }],
      enterpriseStates: [
        {
          enterpriseId: 'enterprise-owner-a',
          name: 'Owner A Workshop',
          ownerAgentId: agentA,
          occupationName: 'Cleaner',
          balance: 100,
          inventory: {},
          maxEmployees: 2,
          employeeAgentIds: [],
          status: 'active',
          foundedAt: 0,
          cumulativeSales: 0,
          cumulativePurchases: 0,
          cumulativeWages: 0,
        },
      ],
    });

    let rejection: unknown;
    try {
      authority.settleMove({
        operationId: 'move-enterprise-owner-cross-partition',
        workerId: 'worker-a',
        observedAt: 2,
        durationMs: 100,
        agentId: agentA,
        targetLocationId: 'market',
        destinationPartitionKey: partitionB,
        cognitiveSnapshot: createTestCognitiveSnapshot(agentA),
      });
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toBeInstanceOf(SimulationWideCommandRejectedError);
    expect(rejection).toMatchObject({
      reason:
        'cross-partition movement requires leaving or closing enterprise affiliation first: enterprise-owner-a',
      events: [
        {
          type: 'ActionRejected',
          payload: { agentId: agentA, commandType: 'AgentMoveTo' },
        },
      ],
    });
    expect(authority.getSnapshot().ownerPartitionKeyByAgentId[agentA]).toBe(partitionA);
    expect(authority.getSnapshot().projection.enterprises['enterprise-owner-a']?.status).toBe(
      'active',
    );
  });

  test('guards the cognitive snapshot contract on cross-owner and same-owner moves', () => {
    const authority = createAuthority();

    expect(() =>
      authority.settleMove({
        operationId: 'move-cross-owner-no-snapshot',
        workerId: 'worker-a',
        observedAt: 1,
        durationMs: 100,
        agentId: agentA,
        targetLocationId: 'market',
        destinationPartitionKey: partitionB,
      }),
    ).toThrow(/requires a cognitive snapshot/);

    expect(() =>
      authority.settleMove({
        operationId: 'move-same-owner-with-snapshot',
        workerId: 'worker-a',
        observedAt: 1,
        durationMs: 100,
        agentId: agentA,
        targetLocationId: 'market',
        cognitiveSnapshot: createTestCognitiveSnapshot(agentA),
      }),
    ).toThrow(/must not carry a cognitive snapshot/);

    expect(() =>
      authority.settleMove({
        operationId: 'move-cross-owner-wrong-snapshot-agent',
        workerId: 'worker-a',
        observedAt: 1,
        durationMs: 100,
        agentId: agentA,
        targetLocationId: 'market',
        destinationPartitionKey: partitionB,
        cognitiveSnapshot: createTestCognitiveSnapshot(agentB),
      }),
    ).toThrow(/belongs to agent-b@partition-a, expected agent-a@partition-a/);
  });

  test('rejects a move that would exceed the globally observed location capacity', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'aivilization-authority-cap-'));
    const authority = createSimulationWideAuthority({
      rootDir,
      policies: createAivilizationWorldCommandPolicies('authority-cap-test'),
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
              connections: [
                { targetLocationId: asLocationId('tiny-room'), travelDurationSeconds: 1 },
              ],
            },
            {
              locationId: asLocationId('tiny-room'),
              name: 'Tiny room',
              kind: 'social',
              activityAffinities: ['social'],
              capacity: 1,
              connections: [
                { targetLocationId: asLocationId('town-square'), travelDurationSeconds: 1 },
              ],
            },
          ],
          agents: [
            {
              agentId: agentA,
              locationId: asLocationId('town-square'),
              physiology: { energy: 100, satiety: 100, health: 100 },
              educationScore: 0,
              balance: 500,
              residentialTier: 1,
              job: null,
              inventory: {},
            },
            {
              agentId: agentB,
              // agent-b already occupies the one-seat room; its presence is
              // only visible in the global projection, not in partition A's.
              locationId: asLocationId('tiny-room'),
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

    const journalBefore = verifySimulationWideAuthorityJournal({ rootDir, simulationId });
    expect(() =>
      authority.settleMove({
        operationId: 'move-over-capacity',
        workerId: 'worker-a',
        observedAt: 1,
        durationMs: 100,
        agentId: agentA,
        targetLocationId: 'tiny-room',
      }),
    ).toThrow(/at capacity/);
    const journalAfter = verifySimulationWideAuthorityJournal({ rootDir, simulationId });
    expect(journalAfter.recordCount).toBe(journalBefore.recordCount);
    expect(journalAfter.valid).toBe(true);
  });

  test('writes the audit journal as a verifiable hash chain and fails closed on tamper', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'aivilization-authority-chain-'));
    const authority = createAuthority(rootDir);
    authority.settleTrade({
      operationId: 'trade-chain-1',
      workerId: 'worker-a',
      observedAt: 1,
      durationMs: 100,
      agentId: agentA,
      trade: { side: 'buy', commodityName: 'Fish', quantity: 1 },
    });
    authority.settleTrade({
      operationId: 'trade-chain-2',
      workerId: 'worker-a',
      observedAt: 2,
      durationMs: 100,
      agentId: agentB,
      trade: { side: 'buy', commodityName: 'Fish', quantity: 1 },
    });

    const verification = verifySimulationWideAuthorityJournal({ rootDir, simulationId });
    expect(verification.valid).toBe(true);
    expect(verification.recordCount).toBeGreaterThanOrEqual(4);
    expect(verification.latestChainHash).not.toBe(
      SIMULATION_WIDE_AUTHORITY_JOURNAL_GENESIS_CHAIN_HASH,
    );

    // Tamper with the first record body; the recomputed chain must break at it.
    const journalPath = join(
      rootDir,
      'simulation-wide-authority',
      encodeURIComponent('unified-town'),
      'operations.jsonl',
    );
    const lines = readFileSync(journalPath, 'utf8').trimEnd().split('\n');
    const firstLine = JSON.parse(lines[0]!) as { recordedAt: number };
    firstLine.recordedAt = firstLine.recordedAt + 1;
    lines[0] = JSON.stringify(firstLine);
    writeFileSync(journalPath, `${lines.join('\n')}\n`);

    const tampered = verifySimulationWideAuthorityJournal({ rootDir, simulationId });
    expect(tampered.valid).toBe(false);
    expect(tampered.firstBrokenRecordIndex).toBe(0);

    // A fresh authority over the tampered journal fails during bootstrap,
    // before any caller can read or extend the compromised state.
    expect(() => createAuthority(rootDir)).toThrow(/journal chain is broken/);
  });

  test('reloads the journal tail when alternating durable writers acquire the lease', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'aivilization-authority-alternating-writers-'));
    const firstWriter = createAuthority(rootDir);
    const secondWriter = createAuthority(rootDir);
    firstWriter.settleTrade({
      operationId: 'alternating-writer-trade-1',
      workerId: 'worker-a',
      observedAt: 1,
      durationMs: 100,
      agentId: agentA,
      trade: { side: 'buy', commodityName: 'Fish', quantity: 1 },
    });
    secondWriter.settleTrade({
      operationId: 'alternating-writer-trade-2',
      workerId: 'worker-b',
      observedAt: 2,
      durationMs: 100,
      agentId: agentB,
      trade: { side: 'buy', commodityName: 'Fish', quantity: 1 },
    });
    firstWriter.syncPartitionAgentLocations({
      operationId: 'alternating-writer-location-sync-3',
      workerId: 'worker-a',
      observedAt: 3,
      durationMs: 100,
      partitionKey: partitionA,
      agentLocations: [{ agentId: agentA, locationId: 'town-square' }],
    });

    expect(verifySimulationWideAuthorityJournal({ rootDir, simulationId })).toMatchObject({
      valid: true,
      recordCount: 6,
    });
    expect(createAuthority(rootDir).getSnapshot().revision).toBe(3);
  });

  test('a successor authority instance continues the same durable ledger', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'aivilization-authority-succession-'));
    const first = createAuthority(rootDir);
    const firstTrade = first.settleTrade({
      operationId: 'trade-succession-1',
      workerId: 'worker-a',
      observedAt: 1,
      durationMs: 100,
      agentId: agentA,
      trade: { side: 'buy', commodityName: 'Fish', quantity: 1 },
    });
    const fencingTokenAfterFirst = first.getSnapshot().latestFencingToken;
    const revisionAfterFirst = first.getSnapshot().revision;

    // A second instance over the same durable root is the deployment shape for
    // a restarted or separately-launched worker process: it must observe ONE
    // shared ledger, replay idempotently, and continue monotonically.
    const second = createAuthority(rootDir);
    expect(second.getSnapshot().revision).toBe(revisionAfterFirst);

    const replay = second.settleTrade({
      operationId: 'trade-succession-1',
      workerId: 'worker-b',
      observedAt: 2,
      durationMs: 100,
      agentId: agentA,
      trade: { side: 'buy', commodityName: 'Fish', quantity: 1 },
    });
    expect(replay).toEqual(firstTrade);
    expect(second.getSnapshot().revision).toBe(revisionAfterFirst);

    second.settleTrade({
      operationId: 'trade-succession-2',
      workerId: 'worker-b',
      observedAt: 3,
      durationMs: 100,
      agentId: agentB,
      trade: { side: 'buy', commodityName: 'Fish', quantity: 1 },
    });
    const after = second.getSnapshot();
    expect(after.latestFencingToken).toBeGreaterThan(fencingTokenAfterFirst);
    expect(after.revision).toBe(revisionAfterFirst + 1);
    expect(after.projection.marketPools['Fish']?.commodityReserve).toBe(98);
    expect(verifySimulationWideAuthorityJournal({ rootDir, simulationId }).valid).toBe(true);
  });

  test('fails closed when the authority state is missing but its journal survives', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'aivilization-authority-missing-state-'));
    const authority = createAuthority(rootDir);
    authority.settleTrade({
      operationId: 'trade-before-state-loss',
      workerId: 'worker-a',
      observedAt: 1,
      durationMs: 100,
      agentId: agentA,
      trade: { side: 'buy', commodityName: 'Fish', quantity: 1 },
    });
    rmSync(
      join(rootDir, 'simulation-wide-authority', encodeURIComponent('unified-town'), 'state.json'),
    );

    expect(() => createAuthority(rootDir)).toThrow(
      /state is missing while its audit journal exists.*restore the state from backup/,
    );
  });

  test('fails closed when committed state survives without its matching journal intent', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'aivilization-authority-missing-journal-'));
    const authority = createAuthority(rootDir);
    authority.settleTrade({
      operationId: 'trade-before-journal-loss',
      workerId: 'worker-a',
      observedAt: 1,
      durationMs: 100,
      agentId: agentA,
      trade: { side: 'buy', commodityName: 'Fish', quantity: 1 },
    });
    rmSync(
      join(
        rootDir,
        'simulation-wide-authority',
        encodeURIComponent('unified-town'),
        'operations.jsonl',
      ),
    );

    expect(() => createAuthority(rootDir)).toThrow(/has no matching audit intent/);
  });

  test('rejects a corrupt financial aggregate in the authority state snapshot', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'aivilization-authority-corrupt-bank-'));
    createAuthority(rootDir);
    const statePath = join(
      rootDir,
      'simulation-wide-authority',
      encodeURIComponent('unified-town'),
      'state.json',
    );
    const persisted = JSON.parse(readFileSync(statePath, 'utf8')) as {
      projection: { bank?: unknown };
    };
    persisted.projection.bank = {
      balance: -1,
      deposits: {},
      loans: {},
      creditHistoryByAgent: {},
    };
    writeFileSync(statePath, `${JSON.stringify(persisted, null, 2)}\n`);

    expect(() => createAuthority(rootDir)).toThrow(/bank balance must be non-negative finite/);
  });

  test('rejects a persisted authority snapshot with impossible location occupancy', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'aivilization-authority-corrupt-capacity-'));
    createAuthority(rootDir);
    const statePath = join(
      rootDir,
      'simulation-wide-authority',
      encodeURIComponent('unified-town'),
      'state.json',
    );
    const persisted = JSON.parse(readFileSync(statePath, 'utf8')) as {
      projection: { locations: Record<string, { capacity: number | null }> };
    };
    persisted.projection.locations['town-square']!.capacity = 1;
    writeFileSync(statePath, `${JSON.stringify(persisted, null, 2)}\n`);

    expect(() => createAuthority(rootDir)).toThrow(
      'location town-square occupancy 2 exceeds capacity 1',
    );
  });

  test('keeps the global projection fresh through partition location syncs', () => {
    const authority = createAuthority(undefined, true, {
      agentALocationId: 'market',
      agentBLocationId: 'market',
    });

    // Seed locations differ from the owner partitions' durable reality: both
    // Agents actually stand in the town square after local movement.
    const sync = authority.syncPartitionAgentLocations({
      operationId: 'sync-a-1',
      workerId: 'worker-a',
      observedAt: 1,
      durationMs: 100,
      partitionKey: partitionA,
      agentLocations: [{ agentId: agentA, locationId: 'town-square' }],
      agentStates: [
        {
          ...authority.getSnapshot().projection.agents[agentA]!,
          locationId: asLocationId('town-square'),
          balance: 25,
          inventory: { Fish: 2 },
        },
      ],
    });
    const syncB = authority.syncPartitionAgentLocations({
      operationId: 'sync-b-1',
      workerId: 'worker-b',
      observedAt: 1,
      durationMs: 100,
      partitionKey: partitionB,
      agentLocations: [{ agentId: agentB, locationId: 'town-square' }],
    });

    expect(sync.updatedAgentIds).toEqual([agentA]);
    expect(syncB.updatedAgentIds).toEqual([agentB]);
    const snapshot = authority.getSnapshot();
    expect(snapshot.projection.agents[agentA]?.locationId).toBe(asLocationId('town-square'));
    expect(snapshot.projection.agents[agentA]).toMatchObject({
      balance: 25,
      inventory: { Fish: 2 },
    });
    expect(snapshot.projection.agents[agentB]?.locationId).toBe(asLocationId('town-square'));

    // Without the sync the conversation below would settle against the stale
    // seed view (both Agents at market); with it the co-location check passes
    // against the reported reality.
    const conversation = authority.settleConversation({
      operationId: 'conversation-after-sync',
      workerId: 'worker-a',
      observedAt: 2,
      durationMs: 100,
      initiatorAgentId: agentA,
      targetAgentId: agentB,
      topic: 'town square routines',
      turns: [
        { speakerAgentId: agentA, utterance: 'Good to see you here.', intent: 'cooperate' },
        { speakerAgentId: agentB, utterance: 'Likewise.', intent: 'cooperate' },
      ],
    });
    expect(conversation.status).toBe('completed');

    // Location syncs are projection upkeep: they never enter any inbox.
    expect(
      authority.readInbox({ partitionKey: partitionA, consumerId: 'materializer-a' }).deliveries,
    ).toMatchObject([{ operationId: 'conversation-after-sync', operationKind: 'conversation' }]);
  });

  test('rejects partition syncs that violate global physical or residential capacity', () => {
    const physical = createAuthority(undefined, false, {
      agentALocationId: 'town-square',
      agentBLocationId: 'market',
      townSquareCapacity: 1,
    });
    expect(() =>
      physical.syncPartitionAgentLocations({
        operationId: 'invalid-physical-sync',
        workerId: 'worker-b',
        observedAt: 1,
        durationMs: 100,
        partitionKey: partitionB,
        agentLocations: [{ agentId: agentB, locationId: 'town-square' }],
      }),
    ).toThrow('location town-square occupancy 2 exceeds capacity 1');
    expect(physical.getSnapshot().projection.agents[agentB]?.locationId).toBe('market');
    expect(() =>
      physical.syncPartitionAgentLocations({
        operationId: 'invalid-unknown-location-sync',
        workerId: 'worker-b',
        observedAt: 1,
        durationMs: 100,
        partitionKey: partitionB,
        agentLocations: [{ agentId: agentB, locationId: 'missing-place' }],
      }),
    ).toThrow('simulation-wide Agent agent-b reports unknown location missing-place');

    const residential = createAuthority(undefined, false, {
      agentAResidenceLocationId: 'homes',
    });
    expect(() =>
      residential.syncPartitionAgentLocations({
        operationId: 'invalid-residence-sync',
        workerId: 'worker-b',
        observedAt: 1,
        durationMs: 100,
        partitionKey: partitionB,
        agentLocations: [{ agentId: agentB, locationId: 'town-square' }],
        agentStates: [
          {
            ...residential.getSnapshot().projection.agents[agentB]!,
            residenceLocationId: asLocationId('homes'),
          },
        ],
      }),
    ).toThrow('residence homes occupancy 2 exceeds capacity 1');
    expect(
      residential.getSnapshot().projection.agents[agentB]?.residenceLocationId,
    ).toBeUndefined();
  });

  test('publishes multi-partition fiscal totals only at an equal-clock barrier', () => {
    const authority = createAuthority();
    const sync = (
      partitionKey: PartitionKey,
      agentId: AgentId,
      clock: number,
      moneySupply: number,
      treasury: number,
    ) =>
      authority.syncPartitionAgentLocations({
        operationId: `fiscal-sync:${partitionKey}:${clock}`,
        workerId: `worker-${partitionKey}`,
        observedAt: clock,
        durationMs: 100,
        partitionKey,
        partitionClockNow: clock,
        agentLocations: [{ agentId, locationId: 'market' }],
        partitionAccounts: { moneySupply, treasury },
      });

    sync(partitionA, agentA, 1_000, 100, 10);
    // Partition B has not published this boundary, so the authority must keep
    // the previous complete fiscal view rather than expose a partial sum.
    expect(authority.getSnapshot().projection.moneySupply).toBe(1_000);
    sync(partitionB, agentB, 1_000, 200, 20);
    expect(authority.getSnapshot().projection).toMatchObject({
      moneySupply: 300,
      treasury: 30,
    });

    sync(partitionA, agentA, 2_000, 90, 5);
    expect(authority.getSnapshot().projection).toMatchObject({
      moneySupply: 300,
      treasury: 30,
    });
    sync(partitionB, agentB, 2_000, 180, 15);
    expect(authority.getSnapshot().projection).toMatchObject({
      moneySupply: 270,
      treasury: 20,
    });
  });

  test('rejects a location sync for Agents owned by another partition and replays idempotently', () => {
    const authority = createAuthority();

    expect(() =>
      authority.syncPartitionAgentLocations({
        operationId: 'sync-wrong-owner',
        workerId: 'worker-a',
        observedAt: 1,
        durationMs: 100,
        partitionKey: partitionA,
        agentLocations: [{ agentId: agentB, locationId: 'market' }],
      }),
    ).toThrow(/must come from owner partition/);

    const first = authority.syncPartitionAgentLocations({
      operationId: 'sync-a-idempotent',
      workerId: 'worker-a',
      observedAt: 1,
      durationMs: 100,
      partitionKey: partitionA,
      agentLocations: [{ agentId: agentA, locationId: 'market' }],
    });
    const revisionAfterFirst = authority.getSnapshot().revision;
    const replay = authority.syncPartitionAgentLocations({
      operationId: 'sync-a-idempotent',
      workerId: 'worker-a',
      observedAt: 99,
      durationMs: 100,
      partitionKey: partitionA,
      agentLocations: [{ agentId: agentA, locationId: 'market' }],
    });

    expect(replay).toEqual(first);
    expect(authority.getSnapshot().revision).toBe(revisionAfterFirst);
  });

  test('exposes a replayable partition inbox and advances its cursor exactly once', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'aivilization-authority-inbox-'));
    const authority = createAuthority(rootDir);
    authority.settleConversation({
      operationId: 'conversation-inbox-1',
      workerId: 'worker-a',
      observedAt: 1,
      durationMs: 100,
      initiatorAgentId: agentA,
      targetAgentId: agentB,
      topic: 'shared market',
      turns: [
        { speakerAgentId: agentA, utterance: 'What did you see at the market?', intent: 'ask' },
        { speakerAgentId: agentB, utterance: 'Fish is scarce today.', intent: 'inform' },
      ],
    });

    const firstRead = authority.readInbox({
      partitionKey: partitionA,
      consumerId: 'projection-materializer',
    });
    expect(firstRead.cursor).toBeUndefined();
    expect(firstRead.deliveries).toMatchObject([
      {
        operationId: 'conversation-inbox-1',
        fencingToken: 1,
        partitionKey: partitionA,
        operationKind: 'conversation',
      },
    ]);

    const acknowledgement = authority.acknowledgeInbox({
      operationId: 'materialize-partition-a-1',
      workerId: 'worker-a',
      observedAt: 2,
      durationMs: 100,
      partitionKey: partitionA,
      consumerId: 'projection-materializer',
      throughFencingToken: firstRead.deliveries[0]!.fencingToken,
    });
    const replay = authority.acknowledgeInbox({
      operationId: 'materialize-partition-a-1',
      workerId: 'worker-b',
      observedAt: 3,
      durationMs: 100,
      partitionKey: partitionA,
      consumerId: 'projection-materializer',
      throughFencingToken: 1,
    });
    const restarted = createAuthority(rootDir);

    expect(replay).toEqual(acknowledgement);
    expect(
      restarted.readInbox({ partitionKey: partitionA, consumerId: 'projection-materializer' }),
    ).toMatchObject({
      cursor: {
        partitionKey: partitionA,
        consumerId: 'projection-materializer',
        throughFencingToken: 1,
      },
      deliveries: [],
    });
  });

  test('rolls a persisted operation forward when the audit completion record is missing', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'aivilization-authority-recovery-'));
    const authority = createAuthority(rootDir);
    authority.settleTrade({
      operationId: 'trade-needs-recovery',
      workerId: 'worker-a',
      observedAt: 1,
      durationMs: 100,
      agentId: agentA,
      trade: { side: 'buy', commodityName: 'Fish', quantity: 1 },
    });
    const journalPath = join(
      rootDir,
      'simulation-wide-authority',
      simulationId,
      'operations.jsonl',
    );
    const durableRows = readFileSync(journalPath, 'utf8')
      .split('\n')
      .filter((row) => row.length > 0)
      .filter((row) => !row.includes('"recordType":"completed"'));
    writeFileSync(journalPath, `${durableRows.join('\n')}\n`);

    expect(
      createAuthority(rootDir).recover({
        workerId: 'recovery-worker',
        observedAt: 2,
        durationMs: 100,
      }),
    ).toEqual(['trade-needs-recovery']);
    expect(readFileSync(journalPath, 'utf8')).toContain('"recordType":"completed"');
  });

  test('fails closed while a non-expired writer lease is held and recovers an expired lease', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'aivilization-authority-lock-'));
    const authority = createAuthority(rootDir);
    const lockDir = join(rootDir, 'simulation-wide-authority', simulationId, '.writer-lease');
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(
      join(lockDir, 'lease.json'),
      JSON.stringify({ workerId: 'other', expiresAt: 100 }),
    );

    expect(() =>
      authority.settleTrade({
        operationId: 'blocked',
        workerId: 'worker-a',
        observedAt: 10,
        durationMs: 10,
        agentId: agentA,
        trade: { side: 'buy', commodityName: 'Fish', quantity: 1 },
      }),
    ).toThrow('unexpired writer lease');

    expect(() =>
      authority.settleTrade({
        operationId: 'after-expiry',
        workerId: 'worker-a',
        observedAt: 101,
        durationMs: 10,
        agentId: agentA,
        trade: { side: 'buy', commodityName: 'Fish', quantity: 1 },
      }),
    ).not.toThrow();
  });
});

describe('authority petition settlement', () => {
  function lease() {
    return { workerId: 'worker-a', observedAt: 1, durationMs: 1000 } as const;
  }

  test('settles raise and sign on the authority and delivers events to every partition', () => {
    const baseResolver = createAivilizationWorldCommandPolicies('authority-test');
    const authority = createAuthority(undefined, false, {}, (projection) => ({
      ...baseResolver(projection),
      collectiveAction: createAivilizationCollectiveActionPolicy(),
    }));
    const raised = authority.settlePetition({
      operationId: 'petition-raise-1',
      ...lease(),
      agentId: agentA,
      commandType: 'AgentRaisePetition',
      payload: { topic: 'street-lights', statement: 'The square is dark at night.' },
    });
    if (raised.kind !== 'petition') throw new Error('expected petition operation');
    expect(raised.petitionId).toBe(`simulation-wide-petition-petition-raise-1:petition`);
    expect(raised.events.map((event) => event.type)).toContain('PetitionRaised');
    expect(
      authority
        .getSnapshot()
        .projection.petitions?.some(
          (petition) => petition.petitionId === raised.petitionId && petition.status === 'open',
        ),
    ).toBe(true);

    // Both partitions receive the full event set (town-wide shared truth).
    for (const partitionKey of [partitionA, partitionB]) {
      const inbox = authority.readInbox({ partitionKey, consumerId: 'materializer-test' });
      expect(
        inbox.deliveries.some(
          (delivery) =>
            delivery.operationId === 'petition-raise-1' &&
            delivery.events.some((event) => event.type === 'PetitionRaised'),
        ),
      ).toBe(true);
    }

    // Second signature from the other partition aggregates on the same petition.
    const signed = authority.settlePetition({
      operationId: 'petition-sign-1',
      ...lease(),
      agentId: agentB,
      commandType: 'AgentSignPetition',
      payload: { petitionId: raised.petitionId },
    });
    if (signed.kind !== 'petition') throw new Error('expected petition operation');
    expect(signed.events.map((event) => event.type)).toContain('PetitionSigned');
    expect(
      authority
        .getSnapshot()
        .projection.petitions?.find((petition) => petition.petitionId === raised.petitionId)
        ?.signatureAgentIds,
    ).toEqual([agentA, agentB]);
  });
});

describe('authority governance settlement', () => {
  test('enacts one operator policy change and broadcasts the replayable fact without moving money', () => {
    const baseResolver = createAivilizationWorldCommandPolicies('authority-governance-test');
    const authority = createAuthority(undefined, false, {}, (projection) => ({
      ...baseResolver(projection),
      governance: createAivilizationTownGovernancePolicy(),
    }));
    const before = authority.getSnapshot().projection;

    const operation = authority.settleGovernance({
      operationId: 'governance-tax-1',
      workerId: 'worker-a',
      observedAt: 1,
      durationMs: 1_000,
      commandType: 'SetTaxPolicy',
      payload: {
        neutralRate: 0.12,
        incomeTaxBrackets: [{ upToAmount: null, rate: 0.12 }],
        tradeTaxRate: 0.06,
        reason: 'Fund stable public services',
        expectedGovernanceRevision: 0,
      },
      humanAttribution: {
        principalSubjectId: 'operator-1',
        principalRoles: ['operator'],
        accessPolicyVersion: 'access-v1',
        consentPolicyVersion: 'consent-v1',
      },
    });
    const after = authority.getSnapshot().projection;

    expect(operation).toMatchObject({
      kind: 'governance',
      governanceRevision: 1,
      status: 'completed',
      events: [{ type: 'GovernancePolicyChanged', payload: { policyKind: 'tax' } }],
    });
    expect(after.governance).toMatchObject({
      revision: 1,
      tax: { neutralRate: 0.12, tradeTaxRate: 0.06 },
      lastChangedBy: { kind: 'operator', subjectId: 'operator-1' },
    });
    expect(after.moneySupply).toBe(before.moneySupply);
    expect(after.treasury).toBe(before.treasury);
    expect(after.agents[agentA]?.balance).toBe(before.agents[agentA]?.balance);
    expect(after.agents[agentB]?.balance).toBe(before.agents[agentB]?.balance);

    for (const partitionKey of [partitionA, partitionB]) {
      expect(
        authority
          .readInbox({ partitionKey, consumerId: 'governance-materializer' })
          .deliveries.some(
            (delivery) =>
              delivery.operationId === 'governance-tax-1' &&
              delivery.operationKind === 'governance',
          ),
      ).toBe(true);
    }
  });
});

describe('authority departure sync', () => {
  function lease() {
    return { workerId: 'worker-a', observedAt: 1, durationMs: 1000 } as const;
  }

  test('a reported departure removes the ghost resident from the authority ledger', () => {
    const basePolicies = createAivilizationWorldCommandPolicies('authority-departure-test');
    const authority = createAuthority(undefined, false, {}, (projection) => ({
      ...basePolicies(projection),
      socialMatters: createAivilizationSocialMattersPolicy(),
    }));
    // Baseline: the authority knows agentA (partition A) and agentB.
    expect(authority.getSnapshot().ownerPartitionKeyByAgentId[agentA]).toBe(partitionA);
    authority.settleCredit({
      operationId: 'deposit-before-reported-departure',
      ...lease(),
      agentId: agentA,
      commandType: 'AgentDeposit',
      payload: { amount: 100 },
    });
    authority.settleCredit({
      operationId: 'loan-before-reported-departure',
      ...lease(),
      agentId: agentA,
      commandType: 'AgentRequestLoan',
      payload: { amount: 50 },
    });
    const raisedMatter = authority.settleMatter({
      operationId: 'matter-before-reported-departure',
      ...lease(),
      agentId: agentA,
      commandType: 'AgentRaiseMatter',
      payload: { topic: 'departure-help', statement: 'Please finish this after I leave.' },
    });
    const matterId = raisedMatter.events.find((event) => event.type === 'MatterRaised')?.payload
      .matter.matterId;
    if (matterId === undefined) throw new Error('expected raised matter');
    authority.syncPartitionAgentLocations({
      operationId: 'location-sync-departure-runtime-baseline',
      ...lease(),
      partitionKey: partitionA,
      agentLocations: [{ agentId: agentA, locationId: 'town-square' }],
      partitionRuntimeState: {
        activityTimeByAgent: {
          [agentA]: {
            agentId: agentA,
            activity: 'labor',
            commandType: 'AgentWork',
            policyVersion: 'exclusive-agent-activity-time-v1',
            settlementTiming: 'effects-at-commit',
            startedAt: 0,
            durationSeconds: 10,
            availableAt: 10_000,
            committedAt: 0,
          },
        },
        transitByAgent: {
          [agentA]: {
            agentId: agentA,
            fromLocationId: asLocationId('town-square'),
            toLocationId: asLocationId('market'),
            routeLocationIds: [asLocationId('town-square'), asLocationId('market')],
            spatialPolicyVersion: 'spatial-test-v1',
            baseTravelDurationSeconds: 10,
            congestionMultiplier: 1,
            travelDurationSeconds: 10,
            departedAt: 0,
            arrivesAt: 10_000,
            reason: 'test',
          },
        },
        timeSettlementByAgent: { [agentA]: 500 },
        physiologicalDistressByAgent: {
          [agentA]: {
            policyVersion: 'physiological-safety-net-test',
            distressStartedAt: 0,
            lowAxes: ['satiety'],
            lastGrantedAt: null,
          },
        },
      },
    });

    // The router reports its CURRENT residents (the departed one is absent
    // from the location list) plus the departure of the previously reported
    // agent it no longer holds.
    const first = authority.syncPartitionAgentLocations({
      operationId: 'location-sync-departure-1',
      ...lease(),
      partitionKey: partitionA,
      agentLocations: [],
      departedAgentIds: [agentA],
    });
    if (first.kind !== 'location-sync') throw new Error('expected location-sync');
    expect(first.removedAgentIds).toEqual([agentA]);
    const snapshot = authority.getSnapshot();
    expect(snapshot.projection.agents[agentA]).toBeUndefined();
    expect(snapshot.ownerPartitionKeyByAgentId[agentA]).toBeUndefined();
    expect(snapshot.projection.activityTimeByAgent[agentA]).toBeUndefined();
    expect(snapshot.projection.transitByAgent?.[agentA]).toBeUndefined();
    expect(snapshot.projection.timeSettlementByAgent?.[agentA]).toBeUndefined();
    expect(snapshot.projection.physiologicalDistressByAgent[agentA]).toBeUndefined();
    expect(snapshot.projection.bank?.deposits[agentA]).toBeUndefined();
    expect(
      Object.values(snapshot.projection.bank?.loans ?? {}).filter(
        (loan) => loan.borrowerAgentId === agentA && loan.status === 'active',
      ),
    ).toEqual([]);
    expect(snapshot.projection.socialMatters?.[matterId]?.status).toBe('closed');
    expect(first.events.map((event) => event.type)).toEqual([
      'LoanWrittenOff',
      'DepositForfeited',
      'MatterClosed',
      'TownBankSnapshotRecorded',
    ]);
    const replicaDeparture = authority
      .readInbox({ partitionKey: partitionB, consumerId: 'departure-bank-replica' })
      .deliveries.find((delivery) => delivery.operationId === 'location-sync-departure-1');
    expect(replicaDeparture?.events.map((event) => event.type)).toEqual([
      'MatterClosed',
      'TownBankSnapshotRecorded',
    ]);
    // The other partition's resident is untouched.
    expect(snapshot.ownerPartitionKeyByAgentId[agentB]).toBe(partitionB);

    // Idempotent replay: a crash re-issues the same sync; the already-removed
    // id is skipped and nothing else changes.
    const replay = authority.syncPartitionAgentLocations({
      operationId: 'location-sync-departure-1',
      ...lease(),
      partitionKey: partitionA,
      agentLocations: [],
      departedAgentIds: [agentA],
    });
    expect(replay).toEqual(first);
    expect(() =>
      authority.syncPartitionAgentLocations({
        operationId: 'location-sync-departure-1',
        ...lease(),
        partitionKey: partitionA,
        agentLocations: [],
        departedAgentIds: [agentB],
      }),
    ).toThrow('was reused with different input');

    // A departure report from the WRONG partition is rejected.
    expect(() =>
      authority.syncPartitionAgentLocations({
        operationId: 'location-sync-departure-wrong-owner',
        ...lease(),
        partitionKey: partitionA,
        agentLocations: [{ agentId: agentB, locationId: 'school' }],
        departedAgentIds: [agentB],
      }),
    ).toThrow('must come from owner partition');
  });

  test('rejects removal while an owner enterprise is still operational', () => {
    const authority = createAuthority();
    authority.syncPartitionAgentLocations({
      operationId: 'location-sync-enterprise-active',
      ...lease(),
      partitionKey: partitionA,
      agentLocations: [{ agentId: agentA, locationId: 'town-square' }],
      enterpriseStates: [
        {
          enterpriseId: 'enterprise-a',
          name: 'Enterprise A',
          ownerAgentId: agentA,
          occupationName: 'Cleaner',
          balance: 100,
          inventory: {},
          maxEmployees: 2,
          employeeAgentIds: [],
          status: 'active',
          foundedAt: 0,
          cumulativeSales: 0,
          cumulativePurchases: 0,
          cumulativeWages: 0,
        },
      ],
    });

    expect(() =>
      authority.syncPartitionAgentLocations({
        operationId: 'location-sync-enterprise-invalid-departure',
        ...lease(),
        partitionKey: partitionA,
        agentLocations: [],
        departedAgentIds: [agentA],
      }),
    ).toThrow('requires closed enterprise enterprise-a');
    expect(authority.getSnapshot().projection.agents[agentA]).toBeDefined();
  });
});

describe('authority lifecycle and memory-sync scoping', () => {
  function lease() {
    return {
      workerId: 'worker-a',
      observedAt: 1,
      durationMs: 1000,
    } as const;
  }

  test('authority time advance never settles owner-scoped lifecycle or starvation', () => {
    // The authority's per-agent view is partial and its advance command ids
    // differ from the partition's, so settling lifecycle there would derive a
    // SECOND set of life/death facts. resolvePolicies strips the policy.
    const baseResolver = createAivilizationWorldCommandPolicies('authority-test');
    const authority = createAuthority(
      undefined,
      false,
      {},
      (projection: Parameters<WorldCommandPolicyResolver>[0]) => ({
        ...baseResolver(projection),
        lifecycle: createAivilizationTownLifecyclePolicy(),
        starvation: {
          policyVersion: 'starvation-health-decay-v1',
          settlementCadenceMs: 3_600_000,
          dayLengthMs: 86_400_000,
          satietyThreshold: 101,
          healthDecayPerHourAtZeroSatiety: 1_000,
          minHealth: 0,
          deathHealthThreshold: 0,
        },
      }),
    );
    const operations = authority.advanceTime({
      operationId: 'advance-lifecycle-scoping',
      ...lease(),
      deltaMs: 200 * 86_400_000,
    });
    const lifecycleTypes = ['AgentAged', 'AgentRetired', 'PensionPaid', 'AgentDied'];
    for (const operation of operations) {
      expect(
        operation.events.filter(
          (event) =>
            lifecycleTypes.includes(event.type) ||
            (event.type === 'PhysiologyChanged' && event.payload.reason === 'starvation'),
        ),
      ).toEqual([]);
    }
  });

  test('admits demand-driven residents once, balances ownership, and delivers only to owners', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'aivilization-authority-migration-'));
    const basePolicies = createAivilizationWorldCommandPolicies('authority-migration-test');
    const policies: WorldCommandPolicyResolver = (projection) => ({
      ...basePolicies(projection),
      residentialAssignment: {
        policyVersion: 'residential-assignment-test-v1',
        arrivalSelection: 'most-vacancies-then-location-id',
      },
      migration: {
        policyVersion: 'town-migration-test-v3',
        maxProbabilityPerHour: 1,
        fallbackWellbeing: 100,
        settlementCadenceMs: 86_400_000,
        inMigration: {
          settlementCadenceMs: 86_400_000,
          maximumArrivalsPerCadence: 10,
          minimumAttractiveWellbeing: 0,
          housingDemandWeight: 1,
          jobDemandWeight: 0,
        },
      },
    });
    const authority = createSimulationWideAuthority({
      rootDir,
      policies,
      seed: {
        manifestId: 'migration-manifest',
        simulationId,
        partitionKeys: [partitionA, partitionB],
        owners: [
          { agentId: agentA, partitionKey: partitionA },
          { agentId: agentB, partitionKey: partitionB },
        ],
        partitionAccountsByKey: {
          [partitionA]: { moneySupply: 500, treasury: 0 },
          [partitionB]: { moneySupply: 500, treasury: 0 },
        },
        projection: createWorldProjection({
          clock: { now: 0, tickDurationMs: 1_000 },
          locations: [
            {
              locationId: asLocationId('residential-block'),
              name: 'Residential block',
              kind: 'residence',
              activityAffinities: ['rest'],
              capacity: 4,
            },
          ],
          agents: [
            {
              agentId: agentA,
              locationId: asLocationId('residential-block'),
              physiology: { energy: 100, satiety: 100, health: 100 },
              educationScore: 0,
              balance: 500,
              residentialTier: 1,
              job: null,
              inventory: {},
              wellbeing: 100,
            },
            {
              agentId: agentB,
              locationId: asLocationId('residential-block'),
              physiology: { energy: 100, satiety: 100, health: 100 },
              educationScore: 0,
              balance: 500,
              residentialTier: 1,
              job: null,
              inventory: {},
              wellbeing: 100,
            },
          ],
          marketPools: [],
          moneySupply: 1_000,
        }),
      },
    });
    const request = {
      operationId: 'migration-two-days',
      workerId: 'worker-a',
      observedAt: 172_800_000,
      durationMs: 100,
      deltaMs: 172_800_000,
    } as const;

    const [operation] = authority.advanceTime(request);
    if (operation?.kind !== 'time-advanced') throw new Error('expected time advance');
    const registrations = operation.events.filter((event) => event.type === 'AgentRegistered');
    expect(registrations).toHaveLength(2);
    expect(operation.registeredAgents?.map((entry) => entry.ownerPartitionKey)).toEqual([
      partitionA,
      partitionB,
    ]);
    expect(registrations[0]?.payload.migrationArrival).toMatchObject({
      migrationPolicyVersion: 'town-migration-test-v3',
      settledAt: 86_400_000,
      populationBefore: 2,
      residentialCapacity: 4,
      housingVacancies: 2,
    });
    const snapshot = authority.getSnapshot();
    expect(Object.keys(snapshot.projection.agents)).toHaveLength(4);
    expect(snapshot.projection.moneySupply).toBe(1_200);
    expect(snapshot.partitionAccountsByKey?.[partitionA]?.moneySupply).toBe(600);
    expect(snapshot.partitionAccountsByKey?.[partitionB]?.moneySupply).toBe(600);

    const deliveryA = authority
      .readInbox({ partitionKey: partitionA, consumerId: 'migration-a' })
      .deliveries.find((delivery) => delivery.operationId === request.operationId);
    const deliveryB = authority
      .readInbox({ partitionKey: partitionB, consumerId: 'migration-b' })
      .deliveries.find((delivery) => delivery.operationId === request.operationId);
    expect(deliveryA?.events.filter((event) => event.type === 'AgentRegistered')).toHaveLength(1);
    expect(deliveryB?.events.filter((event) => event.type === 'AgentRegistered')).toHaveLength(1);
    expect(authority.advanceTime(request)).toEqual([operation]);
    expect(Object.keys(authority.getSnapshot().projection.agents)).toHaveLength(4);
  });

  test('location sync merges memory records idempotently into the bounded authority cache', () => {
    const authority = createAuthority();
    const record = createShortTermMemoryRecord({
      id: 'memory-sync-1',
      agentId: asAgentId(agentA),
      kind: 'action',
      status: 'succeeded',
      summary: 'Repaired the well pump.',
      occurredAt: 10,
      importanceScore: 0.7,
      source: { eventIds: [] },
      tags: ['repair'],
    });
    const request = {
      operationId: 'location-sync-memory-1',
      partitionKey: partitionA,
      ...lease(),
      agentLocations: [{ agentId: agentA, locationId: 'market' }],
      newMemoryRecords: [record],
    };
    const first = authority.syncPartitionAgentLocations(request);
    if (first.kind !== 'location-sync') throw new Error('expected location-sync');
    expect(first.mergedMemoryRecordIds).toEqual(['memory-sync-1']);
    expect(
      authority
        .getSnapshot()
        .projection.memoryRecords.some((existing) => existing.id === 'memory-sync-1'),
    ).toBe(true);

    // Idempotent replay: a crash re-issues the same sync; the journal returns
    // the recorded operation verbatim and create() never re-runs — the cache
    // keeps exactly one copy of the record.
    const replay = authority.syncPartitionAgentLocations({ ...request });
    expect(replay).toEqual(first);
    expect(
      authority
        .getSnapshot()
        .projection.memoryRecords.filter((existing) => existing.id === 'memory-sync-1'),
    ).toHaveLength(1);
  });

  test('settles construction once and broadcasts only global capacity facts to non-owners', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'aivilization-authority-construction-'));
    const basePolicies = createAivilizationWorldCommandPolicies('construction-test', undefined, {
      townConstruction: true,
    });
    const authority = createSimulationWideAuthority({
      rootDir,
      policies: (projection) => ({
        ...basePolicies(projection),
        migration: {
          policyVersion: 'construction-migration-test-v3',
          maxProbabilityPerHour: 1,
          fallbackWellbeing: 50,
          settlementCadenceMs: 86_400_000,
          inMigration: {
            settlementCadenceMs: 86_400_000,
            maximumArrivalsPerCadence: 5,
            minimumAttractiveWellbeing: 0,
            housingDemandWeight: 1,
            jobDemandWeight: 0,
          },
        },
      }),
      seed: {
        manifestId: 'construction-manifest',
        simulationId,
        partitionKeys: [partitionA, partitionB],
        owners: [
          { agentId: agentA, partitionKey: partitionA },
          { agentId: agentB, partitionKey: partitionB },
        ],
        projection: createWorldProjection({
          locations: [
            {
              locationId: asLocationId('residential-block'),
              name: 'Residential block',
              kind: 'residence',
              activityAffinities: ['residential'],
              capacity: 2,
            },
          ],
          agents: [
            {
              agentId: agentA,
              locationId: asLocationId('residential-block'),
              physiology: { energy: 100, satiety: 100, health: 100 },
              educationScore: 0,
              balance: 100,
              residentialTier: 1,
              job: null,
              inventory: { Wood: 3 },
            },
            {
              agentId: agentB,
              locationId: asLocationId('residential-block'),
              physiology: { energy: 100, satiety: 100, health: 100 },
              educationScore: 0,
              balance: 100,
              residentialTier: 1,
              job: null,
              inventory: {},
            },
          ],
          moneySupply: 200,
        }),
      },
    });
    const request = {
      operationId: 'construction-1',
      workerId: 'worker-a',
      observedAt: 1,
      durationMs: 100,
      builderAgentId: agentA,
      housing: { locationId: asLocationId('residential-block') },
    } as const;

    const operation = authority.settleConstruction(request);
    expect(operation.events.map((event) => event.type)).toEqual([
      'InventoryChanged',
      'HousingCapacityExpanded',
      'ShortTermMemoryRecorded',
    ]);
    expect(authority.getSnapshot().projection.locations['residential-block']?.capacity).toBe(7);
    expect(authority.getSnapshot().projection.agents[agentA]?.inventory).toEqual({ Wood: 1 });
    const ownerDelivery = authority
      .readInbox({ partitionKey: partitionA, consumerId: 'construction-owner' })
      .deliveries.find((delivery) => delivery.operationId === request.operationId);
    const remoteDelivery = authority
      .readInbox({ partitionKey: partitionB, consumerId: 'construction-remote' })
      .deliveries.find((delivery) => delivery.operationId === request.operationId);
    expect(ownerDelivery?.events).toHaveLength(3);
    expect(remoteDelivery?.events.map((event) => event.type)).toEqual(['HousingCapacityExpanded']);
    expect(authority.settleConstruction(request)).toEqual(operation);
    expect(authority.getSnapshot().projection.locations['residential-block']?.capacity).toBe(7);

    const [advance] = authority.advanceTime({
      operationId: 'construction-followed-by-migration',
      workerId: 'worker-a',
      observedAt: 86_400_000,
      durationMs: 100,
      deltaMs: 86_400_000,
    });
    if (advance?.kind !== 'time-advanced') throw new Error('expected time advance');
    expect(advance.events.some((event) => event.type === 'AgentRegistered')).toBe(true);
    expect(authority.getSnapshot().projection.locations['residential-block']?.capacity).toBe(7);
  });

  test('serializes the final residence vacancy across partitions', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'aivilization-authority-residence-'));
    const existingResident = asAgentId('agent-existing-resident');
    const basePolicies = createAivilizationWorldCommandPolicies('residence-test', undefined, {
      townConstruction: true,
    });
    const authority = createSimulationWideAuthority({
      rootDir,
      policies: basePolicies,
      seed: {
        manifestId: 'residence-manifest',
        simulationId,
        partitionKeys: [partitionA, partitionB],
        owners: [
          { agentId: agentA, partitionKey: partitionA },
          { agentId: agentB, partitionKey: partitionB },
          { agentId: existingResident, partitionKey: partitionA },
        ],
        projection: createWorldProjection({
          locations: [
            {
              locationId: asLocationId('last-home'),
              name: 'Last home',
              kind: 'residence',
              activityAffinities: [],
              capacity: 2,
            },
            {
              locationId: asLocationId('away'),
              name: 'Away',
              kind: 'social',
              activityAffinities: [],
              capacity: null,
            },
          ],
          agents: [
            ...[agentA, agentB].map((agentId) => ({
              agentId,
              locationId: asLocationId('last-home'),
              residenceLocationId: null,
              physiology: { energy: 100, satiety: 100, health: 100 },
              educationScore: 0,
              balance: 0,
              residentialTier: 1,
              job: null,
              inventory: {},
            })),
            {
              agentId: existingResident,
              locationId: asLocationId('away'),
              residenceLocationId: asLocationId('last-home'),
              physiology: { energy: 100, satiety: 100, health: 100 },
              educationScore: 0,
              balance: 0,
              residentialTier: 1,
              job: null,
              inventory: {},
            },
          ],
        }),
      },
    });
    const first = authority.settleResidence({
      operationId: 'residence-a',
      ...lease(),
      agentId: agentA,
      residence: { locationId: asLocationId('last-home') },
    });
    expect(first.events[0]).toMatchObject({
      type: 'AgentResidenceChanged',
      payload: { occupancyBefore: 1, occupancyAfter: 2 },
    });
    expect(() =>
      authority.settleResidence({
        operationId: 'residence-b',
        ...lease(),
        agentId: agentB,
        residence: { locationId: asLocationId('last-home') },
      }),
    ).toThrow('residence-full');
    expect(authority.getSnapshot().projection.agents[agentB]?.residenceLocationId).toBeNull();
  });
});

function createAuthority(
  rootDir = mkdtempSync(join(tmpdir(), 'aivilization-authority-')),
  usesTravelRoute = false,
  seedLocationOverrides: {
    readonly agentALocationId?: string;
    readonly agentBLocationId?: string;
    readonly agentAResidenceLocationId?: string | null;
    readonly townSquareCapacity?: number;
    readonly agentAInventory?: Readonly<Record<string, number>>;
  } = {},
  policies: WorldCommandPolicyResolver = createAivilizationWorldCommandPolicies('authority-test'),
) {
  return createSimulationWideAuthority({
    rootDir,
    policies,
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
            capacity: seedLocationOverrides.townSquareCapacity ?? 20,
            ...(usesTravelRoute
              ? {
                  connections: [
                    { targetLocationId: asLocationId('market'), travelDurationSeconds: 10 },
                  ],
                }
              : {}),
          },
          {
            locationId: asLocationId('market'),
            name: 'Market',
            kind: 'market',
            activityAffinities: ['trade'],
            capacity: 20,
            ...(usesTravelRoute
              ? {
                  connections: [
                    { targetLocationId: asLocationId('town-square'), travelDurationSeconds: 10 },
                  ],
                }
              : {}),
          },
          {
            locationId: asLocationId('homes'),
            name: 'Homes',
            kind: 'residence',
            activityAffinities: ['sleep'],
            capacity: 1,
          },
        ],
        agents: [
          {
            agentId: agentA,
            locationId: asLocationId(seedLocationOverrides.agentALocationId ?? 'town-square'),
            ...(seedLocationOverrides.agentAResidenceLocationId === undefined
              ? {}
              : {
                  residenceLocationId:
                    seedLocationOverrides.agentAResidenceLocationId === null
                      ? null
                      : asLocationId(seedLocationOverrides.agentAResidenceLocationId),
                }),
            physiology: { energy: 100, satiety: 100, health: 100 },
            educationScore: 0,
            balance: 500,
            residentialTier: 1,
            job: null,
            inventory: seedLocationOverrides.agentAInventory ?? {},
          },
          {
            agentId: agentB,
            locationId: asLocationId(seedLocationOverrides.agentBLocationId ?? 'town-square'),
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
