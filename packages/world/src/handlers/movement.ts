import type { CommandEnvelope } from '@aivilization/sim-core';
import { assertAgentMoveToPayload, assertAgentObserveLocationPayload } from '../commands';
import type { WorldEvent } from '../events';
import type { WorldProjection } from '../projection';
import { resolveSpatialRoute, TOWN_SPATIAL_GRAPH_POLICY_VERSION } from '../spatial';
import type { handleAdvanceSimulationTimeCommand } from './timeAdvance';
import {
  makeAgentActivityTimeCommittedEvent,
  makeEvent,
  makeMemoryEvent,
  parsePayload,
  rejectCommand,
  resolveCommandAgent,
  stableUnique,
} from './shared';

export function handleAgentMoveToCommand(input: {
  readonly command: CommandEnvelope<'AgentMoveTo', unknown>;
  readonly projection: WorldProjection;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() => assertAgentMoveToPayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentMoveTo', payloadResult.reason);
  }

  const payload = payloadResult.payload;
  const targetLocation = input.projection.locations[payload.targetLocationId];
  if (targetLocation === undefined) {
    return rejectCommand(
      input,
      'AgentMoveTo',
      `unknown target location ${payload.targetLocationId}`,
    );
  }
  if (agent.locationId === payload.targetLocationId) {
    return rejectCommand(input, 'AgentMoveTo', `agent already at ${payload.targetLocationId}`);
  }

  const destinationOccupancy = Object.values(input.projection.agents).filter(
    (candidate) => candidate.locationId === payload.targetLocationId,
  ).length;
  const destinationReservations = Object.values(input.projection.transitByAgent ?? {}).filter(
    (transit) => transit.toLocationId === payload.targetLocationId,
  ).length;
  const destinationCapacityUsage = destinationOccupancy + destinationReservations;
  if (targetLocation.capacity !== null && destinationCapacityUsage >= targetLocation.capacity) {
    return rejectCommand(
      input,
      'AgentMoveTo',
      `target location ${payload.targetLocationId} is at capacity ${targetLocation.capacity}`,
    );
  }
  const route = resolveSpatialRoute({
    locations: input.projection.locations,
    fromLocationId: agent.locationId,
    toLocationId: payload.targetLocationId,
    destinationOccupancy: destinationCapacityUsage,
    activeTransits: Object.values(input.projection.transitByAgent ?? {}),
  });
  if (route === null) {
    return rejectCommand(
      input,
      'AgentMoveTo',
      `no route from ${agent.locationId ?? 'unplaced'} to ${payload.targetLocationId}`,
    );
  }
  const usesSpatialGraph =
    targetLocation.connections !== undefined ||
    (agent.locationId !== null &&
      input.projection.locations[agent.locationId]?.connections !== undefined);

  const events: WorldEvent[] = [];
  if (usesSpatialGraph && route.travelDurationSeconds > 0 && agent.locationId !== null) {
    events.push(
      makeEvent(input, events.length, 'AgentTravelStarted', {
        agentId: agent.agentId,
        fromLocationId: agent.locationId,
        toLocationId: payload.targetLocationId,
        routeLocationIds: route.locationIds,
        spatialPolicyVersion: TOWN_SPATIAL_GRAPH_POLICY_VERSION,
        baseTravelDurationSeconds: route.baseTravelDurationSeconds,
        congestionMultiplier: route.congestionMultiplier,
        edgeCongestionMultiplier: route.edgeCongestionMultiplier,
        destinationCongestionMultiplier: route.destinationCongestionMultiplier,
        routeEdgeFlows: route.edgeFlows,
        travelDurationSeconds: route.travelDurationSeconds,
        departedAt: input.projection.clock.now,
        arrivesAt: input.projection.clock.now + route.travelDurationSeconds * 1000,
        reason: payload.reason ?? 'move',
      }),
    );
  } else {
    events.push(
      makeEvent(input, events.length, 'AgentLocationChanged', {
        agentId: agent.agentId,
        previousLocationId: agent.locationId,
        nextLocationId: payload.targetLocationId,
        reason: payload.reason ?? 'move',
        ...(usesSpatialGraph
          ? {
              spatialPolicyVersion: TOWN_SPATIAL_GRAPH_POLICY_VERSION,
              routeLocationIds: route.locationIds,
              baseTravelDurationSeconds: route.baseTravelDurationSeconds,
              congestionMultiplier: route.congestionMultiplier,
              edgeCongestionMultiplier: route.edgeCongestionMultiplier,
              destinationCongestionMultiplier: route.destinationCongestionMultiplier,
              routeEdgeFlows: route.edgeFlows,
              travelDurationSeconds: route.travelDurationSeconds,
            }
          : {}),
      }),
    );
  }
  if (route.travelDurationSeconds > 0) {
    events.push(
      makeAgentActivityTimeCommittedEvent(input, events.length, {
        agentId: agent.agentId,
        activity: 'travel',
        commandType: 'AgentMoveTo',
        durationSeconds: route.travelDurationSeconds,
        settlementTiming: 'effects-at-completion',
      }),
    );
  }
  events.push(
    makeMemoryEvent(input, events.length, {
      summary:
        route.travelDurationSeconds === 0
          ? `Moved to ${targetLocation.name}.`
          : `Started traveling to ${targetLocation.name}; arrival is due in ${route.travelDurationSeconds} seconds via ${route.locationIds.join(' -> ')}.`,
      status: 'succeeded',
      tags: [
        'move',
        payload.targetLocationId,
        targetLocation.kind,
        ...(usesSpatialGraph ? [TOWN_SPATIAL_GRAPH_POLICY_VERSION] : []),
      ],
      consolidationHint: {
        kind: 'habit',
        patternKey: `move:${payload.targetLocationId}`,
        statement: usesSpatialGraph
          ? `Travels to ${targetLocation.name} when the current plan requires ${targetLocation.kind} activities; the route costs ${route.travelDurationSeconds} seconds under current congestion.`
          : `Moves to ${targetLocation.name} when the current plan requires ${targetLocation.kind} activities.`,
      },
    }),
  );
  return events;
}

