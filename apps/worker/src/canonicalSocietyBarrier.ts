import { retainCanonicalSameOwnerMove } from './canonicalMovementContinuity';
import { isDeepStrictEqual } from 'node:util';
import type { PartitionKey } from '@aivilization/sim-core';
import type { WorldProjection } from '@aivilization/world';
import {
  readSimulationWideAuthorityInbox,
  type SimulationWideAuthoritySnapshot,
} from './simulationWideAuthority';

export type CanonicalSocietyPartitionBoundary = {
  readonly partitionKey: PartitionKey;
  /** The actual materializer identity, not a new consumer created for migration. */
  readonly consumerId: string;
  readonly projection: WorldProjection;
};
export type CanonicalSocietyBarrierIssue = {
  readonly code:
    | 'partition-set-invalid'
    | 'partition-missing'
    | 'partition-unexpected'
    | 'partition-duplicate'
    | 'partition-clock-mismatch'
    | 'published-clock-mismatch'
    | 'consumer-missing'
    | 'inbox-pending'
    | 'transfer-pending'
    | 'move-pending'
    | 'owner-missing'
    | 'owner-invalid'
    | 'owner-state-mismatch'
    | 'resident-unexpected'
    | 'resident-duplicated';
  readonly subject: string;
};
/** Necessary consistency barrier only. Does not fence writers or authorize/perform migration. */
export function inspectCanonicalSocietyBarrier(input: {
  readonly authority: SimulationWideAuthoritySnapshot;
  readonly partitions: readonly CanonicalSocietyPartitionBoundary[];
  readonly movementContinuity?: 'same-owner-v1';
}) {
  const { authority, partitions } = input;
  const issues: CanonicalSocietyBarrierIssue[] = [];
  const add = (code: CanonicalSocietyBarrierIssue['code'], subject: string) =>
    issues.push({ code, subject });
  const expected = new Set(authority.partitionKeys);
  if (expected.size === 0 || expected.size !== authority.partitionKeys.length)
    add('partition-set-invalid', authority.authorityId);
  const byKey = new Map<PartitionKey, CanonicalSocietyPartitionBoundary>();
  const appearances = new Map<string, PartitionKey[]>();
  for (const partition of partitions) {
    const key = partition.partitionKey;
    if (byKey.has(key)) add('partition-duplicate', key);
    else byKey.set(key, partition);
    if (!expected.has(key)) add('partition-unexpected', key);
    if (partition.projection.clock.now !== authority.projection.clock.now)
      add('partition-clock-mismatch', key);
    if (!partition.consumerId.trim()) add('consumer-missing', key);
    else if (expected.has(key)) {
      const inbox = readSimulationWideAuthorityInbox(authority, {
        partitionKey: key,
        consumerId: partition.consumerId,
        limit: 1,
      });
      if (inbox.deliveries.length) add('inbox-pending', key);
    }
    for (const id of Object.keys(partition.projection.agents)) {
      appearances.set(id, [...(appearances.get(id) ?? []), key]);
      if (!Object.hasOwn(authority.projection.agents, id)) add('resident-unexpected', id);
    }
  }
  for (const key of expected) {
    if (!byKey.has(key)) add('partition-missing', key);
    if (authority.partitionClockNowByKey?.[key] !== authority.projection.clock.now)
      add('published-clock-mismatch', key);
  }
  for (const id of Object.keys(authority.pendingTransfers)) add('transfer-pending', id);
  const retainedMoves = [];
  for (const id of Object.keys(authority.pendingMoves ?? {}).sort()) {
    const retained =
      input.movementContinuity === 'same-owner-v1'
        ? retainCanonicalSameOwnerMove({
            authority,
            agentId: id,
            ownerProjection: byKey.get(authority.ownerPartitionKeyByAgentId[id] ?? '')?.projection,
          })
        : undefined;
    if (retained) retainedMoves.push(retained);
    else add('move-pending', id);
  }
  for (const [id, keys] of appearances) {
    if (keys.length > 1) add('resident-duplicated', id);
  }
  for (const [id, owner] of Object.entries(authority.ownerPartitionKeyByAgentId)) {
    if (!expected.has(owner) || !Object.hasOwn(authority.projection.agents, id))
      add('owner-invalid', id);
  }
  for (const [id, agent] of Object.entries(authority.projection.agents)) {
    const owner = authority.ownerPartitionKeyByAgentId[id];
    if (!owner) add('owner-missing', id);
    else {
      const local = byKey.get(owner)?.projection.agents[id];
      if (!isDeepStrictEqual(local, agent)) add('owner-state-mismatch', id);
      if (appearances.get(id)?.some((key) => key !== owner)) add('owner-invalid', id);
    }
  }
  const ordered = issues.sort((a, b) =>
    a.code < b.code
      ? -1
      : a.code > b.code
        ? 1
        : a.subject < b.subject
          ? -1
          : a.subject > b.subject
            ? 1
            : 0,
  );
  return {
    version: input.movementContinuity
      ? ('canonical-society-barrier-v2' as const)
      : ('canonical-society-barrier-v1' as const),
    ...(input.movementContinuity
      ? { movementContinuity: { version: input.movementContinuity, retainedMoves } }
      : {}),
    status: ordered.length ? ('blocked' as const) : ('consistent' as const),
    authorityId: authority.authorityId,
    revision: authority.revision,
    latestFencingToken: authority.latestFencingToken,
    simulationTime: authority.projection.clock.now,
    issues: ordered,
  };
}
