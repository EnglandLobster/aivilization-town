import { asSimulationId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { createOpenSocietyManifest } from './openSociety/manifest';
import { inspectCanonicalSocietyBarrier } from './canonicalSocietyBarrier';
import {
  readSimulationWideAuthorityInbox,
  SIMULATION_WIDE_AUTHORITY_SCHEMA_VERSION,
  type SimulationWideAuthoritySnapshot,
} from './simulationWideAuthority';

function fixture() {
  const world = createOpenSocietyManifest({ count: 2, seed: 'cutover-barrier' }).initialWorld;
  const keys = ['a', 'b'];
  const agents = Object.entries(world.agents);
  const authority: SimulationWideAuthoritySnapshot = {
    schemaVersion: SIMULATION_WIDE_AUTHORITY_SCHEMA_VERSION,
    authorityId: 'source-authority',
    manifestId: 'source-manifest',
    simulationId: asSimulationId('cutover-source'),
    revision: 2,
    latestFencingToken: 2,
    projection: world,
    partitionKeys: keys,
    ownerPartitionKeyByAgentId: Object.fromEntries(agents.map(([id], i) => [id, keys[i]!])),
    partitionClockNowByKey: Object.fromEntries(keys.map((key) => [key, world.clock.now])),
    pendingTransfers: {},
    materializerCursors: {},
    operations: {},
  };
  const partitions = keys.map((partitionKey, i) => ({
    partitionKey,
    consumerId: `materializer-${partitionKey}`,
    projection: { ...world, agents: Object.fromEntries([agents[i]!]) },
  }));
  return { authority, partitions };
}

describe('canonical society source barrier', () => {
  test('coherent captured boundary is consistent, detached report does not mutate source', () => {
    const source = fixture();
    const before = structuredClone(source);
    const report = inspectCanonicalSocietyBarrier(source);
    expect(report).toMatchObject({ status: 'consistent', issues: [], revision: 2 });
    expect(report).not.toHaveProperty('migrationReady');
    expect(source).toEqual(before);
    expect(inspectCanonicalSocietyBarrier(structuredClone(source))).toEqual(report);
  });
  test('missing/extra/duplicate partitions and old missing clock metadata fail closed', () => {
    const { authority, partitions } = fixture();
    const { partitionClockNowByKey: _old, ...legacy } = authority;
    void _old;
    const result = inspectCanonicalSocietyBarrier({
      authority: legacy,
      partitions: [partitions[0]!, partitions[0]!, { ...partitions[0]!, partitionKey: 'unknown' }],
    });
    expect(result.status).toBe('blocked');
    expect(result.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining([
        'partition-missing',
        'partition-duplicate',
        'partition-unexpected',
        'published-clock-mismatch',
      ]),
    );
    expect(
      inspectCanonicalSocietyBarrier({
        authority: { ...authority, partitionKeys: [] },
        partitions: [],
      }).status,
    ).toBe('blocked');
  });
  test('stale cash or clock cannot overwrite the authoritative owner record', () => {
    const { authority, partitions } = fixture();
    const first = partitions[0]!;
    const [id, agent] = Object.entries(first.projection.agents)[0]!;
    const result = inspectCanonicalSocietyBarrier({
      authority,
      partitions: [
        {
          ...first,
          projection: {
            ...first.projection,
            clock: { ...first.projection.clock, now: first.projection.clock.now + 1 },
            agents: { [id]: { ...agent, balance: agent.balance + 1 } },
          },
        },
        partitions[1]!,
      ],
    });
    expect(result.issues).toContainEqual({ code: 'owner-state-mismatch', subject: id });
    expect(result.issues).toContainEqual({
      code: 'partition-clock-mismatch',
      subject: first.partitionKey,
    });
  });
  test('unowned, wrong-owner, unknown and duplicated residents cannot disappear in a merge', () => {
    const { authority, partitions } = fixture();
    const [id, agent] = Object.entries(authority.projection.agents)[0]!;
    const result = inspectCanonicalSocietyBarrier({
      authority: { ...authority, ownerPartitionKeyByAgentId: {} },
      partitions: [
        partitions[0]!,
        {
          ...partitions[1]!,
          projection: {
            ...partitions[1]!.projection,
            agents: { ...partitions[1]!.projection.agents, [id]: agent, ghost: agent },
          },
        },
      ],
    });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        { code: 'owner-missing', subject: id },
        { code: 'resident-duplicated', subject: id },
        { code: 'resident-unexpected', subject: 'ghost' },
      ]),
    );
    const wrong = inspectCanonicalSocietyBarrier({
      ...fixture(),
      authority: { ...authority, ownerPartitionKeyByAgentId: { [id]: 'unknown' } },
    });
    expect(wrong.issues).toContainEqual({ code: 'owner-invalid', subject: id });
  });
  test('in-flight handoffs remain blocking obligations even with matching balances', () => {
    const { authority, partitions } = fixture();
    const id = Object.keys(authority.projection.agents)[0]!;
    const result = inspectCanonicalSocietyBarrier({
      partitions,
      authority: {
        ...authority,
        pendingTransfers: {
          [id]: {
            operationId: 'transfer',
            sourcePartitionKey: partitions[0]!.partitionKey,
            destinationPartitionKey: partitions[1]!.partitionKey,
            destinationLocationId: 'destination',
          },
        },
        pendingMoves: {
          [id]: {
            operationId: 'move',
            ownerPartitionKey: partitions[0]!.partitionKey,
            destinationPartitionKey: partitions[1]!.partitionKey,
          },
        },
      },
    });
    expect(result.issues).toContainEqual({ code: 'transfer-pending', subject: id });
    expect(result.issues).toContainEqual({ code: 'move-pending', subject: id });
  });
  test('actual delivery token, not latest global fencing token, determines whether inbox drained', () => {
    const { authority, partitions } = fixture();
    const first = partitions[0]!;
    const withDelivery: SimulationWideAuthoritySnapshot = {
      ...authority,
      latestFencingToken: 9,
      operations: {
        rejected: {
          requestFingerprint: 'fingerprint',
          operation: {
            kind: 'command-rejected',
            commandType: 'AgentMoveTo',
            reason: 'test rejection',
            operationId: 'rejected',
            fencingToken: 3,
            partitionKey: first.partitionKey,
            status: 'rejected',
            events: [],
          },
        },
      },
    };
    expect(
      inspectCanonicalSocietyBarrier({ authority: withDelivery, partitions }).issues,
    ).toContainEqual({ code: 'inbox-pending', subject: first.partitionKey });
    const consumed = {
      ...withDelivery,
      materializerCursors: {
        [`${first.partitionKey}:${first.consumerId}`]: {
          partitionKey: first.partitionKey,
          consumerId: first.consumerId,
          throughFencingToken: 3,
          materializedAt: 10,
        },
      },
    };
    expect(inspectCanonicalSocietyBarrier({ authority: consumed, partitions }).status).toBe(
      'consistent',
    );
    expect(
      readSimulationWideAuthorityInbox(consumed, {
        partitionKey: first.partitionKey,
        consumerId: 'other',
      }).deliveries,
    ).toHaveLength(1);
    expect(() =>
      readSimulationWideAuthorityInbox(consumed, {
        partitionKey: first.partitionKey,
        consumerId: first.consumerId,
        limit: 0,
      }),
    ).toThrow();
    expect(
      inspectCanonicalSocietyBarrier({
        authority,
        partitions: [{ ...first, consumerId: '' }, partitions[1]!],
      }).issues,
    ).toContainEqual({ code: 'consumer-missing', subject: first.partitionKey });
  });
});
