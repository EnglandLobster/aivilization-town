import type { LocationId } from '@aivilization/sim-core';

import type { WorldAgentTransitState, WorldLocationState } from './projection';

export const TOWN_SPATIAL_GRAPH_POLICY_VERSION = 'town-spatial-graph-v2';
export const TOWN_SPATIAL_CONGESTION_MAX_DELAY_RATIO = 0.5;
export const TOWN_SPATIAL_EDGE_REFERENCE_FLOW = 2;
export const TOWN_SPATIAL_EDGE_DELAY_FACTOR = 0.15;
export const TOWN_SPATIAL_EDGE_DELAY_EXPONENT = 4;
export const TOWN_SPATIAL_EDGE_MAX_DELAY_RATIO = 2;

export type SpatialRouteEdgeFlow = {
  readonly fromLocationId: LocationId;
  readonly toLocationId: LocationId;
  /** Active traversals already committed before this route is selected. */
  readonly activeTraversalCount: number;
  readonly congestionMultiplier: number;
};

export type SpatialRoute = {
  readonly locationIds: readonly LocationId[];
  readonly edgeFlows: readonly SpatialRouteEdgeFlow[];
  readonly baseTravelDurationSeconds: number;
  readonly edgeCongestionMultiplier: number;
  readonly destinationCongestionMultiplier: number;
  readonly congestionMultiplier: number;
  readonly travelDurationSeconds: number;
};

export function createTownSpatialGraphPolicyManifest() {
  return {
    policyVersion: TOWN_SPATIAL_GRAPH_POLICY_VERSION,
    provenance: 'repository-design-calibrated-to-canonical-pixel-map',
    coordinateSystem: 'normalized-map-space-origin-top-left',
    routing: 'minimum-edge-congestion-adjusted-travel-duration',
    edgeSemantics: 'bidirectional-explicit-edges',
    capacitySemantics: 'destination-occupancy-reserved-at-move-commit',
    congestion: {
      destination: {
        basis: 'destination-occupancy-before-arrival-divided-by-capacity',
        maximumDelayRatio: TOWN_SPATIAL_CONGESTION_MAX_DELAY_RATIO,
      },
      edgeFlow: {
        accounting: 'each-active-transit-counts-on-every-directed-route-edge-until-arrival',
        formula: '1+min(maxDelayRatio,delayFactor*(activeFlow/referenceFlow)^exponent)',
        referenceFlow: TOWN_SPATIAL_EDGE_REFERENCE_FLOW,
        delayFactor: TOWN_SPATIAL_EDGE_DELAY_FACTOR,
        exponent: TOWN_SPATIAL_EDGE_DELAY_EXPONENT,
        maximumDelayRatio: TOWN_SPATIAL_EDGE_MAX_DELAY_RATIO,
      },
    },
    travelSettlement:
      'origin-retained-during-transit-destination-capacity-reserved-at-commit-arrival-event-emitted-when-clock-crosses-arrivesAt',
    unplacedAgentSemantics: 'first-placement-has-zero-travel-duration',
    legacyLocationSemantics: 'locations-without-connections-retain-direct-zero-duration-movement',
  } as const;
}

export function resolveSpatialRoute(input: {
  readonly locations: Readonly<Record<string, WorldLocationState>>;
  readonly fromLocationId: LocationId | null;
  readonly toLocationId: LocationId;
  readonly destinationOccupancy: number;
  readonly activeTransits?: readonly Pick<WorldAgentTransitState, 'routeLocationIds'>[];
}): SpatialRoute | null {
  const activeFlowByEdge = countActiveTransitFlowByEdge(input.activeTransits ?? []);
  if (input.fromLocationId === null) {
    return createRoute({
      locationIds: [input.toLocationId],
      baseTravelDurationSeconds: 0,
      edgeAdjustedTravelDurationSeconds: 0,
      destination: input.locations[input.toLocationId],
      destinationOccupancy: 0,
      activeFlowByEdge,
    });
  }

  const source = input.locations[input.fromLocationId];
  const destination = input.locations[input.toLocationId];
  if (source === undefined || destination === undefined) {
    return null;
  }

  if (source.connections === undefined && destination.connections === undefined) {
    return createRoute({
      locationIds: [input.fromLocationId, input.toLocationId],
      baseTravelDurationSeconds: 0,
      edgeAdjustedTravelDurationSeconds: 0,
      destination,
      destinationOccupancy: input.destinationOccupancy,
      activeFlowByEdge,
    });
  }

  const distanceByLocation = new Map<LocationId, number>([[input.fromLocationId, 0]]);
  const baseDistanceByLocation = new Map<LocationId, number>([[input.fromLocationId, 0]]);
  const previousByLocation = new Map<LocationId, LocationId>();
  const unvisited = new Set<LocationId>(
    Object.values(input.locations).map((location) => location.locationId),
  );

  while (unvisited.size > 0) {
    let currentLocationId: LocationId | undefined;
    let currentDistance = Number.POSITIVE_INFINITY;
    for (const locationId of unvisited) {
      const candidateDistance = distanceByLocation.get(locationId) ?? Number.POSITIVE_INFINITY;
      if (
        candidateDistance < currentDistance ||
        (candidateDistance === currentDistance &&
          (currentLocationId === undefined || locationId.localeCompare(currentLocationId) < 0))
      ) {
        currentLocationId = locationId;
        currentDistance = candidateDistance;
      }
    }
    if (currentLocationId === undefined || !Number.isFinite(currentDistance)) {
      break;
    }
    if (currentLocationId === input.toLocationId) {
      break;
    }
    unvisited.delete(currentLocationId);

    for (const connection of input.locations[currentLocationId]?.connections ?? []) {
      if (!unvisited.has(connection.targetLocationId)) {
        continue;
      }
      const edgeFlow =
        activeFlowByEdge.get(
          createDirectedEdgeKey(currentLocationId, connection.targetLocationId),
        ) ?? 0;
      const candidateDistance =
        currentDistance +
        connection.travelDurationSeconds * resolveEdgeCongestionMultiplier(edgeFlow);
      const knownDistance =
        distanceByLocation.get(connection.targetLocationId) ?? Number.POSITIVE_INFINITY;
      if (candidateDistance < knownDistance) {
        distanceByLocation.set(connection.targetLocationId, candidateDistance);
        baseDistanceByLocation.set(
          connection.targetLocationId,
          (baseDistanceByLocation.get(currentLocationId) ?? 0) + connection.travelDurationSeconds,
        );
        previousByLocation.set(connection.targetLocationId, currentLocationId);
      }
    }
  }

  const edgeAdjustedTravelDurationSeconds = distanceByLocation.get(input.toLocationId);
  const baseTravelDurationSeconds = baseDistanceByLocation.get(input.toLocationId);
  if (edgeAdjustedTravelDurationSeconds === undefined || baseTravelDurationSeconds === undefined) {
    return null;
  }

  const reversedPath: LocationId[] = [input.toLocationId];
  let cursor = input.toLocationId;
  while (cursor !== input.fromLocationId) {
    const previous = previousByLocation.get(cursor);
    if (previous === undefined) {
      return null;
    }
    reversedPath.push(previous);
    cursor = previous;
  }

  return createRoute({
    locationIds: reversedPath.reverse(),
    baseTravelDurationSeconds,
    edgeAdjustedTravelDurationSeconds,
    destination,
    destinationOccupancy: input.destinationOccupancy,
    activeFlowByEdge,
  });
}

