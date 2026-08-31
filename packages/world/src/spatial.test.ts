import { asLocationId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';

import { createWorldProjection } from './projection';
import { resolveSpatialRoute } from './spatial';

function createLocations() {
  return createWorldProjection({
    agents: [],
    locations: [
      {
        locationId: asLocationId('a'),
        name: 'A',
        kind: 'residence',
        activityAffinities: [],
        capacity: 10,
        connections: [
          { targetLocationId: asLocationId('b'), travelDurationSeconds: 100 },
          { targetLocationId: asLocationId('c'), travelDurationSeconds: 130 },
        ],
      },
      {
        locationId: asLocationId('b'),
        name: 'B',
        kind: 'social',
        activityAffinities: [],
        capacity: 10,
        connections: [
          { targetLocationId: asLocationId('a'), travelDurationSeconds: 100 },
          { targetLocationId: asLocationId('d'), travelDurationSeconds: 100 },
        ],
      },
      {
        locationId: asLocationId('c'),
        name: 'C',
        kind: 'social',
        activityAffinities: [],
        capacity: 10,
        connections: [
          { targetLocationId: asLocationId('a'), travelDurationSeconds: 130 },
          { targetLocationId: asLocationId('d'), travelDurationSeconds: 130 },
        ],
      },
      {
        locationId: asLocationId('d'),
        name: 'D',
        kind: 'production',
        activityAffinities: [],
        capacity: 10,
        connections: [
          { targetLocationId: asLocationId('b'), travelDurationSeconds: 100 },
          { targetLocationId: asLocationId('c'), travelDurationSeconds: 130 },
        ],
      },
    ],
  }).locations;
}

describe('town spatial edge-flow congestion', () => {
  test('reroutes around a sufficiently congested directed path and freezes the observed flow', () => {
    const route = resolveSpatialRoute({
      locations: createLocations(),
      fromLocationId: asLocationId('a'),
      toLocationId: asLocationId('d'),
      destinationOccupancy: 0,
      activeTransits: Array.from({ length: 3 }, () => ({
        routeLocationIds: [asLocationId('a'), asLocationId('b'), asLocationId('d')],
      })),
    });

    expect(route).toMatchObject({
      locationIds: ['a', 'c', 'd'],
      baseTravelDurationSeconds: 260,
      edgeCongestionMultiplier: 1,
      destinationCongestionMultiplier: 1,
      congestionMultiplier: 1,
      travelDurationSeconds: 260,
      edgeFlows: [
        {
          fromLocationId: 'a',
          toLocationId: 'c',
          activeTraversalCount: 0,
          congestionMultiplier: 1,
        },
        {
          fromLocationId: 'c',
          toLocationId: 'd',
          activeTraversalCount: 0,
          congestionMultiplier: 1,
        },
      ],
    });
  });

  test('counts opposite-direction traffic separately and applies destination pressure afterward', () => {
    const route = resolveSpatialRoute({
      locations: createLocations(),
      fromLocationId: asLocationId('a'),
      toLocationId: asLocationId('b'),
      destinationOccupancy: 5,
      activeTransits: [
        { routeLocationIds: [asLocationId('a'), asLocationId('b')] },
        { routeLocationIds: [asLocationId('a'), asLocationId('b')] },
        { routeLocationIds: [asLocationId('b'), asLocationId('a')] },
      ],
    });

    expect(route).toMatchObject({
      locationIds: ['a', 'b'],
      baseTravelDurationSeconds: 100,
      edgeCongestionMultiplier: 1.15,
      destinationCongestionMultiplier: 1.25,
      congestionMultiplier: 1.4375,
      travelDurationSeconds: 144,
      edgeFlows: [
        {
          fromLocationId: 'a',
          toLocationId: 'b',
          activeTraversalCount: 2,
          congestionMultiplier: 1.15,
        },
      ],
    });
  });
});
