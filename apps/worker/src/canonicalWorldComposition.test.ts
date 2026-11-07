import { expect, test } from 'vitest';
import { createCommandEnvelope, asSimulationId } from '@aivilization/sim-core';
import {
  applyWorldEvent,
  handleAgentMoveToCommand,
  handleAdvanceSimulationTimeCommand,
  type WorldProjection,
  type WorldJobApplicationState,
} from '@aivilization/world';
import { createOpenSocietyManifest } from './openSociety/manifest';
import {
  composeCanonicalWorldBoundary,
  CANONICAL_WORLD_FIELD_SOURCES,
} from './canonicalWorldComposition';
import type { SimulationWideAuthoritySnapshot } from './simulationWideAuthority';
function fixture() {
  const world = createOpenSocietyManifest({
    count: 2,
    seed: 'world-migration-source',
  }).initialWorld;
  const agents = Object.entries(world.agents);
  const partitions = agents.map(([id, agent], i) => ({
    partitionKey: `p${i}`,
    consumerId: `consumer${i}`,
    projection: { ...world, agents: { [id]: agent }, moneySupply: world.moneySupply / 2 },
  }));
  const authority: SimulationWideAuthoritySnapshot = {
    schemaVersion: 'simulation-wide-authority-v1',
    authorityId: 'source',
    manifestId: 'manifest',
    simulationId: asSimulationId('source'),
    revision: 0,
    latestFencingToken: 0,
    projection: world,
    partitionKeys: partitions.map((p) => p.partitionKey),
    ownerPartitionKeyByAgentId: Object.fromEntries(agents.map(([id], i) => [id, `p${i}`])),
    partitionClockNowByKey: Object.fromEntries(
      partitions.map((p) => [p.partitionKey, world.clock.now]),
    ),
    partitionAccountsByKey: Object.fromEntries(
      partitions.map((p) => [
        p.partitionKey,
        {
          moneySupply: p.projection.moneySupply,
          ...(p.projection.treasury === undefined ? {} : { treasury: p.projection.treasury }),
        },
      ]),
    ),
    pendingTransfers: {},
    operations: {},
    materializerCursors: {},
  };
  return { authority, partitions };
}
function application(world: WorldProjection, id: string): WorldJobApplicationState {
  return {
    applicationId: id,
    cycleNumber: 0,
    agentId: Object.values(world.agents)[0]!.agentId,
    occupationName: 'Cleaner',
    residentialTier: 1,
    educationScore: 0,
    submittedAt: 0,
    status: 'pending',
  };
}
test('composes owner application and time facts without changing global money, stock or market truth', () => {
  const input = fixture();
  const p = input.partitions[0]!;
  const id = Object.keys(p.projection.agents)[0]!;
  const request = application(p.projection, 'pending-work');
  p.projection = {
    ...p.projection,
    jobApplications: [request],
    timeSettlementByAgent: { [id]: 0 },
  };
  const original = structuredClone(input);
  const result = composeCanonicalWorldBoundary(input);
  expect(result.status).toBe('composed');
  if (result.status !== 'composed') throw Error(JSON.stringify(result.issues));
  expect(result.projection.jobApplications).toEqual([request]);
  expect(result.projection.timeSettlementByAgent).toEqual({ [id]: 0 });
  expect(result.projection.moneySupply).toBe(input.authority.projection.moneySupply);
  expect(result.projection.marketPools).toEqual(input.authority.projection.marketPools);
  expect(result.projection.agents).toEqual(input.authority.projection.agents);
  expect(input).toEqual(original);
  expect(
    composeCanonicalWorldBoundary({ ...input, partitions: [...input.partitions].reverse() }),
  ).toEqual(result);
  expect(result.projection.agents).not.toBe(input.authority.projection.agents);
});
test('unpublished fiscal changes and lagging time reject instead of silently picking stale authority data', () => {
  const input = fixture();
  const p = input.partitions[0]!;
  p.projection = {
    ...p.projection,
    treasury: (p.projection.treasury ?? 0) + 1,
    clock: { ...p.projection.clock, now: 1 },
  };
  const result = composeCanonicalWorldBoundary(input);
  expect(result.status).toBe('blocked');
  expect(result).not.toHaveProperty('projection');
  expect(result.issues).toContainEqual({
    field: 'partitionAccounts',
    source: 'p0',
    reason: 'fiscal-boundary-not-published',
  });
  expect(result.issues.some((i) => i.reason === 'partition-clock-mismatch')).toBe(true);
});
test('different institutional cycles are not invented into one town-wide institution', () => {
  const input = fixture();
  input.partitions[0]!.projection = {
    ...input.partitions[0]!.projection,
    recruitmentCycles: [
      {
        cycleNumber: 0,
        cycleStartedAt: 0,
        cycleEndedAt: 1,
        completedAt: 1,
        policyVersion: 'old-partition-policy',
        applicationCount: 1,
        acceptedCount: 1,
        rejectedCount: 0,
      },
    ],
  };
  const result = composeCanonicalWorldBoundary(input);
  expect(result.status).toBe('blocked');
  expect(result.issues).toContainEqual({
    field: 'recruitmentCycles',
    source: 'p0',
    reason: 'source-values-disagree',
  });
});
test('unknown persisted fields and missing owner facts are explicit blockers', () => {
  const input = fixture();
  const id = Object.keys(input.authority.projection.agents)[0]!;
  const authority = {
    ...input.authority,
    projection: {
      ...input.authority.projection,
      timeSettlementByAgent: { [id]: 0 },
      futureDomain: { obligation: 'retain' },
    },
  };
  const result = composeCanonicalWorldBoundary({ ...input, authority });
  expect(result.status).toBe('blocked');
  expect(result.issues).toContainEqual({
    field: 'futureDomain',
    source: 'authority',
    reason: 'unmapped-world-field',
  });
  expect(result.issues).toContainEqual({
    field: 'timeSettlementByAgent',
    source: 'authority',
    reason: `owner-record-missing:${id}`,
  });
  expect(CANONICAL_WORLD_FIELD_SOURCES.residentExits).toBe('agreement');
});
test('colliding application IDs and copied wrong-owner records reject rather than deduplicate away responsibility', () => {
  const input = fixture();
  for (const p of input.partitions)
    p.projection = { ...p.projection, jobApplications: [application(p.projection, 'collision')] };
  const result = composeCanonicalWorldBoundary(input);
  expect(result.status).toBe('blocked');
  expect(result.issues.some((i) => i.reason === 'application-id-conflict:collision')).toBe(true);
  const first = input.partitions[0]!;
  input.partitions[1]!.projection = {
    ...input.partitions[1]!.projection,
    jobApplications: first.projection.jobApplications,
  };
  expect(
    composeCanonicalWorldBoundary(input).issues.some(
      (i) => i.reason === 'application-owner-conflict:collision',
    ),
  ).toBe(true);
});
test('legacy missing optional time map stays absent and history of departed residents is retained', () => {
  const input = fixture();
  const historical = {
    ...application(input.partitions[0]!.projection, 'old'),
    agentId:
      input.partitions[0]!.projection.agents[
        Object.keys(input.partitions[0]!.projection.agents)[0]!
      ]!.agentId,
  };
  const removed = historical.agentId;
  const projection = {
    ...input.authority.projection,
    agents: Object.fromEntries(
      Object.entries(input.authority.projection.agents).filter(([id]) => id !== removed),
    ),
  };
  const authority = {
    ...input.authority,
    projection,
    ownerPartitionKeyByAgentId: Object.fromEntries(
      Object.entries(input.authority.ownerPartitionKeyByAgentId).filter(([id]) => id !== removed),
    ),
  };
  input.partitions[0]!.projection = {
    ...input.partitions[0]!.projection,
    agents: {},
    jobApplications: [historical],
  };
  const result = composeCanonicalWorldBoundary({ ...input, authority });
  expect(result.status).toBe('composed');
  if (result.status !== 'composed') throw Error('unexpected blocked');
  expect(result.projection.jobApplications).toEqual([historical]);
  expect(result.projection).not.toHaveProperty('timeSettlementByAgent');
});