function createRoute(input: {
  readonly locationIds: readonly LocationId[];
  readonly baseTravelDurationSeconds: number;
  readonly edgeAdjustedTravelDurationSeconds: number;
  readonly destination: WorldLocationState | undefined;
  readonly destinationOccupancy: number;
  readonly activeFlowByEdge: ReadonlyMap<string, number>;
}): SpatialRoute {
  const occupancyRatio =
    input.destination?.capacity === null || input.destination?.capacity === undefined
      ? 0
      : Math.min(1, input.destinationOccupancy / input.destination.capacity);
  const destinationCongestionMultiplier =
    1 + occupancyRatio * TOWN_SPATIAL_CONGESTION_MAX_DELAY_RATIO;
  const edgeCongestionMultiplier =
    input.baseTravelDurationSeconds === 0
      ? 1
      : input.edgeAdjustedTravelDurationSeconds / input.baseTravelDurationSeconds;
  const congestionMultiplier = edgeCongestionMultiplier * destinationCongestionMultiplier;
  const edgeFlows = input.locationIds.slice(0, -1).map((fromLocationId, index) => {
    const toLocationId = input.locationIds[index + 1]!;
    const activeTraversalCount =
      input.activeFlowByEdge.get(createDirectedEdgeKey(fromLocationId, toLocationId)) ?? 0;
    return {
      fromLocationId,
      toLocationId,
      activeTraversalCount,
      congestionMultiplier: resolveEdgeCongestionMultiplier(activeTraversalCount),
    };
  });
  return {
    locationIds: [...input.locationIds],
    edgeFlows,
    baseTravelDurationSeconds: input.baseTravelDurationSeconds,
    edgeCongestionMultiplier,
    destinationCongestionMultiplier,
    congestionMultiplier,
    travelDurationSeconds: Math.ceil(
      input.edgeAdjustedTravelDurationSeconds * destinationCongestionMultiplier,
    ),
  };
}

function countActiveTransitFlowByEdge(
  activeTransits: readonly Pick<WorldAgentTransitState, 'routeLocationIds'>[],
): ReadonlyMap<string, number> {
  const flowByEdge = new Map<string, number>();
  for (const transit of activeTransits) {
    for (let index = 0; index < transit.routeLocationIds.length - 1; index += 1) {
      const fromLocationId = transit.routeLocationIds[index]!;
      const toLocationId = transit.routeLocationIds[index + 1]!;
      const edgeKey = createDirectedEdgeKey(fromLocationId, toLocationId);
      flowByEdge.set(edgeKey, (flowByEdge.get(edgeKey) ?? 0) + 1);
    }
  }
  return flowByEdge;
}

function createDirectedEdgeKey(fromLocationId: LocationId, toLocationId: LocationId): string {
  return `${fromLocationId}\u0000${toLocationId}`;
}

function resolveEdgeCongestionMultiplier(activeTraversalCount: number): number {
  const delayRatio = Math.min(
    TOWN_SPATIAL_EDGE_MAX_DELAY_RATIO,
    TOWN_SPATIAL_EDGE_DELAY_FACTOR *
      (activeTraversalCount / TOWN_SPATIAL_EDGE_REFERENCE_FLOW) ** TOWN_SPATIAL_EDGE_DELAY_EXPONENT,
  );
  return 1 + delayRatio;
}