export function handleAgentObserveLocationCommand(input: {
  readonly command: CommandEnvelope<'AgentObserveLocation', unknown>;
  readonly projection: WorldProjection;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() =>
    assertAgentObserveLocationPayload(input.command.payload),
  );
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentObserveLocation', payloadResult.reason);
  }

  if (agent.locationId === null) {
    return rejectCommand(input, 'AgentObserveLocation', 'agent location is unknown');
  }
  const location = input.projection.locations[agent.locationId];
  if (location === undefined) {
    return rejectCommand(
      input,
      'AgentObserveLocation',
      `unknown current location ${agent.locationId}`,
    );
  }

  const observedAgentIds = Object.values(input.projection.agents)
    .filter((candidate) => candidate.agentId !== agent.agentId)
    .filter((candidate) => candidate.locationId === agent.locationId)
    .map((candidate) => candidate.agentId)
    .sort((left, right) => left.localeCompare(right));
  const focus = payloadResult.payload.focus;
  const nearbySummary =
    observedAgentIds.length === 0 ? 'no agents nearby' : `${observedAgentIds.join(', ')} nearby`;

  return [
    makeEvent(input, 0, 'LocationObserved', {
      agentId: agent.agentId,
      locationId: location.locationId,
      locationName: location.name,
      observedAgentIds,
      activityAffinities: [...location.activityAffinities],
      ...(focus === undefined ? {} : { focus }),
    }),
    makeMemoryEvent(input, 1, {
      kind: 'observation',
      summary: `Observed ${location.name} with ${nearbySummary}.${
        focus === undefined ? '' : ` Focus: ${focus}.`
      }`,
      status: 'observed',
      tags: stableUnique([
        'observe',
        location.locationId,
        location.kind,
        ...location.activityAffinities,
        ...observedAgentIds,
      ]),
    }),
  ];
}

export function appendCompletedTravelArrivals(input: {
  readonly input: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
  readonly events: WorldEvent[];
  readonly nextSimulationTime: number;
}): void {
  const completed = Object.values(input.input.projection.transitByAgent ?? {})
    .filter((transit) => transit.arrivesAt <= input.nextSimulationTime)
    .sort((left, right) =>
      left.arrivesAt === right.arrivesAt
        ? left.agentId.localeCompare(right.agentId)
        : left.arrivesAt - right.arrivesAt,
    );
  for (const transit of completed) {
    input.events.push(
      makeEvent(input.input, input.events.length, 'AgentLocationChanged', {
        agentId: transit.agentId,
        previousLocationId: transit.fromLocationId,
        nextLocationId: transit.toLocationId,
        reason: 'travel-arrival',
        spatialPolicyVersion: transit.spatialPolicyVersion,
        routeLocationIds: transit.routeLocationIds,
        baseTravelDurationSeconds: transit.baseTravelDurationSeconds,
        congestionMultiplier: transit.congestionMultiplier,
        ...(transit.edgeCongestionMultiplier === undefined
          ? {}
          : { edgeCongestionMultiplier: transit.edgeCongestionMultiplier }),
        ...(transit.destinationCongestionMultiplier === undefined
          ? {}
          : { destinationCongestionMultiplier: transit.destinationCongestionMultiplier }),
        ...(transit.routeEdgeFlows === undefined
          ? {}
          : { routeEdgeFlows: transit.routeEdgeFlows.map((edge) => ({ ...edge })) }),
        travelDurationSeconds: transit.travelDurationSeconds,
      }),
    );
  }
}
