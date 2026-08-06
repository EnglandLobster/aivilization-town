import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, test } from 'vitest';
import { asAgentId, asLocationId, asSimulationId, type PartitionKey } from '@aivilization/sim-core';
import { createWorldProjection } from '@aivilization/world';
import { createAivilizationWorldCommandPolicies } from './aivilizationWorldPolicies';
import { createSimulationWideAuthority } from './simulationWideAuthority';

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
            locationId: asLocationId('town-square'),
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
