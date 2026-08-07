import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, test } from 'vitest';
import { asAgentId, asLocationId, asSimulationId, type PartitionKey } from '@aivilization/sim-core';
import { createWorldProjection } from '@aivilization/world';
import { createAivilizationWorldCommandPolicies } from './aivilizationWorldPolicies';
import {
  SIMULATION_WIDE_AUTHORITY_JOURNAL_GENESIS_CHAIN_HASH,
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

  test('commits cross-owner conversations against one global social graph', () => {
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
        { speakerAgentId: agentA, utterance: 'Could we coordinate fish supply?', intent: 'cooperate' },
        { speakerAgentId: agentB, utterance: 'Yes, I can share market information.', intent: 'cooperate' },
      ],
    });
    const snapshot = authority.getSnapshot();

    expect(result.sourcePartitionKey).toBe(partitionA);
    expect(result.targetPartitionKey).toBe(partitionB);
    expect(snapshot.projection.conversationRecords).toHaveLength(1);
    expect(Object.keys(snapshot.projection.socialRelations)).toHaveLength(2);
  });

  test('moves ownership only after the shared spatial command has committed', () => {
    const authority = createAuthority();

    const transfer = authority.transferAgent({
      operationId: 'transfer-1',
      workerId: 'worker-a',
      observedAt: 1,
      durationMs: 100,
      agentId: agentA,
      destinationPartitionKey: partitionB,
      destinationLocationId: 'market',
      reason: 'move to the shared market',
    });
    const snapshot = authority.getSnapshot();

    expect(transfer.status).toBe('completed');
    expect(snapshot.ownerPartitionKeyByAgentId[agentA]).toBe(partitionB);
    expect(snapshot.projection.agents[agentA]?.locationId).toBe(asLocationId('market'));
    expect(snapshot.pendingTransfers).toEqual({});
  });

  test('publishes a completed transfer to both owner inboxes after travel finishes', () => {
    const authority = createAuthority(undefined, true);
    const departure = authority.transferAgent({
      operationId: 'transfer-with-travel',
      workerId: 'worker-a',
      observedAt: 1,
      durationMs: 100,
      agentId: agentA,
      destinationPartitionKey: partitionB,
      destinationLocationId: 'market',
      reason: 'walk to market',
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
      completedTransfers: [
        {
          operationId: 'transfer-with-travel',
          agentId: agentA,
          sourcePartitionKey: partitionA,
          destinationPartitionKey: partitionB,
        },
      ],
    });
    expect(
      authority.readInbox({ partitionKey: partitionB, consumerId: 'owner-transfer-materializer' })
        .deliveries,
    ).toMatchObject([
      { operationId: 'transfer-with-travel', operationKind: 'transfer' },
      { operationId: 'advance-transfer', operationKind: 'time-advanced' },
    ]);
    expect(authority.getSnapshot().ownerPartitionKeyByAgentId[agentA]).toBe(partitionB);
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

  test('settles an immediate cross-owner move with paired ownership events and snapshot delivery', () => {
    const authority = createAuthority();
    const snapshot = createTestCognitiveSnapshot(agentA);

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
      expect(arrivalEvent.payload.agentState.locationId).toBe(asLocationId('market'));
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
    expect(
      sourceAfter[1]!.events.every(
        (event) => event.type === 'AgentOwnershipDeparted',
      ),
    ).toBe(true);
    const destinationAfter = authority.readInbox({
      partitionKey: partitionB,
      consumerId: 'materializer-b',
    }).deliveries;
    expect(destinationAfter).toMatchObject([{ operationKind: 'time-advanced' }]);
    expect(destinationAfter[0]!.cognitiveSnapshot).toEqual(snapshot);
    expect(
      destinationAfter[0]!.events.every(
        (event) => event.type === 'AgentOwnershipArrived',
      ),
    ).toBe(true);
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

    // A fresh authority over the tampered journal refuses further settlement
    // instead of silently extending a broken chain.
    const restarted = createAuthority(rootDir);
    expect(() =>
      restarted.settleTrade({
        operationId: 'trade-chain-3',
        workerId: 'worker-a',
        observedAt: 3,
        durationMs: 100,
        agentId: agentA,
        trade: { side: 'buy', commodityName: 'Fish', quantity: 1 },
      }),
    ).toThrow(/journal chain is broken/);
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
    expect(restarted.readInbox({ partitionKey: partitionA, consumerId: 'projection-materializer' }))
      .toMatchObject({
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
    const journalPath = join(rootDir, 'simulation-wide-authority', simulationId, 'operations.jsonl');
    const durableRows = readFileSync(journalPath, 'utf8')
      .split('\n')
      .filter((row) => row.length > 0)
      .filter((row) => !row.includes('"recordType":"completed"'));
    writeFileSync(journalPath, `${durableRows.join('\n')}\n`);

    expect(
      createAuthority(rootDir).recover({ workerId: 'recovery-worker', observedAt: 2, durationMs: 100 }),
    ).toEqual(['trade-needs-recovery']);
    expect(readFileSync(journalPath, 'utf8')).toContain('"recordType":"completed"');
  });

  test('fails closed while a non-expired writer lease is held and recovers an expired lease', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'aivilization-authority-lock-'));
    const authority = createAuthority(rootDir);
    const lockDir = join(rootDir, 'simulation-wide-authority', simulationId, '.writer-lease');
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, 'lease.json'), JSON.stringify({ workerId: 'other', expiresAt: 100 }));

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

function createAuthority(
  rootDir = mkdtempSync(join(tmpdir(), 'aivilization-authority-')),
  usesTravelRoute = false,
  seedLocationOverrides: {
    readonly agentALocationId?: string;
    readonly agentBLocationId?: string;
  } = {},
) {
  return createSimulationWideAuthority({
    rootDir,
    policies: createAivilizationWorldCommandPolicies('authority-test'),
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
        ],
        agents: [
          {
            agentId: agentA,
            locationId: asLocationId(seedLocationOverrides.agentALocationId ?? 'town-square'),
            physiology: { energy: 100, satiety: 100, health: 100 },
            educationScore: 0,
            balance: 500,
            residentialTier: 1,
            job: null,
            inventory: {},
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
