import type { LocationId } from '@aivilization/sim-core';

import type { WorldLocationState } from './projection';

export const TOWN_SPATIAL_GRAPH_POLICY_VERSION = 'town-spatial-graph-v1';
export const TOWN_SPATIAL_CONGESTION_MAX_DELAY_RATIO = 0.5;

export type SpatialRoute = {
  readonly locationIds: readonly LocationId[];
  readonly baseTravelDurationSeconds: number;
  readonly congestionMultiplier: number;
  readonly travelDurationSeconds: number;
};

export function createTownSpatialGraphPolicyManifest() {
  return {
    policyVersion: TOWN_SPATIAL_GRAPH_POLICY_VERSION,
    provenance: 'repository-design-calibrated-to-canonical-pixel-map',
    coordinateSystem: 'normalized-map-space-origin-top-left',
    routing: 'minimum-base-travel-duration',
    edgeSemantics: 'bidirectional-explicit-edges',
    capacitySemantics: 'destination-occupancy-reserved-at-move-commit',
    congestion: {
      basis: 'destination-occupancy-before-arrival-divided-by-capacity',
      maximumDelayRatio: TOWN_SPATIAL_CONGESTION_MAX_DELAY_RATIO,
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
}): SpatialRoute | null {
  if (input.fromLocationId === null) {
    return createRoute([input.toLocationId], 0, input.locations[input.toLocationId], 0);
  }

  const source = input.locations[input.fromLocationId];
  const destination = input.locations[input.toLocationId];
  if (source === undefined || destination === undefined) {
    return null;
  }

  if (source.connections === undefined && destination.connections === undefined) {
    return createRoute(
      [input.fromLocationId, input.toLocationId],
      0,
      destination,
      input.destinationOccupancy,
    );
  }

  const distanceByLocation = new Map<LocationId, number>([[input.fromLocationId, 0]]);
  const previousByLocation = new Map<LocationId, LocationId>();
  const unvisited = new Set<LocationId>(
    Object.values(input.locations).map((location) => location.locationId),
  );

  while (unvisited.size > 0) {
    let currentLocationId: LocationId | undefined;
    let currentDistance = Number.POSITIVE_INFINITY;
    for (const locationId of unvisited) {
      const candidateDistance = distanceByLocation.get(locationId) ?? Number.POSITIVE_INFINITY;
      if (candidateDistance < currentDistance) {
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
      const candidateDistance = currentDistance + connection.travelDurationSeconds;
      const knownDistance =
        distanceByLocation.get(connection.targetLocationId) ?? Number.POSITIVE_INFINITY;
      if (candidateDistance < knownDistance) {
        distanceByLocation.set(connection.targetLocationId, candidateDistance);
        previousByLocation.set(connection.targetLocationId, currentLocationId);
      }
    }
  }

  const baseTravelDurationSeconds = distanceByLocation.get(input.toLocationId);
  if (baseTravelDurationSeconds === undefined) {
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

  return createRoute(
    reversedPath.reverse(),
    baseTravelDurationSeconds,
    destination,
    input.destinationOccupancy,
  );
}

function createRoute(
  locationIds: readonly LocationId[],
  baseTravelDurationSeconds: number,
  destination: WorldLocationState | undefined,
  destinationOccupancy: number,
): SpatialRoute {
  const occupancyRatio =
    destination?.capacity === null || destination?.capacity === undefined
      ? 0
      : Math.min(1, destinationOccupancy / destination.capacity);
  const congestionMultiplier = 1 + occupancyRatio * TOWN_SPATIAL_CONGESTION_MAX_DELAY_RATIO;
  return {
    locationIds: [...locationIds],
    baseTravelDurationSeconds,
    congestionMultiplier,
    travelDurationSeconds: Math.ceil(baseTravelDurationSeconds * congestionMultiplier),
  };
}