function movingFixture() {
  const input = fixture();
  const p = input.partitions[0]!;
  const id = Object.values(p.projection.agents)[0]!.agentId;
  const target = Object.keys(input.authority.projection.locations).find(
    (key) => key !== p.projection.agents[id]!.locationId,
  )!;
  const events = handleAgentMoveToCommand({
    command: createCommandEnvelope({
      id: 'move',
      simulationId: 'source',
      actorId: id,
      type: 'AgentMoveTo',
      payload: { targetLocationId: target },
      issuedAt: 0,
    }),
    projection: input.authority.projection,
    nextSequence: 1,
  });
  expect(events.some((e) => e.type === 'AgentTravelStarted')).toBe(true);
  p.projection = events.reduce(applyWorldEvent, p.projection);
  input.authority = {
    ...input.authority,
    projection: events.reduce(applyWorldEvent, input.authority.projection),
    revision: 1,
    latestFencingToken: 1,
    materializerCursors: {
      [`${p.partitionKey}:${p.consumerId}`]: {
        partitionKey: p.partitionKey,
        consumerId: p.consumerId,
        throughFencingToken: 1,
        materializedAt: 0,
      },
    },
    pendingMoves: {
      [id]: {
        operationId: 'move',
        ownerPartitionKey: p.partitionKey,
        destinationPartitionKey: p.partitionKey,
      },
    },
    operations: {
      move: {
        requestFingerprint: 'original-request',
        operation: {
          kind: 'move',
          operationId: 'move',
          fencingToken: 1,
          agentId: id,
          ownerPartitionKey: p.partitionKey,
          destinationPartitionKey: p.partitionKey,
          status: 'in-transit',
          events,
        },
      },
    },
  };
  // These read models are explicitly mirrored in this fixture; no unrelated source conflicts.
  for (const part of input.partitions)
    part.projection = {
      ...part.projection,
      memoryRecords: input.authority.projection.memoryRecords,
    };
  return { input, id, target };
}
test('explicit same-owner continuity preserves travel, original operation and actual arrival timing', () => {
  const { input, id, target } = movingFixture();
  const original = structuredClone(input);
  expect(composeCanonicalWorldBoundary(input).status).toBe('blocked');
  const result = composeCanonicalWorldBoundary({ ...input, movementContinuity: 'same-owner-v1' });
  if (result.status !== 'composed') throw Error(JSON.stringify(result.issues));
  expect(input).toEqual(original);
  expect(result.barrier.movementContinuity?.retainedMoves[0]?.operation).toEqual(
    input.authority.operations.move,
  );
  expect(result.projection.transitByAgent).toEqual(input.authority.projection.transitByAgent);
  expect(result.projection.agents[id]!.locationId).not.toBe(target);
  const arrival = result.projection.transitByAgent![id]!.arrivesAt;
  const advance = (projection: WorldProjection, deltaMs: number) =>
    handleAdvanceSimulationTimeCommand({
      command: createCommandEnvelope({
        id: `advance-${deltaMs}`,
        simulationId: 'source',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs },
        issuedAt: projection.clock.now,
      }),
      projection,
      nextSequence: 10,
    });
  const beforeEvents = advance(result.projection, arrival - result.projection.clock.now - 1);
  expect(beforeEvents.some((e) => e.type === 'AgentLocationChanged')).toBe(false);
  const beforeArrival = beforeEvents.reduce(applyWorldEvent, result.projection);
  const events = advance(beforeArrival, 1);
  expect(events.filter((e) => e.type === 'AgentLocationChanged')).toHaveLength(1);
  const arrived = events.reduce(applyWorldEvent, beforeArrival);
  expect(arrived.agents[id]!.locationId).toBe(target);
  expect(arrived.transitByAgent?.[id]).toBeUndefined();
  expect(advance(arrived, 1).some((e) => e.type === 'AgentLocationChanged')).toBe(false);
  expect(arrived.moneySupply).toBe(result.projection.moneySupply);
});
test('continuity cannot bypass cross-owner handoff, missing evidence or conflicting local travel', () => {
  for (const change of [
    'cross-owner',
    'missing-operation',
    'local-transit',
    'local-time',
  ] as const) {
    const { input, id } = movingFixture();
    if (change === 'cross-owner')
      input.authority = {
        ...input.authority,
        pendingMoves: {
          [id]: { ...input.authority.pendingMoves![id]!, destinationPartitionKey: 'p1' },
        },
      };
    if (change === 'missing-operation') input.authority = { ...input.authority, operations: {} };
    const p = input.partitions[0]!;
    if (change === 'local-transit') p.projection = { ...p.projection, transitByAgent: {} };
    if (change === 'local-time') p.projection = { ...p.projection, activityTimeByAgent: {} };
    const result = composeCanonicalWorldBoundary({ ...input, movementContinuity: 'same-owner-v1' });
    expect(result.status).toBe('blocked');
    expect(result).not.toHaveProperty('projection');
    expect(result.issues).toContainEqual({ field: 'barrier', source: id, reason: 'move-pending' });
  }
});
