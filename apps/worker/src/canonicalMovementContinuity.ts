import { isDeepStrictEqual } from 'node:util';
import type { WorldProjection } from '@aivilization/world';
import type { SimulationWideAuthoritySnapshot } from './simulationWideAuthority';

/** Preserve already committed same-owner travel. This never completes or re-prices a trip. */
export function retainCanonicalSameOwnerMove(input: {
  readonly authority: SimulationWideAuthoritySnapshot;
  readonly agentId: string;
  readonly ownerProjection: WorldProjection | undefined;
}) {
  const { authority, agentId, ownerProjection } = input;
  const pending = authority.pendingMoves?.[agentId];
  const owner = authority.ownerPartitionKeyByAgentId[agentId];
  const transit = authority.projection.transitByAgent?.[agentId];
  if (
    !pending ||
    !owner ||
    !ownerProjection ||
    !transit ||
    pending.ownerPartitionKey !== owner ||
    pending.destinationPartitionKey !== owner ||
    pending.cognitiveSnapshot !== undefined ||
    authority.pendingTransfers[agentId] !== undefined ||
    transit.agentId !== agentId ||
    authority.projection.agents[agentId]?.locationId !== transit.fromLocationId ||
    !isDeepStrictEqual(ownerProjection.transitByAgent?.[agentId], transit) ||
    !Number.isFinite(transit.departedAt) ||
    !Number.isFinite(transit.arrivesAt) ||
    transit.departedAt > authority.projection.clock.now ||
    transit.arrivesAt <= authority.projection.clock.now
  )
    return undefined;
  const stored = authority.operations[pending.operationId];
  const operation = stored?.operation;
  if (
    !operation ||
    operation.kind !== 'move' ||
    operation.status !== 'in-transit' ||
    operation.operationId !== pending.operationId ||
    operation.agentId !== agentId ||
    operation.ownerPartitionKey !== owner ||
    operation.destinationPartitionKey !== owner ||
    operation.cognitiveSnapshot !== undefined ||
    operation.departureEvents !== undefined ||
    operation.arrivalEvents !== undefined
  )
    return undefined;
  const starts = operation.events.filter((e) => e.type === 'AgentTravelStarted');
  const activities = operation.events.filter((e) => e.type === 'AgentActivityTimeCommitted');
  if (
    starts.length !== 1 ||
    activities.length !== 1 ||
    !isDeepStrictEqual(starts[0]!.payload, transit) ||
    operation.events.some((e) => e.type === 'AgentLocationChanged')
  )
    return undefined;
  const activity = activities[0]!;
  const expectedActivity = { ...activity.payload, committedAt: activity.occurredAt };
  if (
    activity.payload.agentId !== agentId ||
    activity.payload.activity !== 'travel' ||
    activity.payload.startedAt !== transit.departedAt ||
    activity.payload.availableAt !== transit.arrivesAt ||
    !isDeepStrictEqual(ownerProjection.activityTimeByAgent[agentId], expectedActivity)
  )
    return undefined;
  return structuredClone({
    agentId,
    pending,
    operation: stored,
    transit,
    activity: expectedActivity,
  });
}
