/**
 * Unit tests for the road-network geometry used by the living-town canvas.
 * The module under test (`client/map/logic/roads.js`) is a plain browser ES
 * module with no DOM dependencies.
 */
import { describe, expect, test } from 'vitest';
import {
  aggregateEdgeFlows,
  borderAnchor,
  computeRoadNetwork,
  congestionColor,
  congestionLevel,
  edgeKey,
  elbowWaypoints,
  positionAlongWaypoints,
  routeWaypointsForTransit,
  segmentDistance,
} from '../client/map/logic/roads.js';

const locations = {
  'town-square': {
    locationId: 'town-square',
    mapPosition: { x: 0.16, y: 0.22, width: 0.28, height: 0.35 },
    connections: [
      { targetLocationId: 'residential-block', travelDurationSeconds: 360 },
      { targetLocationId: 'clinic', travelDurationSeconds: 420 },
    ],
  },
  'residential-block': {
    locationId: 'residential-block',
    mapPosition: { x: 0.5, y: 0.22, width: 0.28, height: 0.37 },
    connections: [
      { targetLocationId: 'town-square', travelDurationSeconds: 360 },
      { targetLocationId: 'school', travelDurationSeconds: 360 },
    ],
  },
  school: {
    locationId: 'school',
    mapPosition: { x: 0.82, y: 0.22, width: 0.28, height: 0.38 },
    connections: [{ targetLocationId: 'residential-block', travelDurationSeconds: 360 }],
  },
  clinic: {
    locationId: 'clinic',
    mapPosition: { x: 0.14, y: 0.66, width: 0.25, height: 0.39 },
    connections: [{ targetLocationId: 'town-square', travelDurationSeconds: 420 }],
  },
  'unplaced-annex': {
    locationId: 'unplaced-annex',
    connections: [{ targetLocationId: 'school', travelDurationSeconds: 60 }],
  },
};

const network = computeRoadNetwork(locations);

describe('edgeKey', () => {
  test('is order-independent', () => {
    expect(edgeKey('a', 'b')).toBe(edgeKey('b', 'a'));
  });
});

describe('borderAnchor', () => {
  test('lands on the rect border toward the target', () => {
    const rect = { x: 0.5, y: 0.5, width: 0.2, height: 0.2 };
    const right = borderAnchor(rect, { x: 1, y: 0.5 });
    expect(right.x).toBeGreaterThan(rect.x + rect.width / 2 - 0.02);
    expect(right.x).toBeLessThanOrEqual(rect.x + rect.width / 2);
    const up = borderAnchor(rect, { x: 0.5, y: 0 });
    expect(up.y).toBeLessThan(rect.y - rect.height / 2 + 0.02);
    expect(up.y).toBeGreaterThanOrEqual(rect.y - rect.height / 2);
  });

  test('falls back to the center for a degenerate direction', () => {
    const rect = { x: 0.5, y: 0.5, width: 0.2, height: 0.2 };
    expect(borderAnchor(rect, { x: 0.5, y: 0.5 })).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe('computeRoadNetwork', () => {
  test('deduplicates bidirectional connections', () => {
    // town-square ↔ residential-block appears in both locations' lists.
    const count = network.edges.filter(
      (edge) => edge.key === edgeKey('town-square', 'residential-block'),
    ).length;
    expect(count).toBe(1);
  });

  test('covers every placed connection once', () => {
    expect(network.edges).toHaveLength(3);
    expect(network.waypointsByEdge.size).toBe(3);
  });

  test('skips connections to unplaced locations', () => {
    expect(network.waypointsByEdge.has(edgeKey('school', 'unplaced-annex'))).toBe(false);
  });

  test('produces axis-aligned segments inside the map', () => {
    for (const edge of network.edges) {
      expect(edge.waypoints.length).toBeGreaterThanOrEqual(2);
      for (let index = 1; index < edge.waypoints.length; index += 1) {
        const a = edge.waypoints[index - 1];
        const b = edge.waypoints[index];
        const axisAligned = Math.abs(a.x - b.x) < 1e-9 || Math.abs(a.y - b.y) < 1e-9;
        expect(axisAligned, `${edge.key} segment ${index}`).toBe(true);
      }
      for (const point of edge.waypoints) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(1);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(1);
      }
    }
  });

  test('is deterministic', () => {
    const again = computeRoadNetwork(locations);
    expect(again.edges).toEqual(network.edges);
  });
});

describe('elbowWaypoints', () => {
  test('keeps a straight run straight when both centers share an axis', () => {
    const a = { x: 0.2, y: 0.5, width: 0.1, height: 0.1 };
    const b = { x: 0.8, y: 0.5, width: 0.1, height: 0.1 };
    const waypoints = elbowWaypoints(a, b, 'flat');
    expect(waypoints).toHaveLength(2);
    expect(waypoints[0].y).toBeCloseTo(waypoints[1].y, 5);
  });
});

describe('routeWaypointsForTransit', () => {
  test('chains multi-hop routes through every intermediate stop', () => {
    const transit = {
      fromLocationId: 'clinic',
      toLocationId: 'school',
      routeLocationIds: ['clinic', 'town-square', 'residential-block', 'school'],
    };
    const chain = routeWaypointsForTransit(transit, locations, network);
    expect(chain).not.toBeNull();
    expect(chain.length).toBeGreaterThanOrEqual(4);
    // The path must touch each visited location's rect along the way.
    for (const stop of ['clinic', 'town-square', 'residential-block', 'school']) {
      const rect = locations[stop].mapPosition;
      const touches = chain.some(
        (point) =>
          Math.abs(point.x - rect.x) <= rect.width / 2 + 0.01 &&
          Math.abs(point.y - rect.y) <= rect.height / 2 + 0.01,
      );
      expect(touches, `route touches ${stop}`).toBe(true);
    }
  });

  test('orients each hop in the travel direction', () => {
    const transit = {
      fromLocationId: 'school',
      toLocationId: 'residential-block',
      routeLocationIds: ['school', 'residential-block'],
    };
    const chain = routeWaypointsForTransit(transit, locations, network);
    expect(chain[0].x).toBeGreaterThan(chain[chain.length - 1].x);
  });

  test('returns null without placed hops', () => {
    expect(
      routeWaypointsForTransit(
        { fromLocationId: 'nowhere', toLocationId: 'school' },
        locations,
        network,
      ),
    ).toBeNull();
    expect(routeWaypointsForTransit(undefined, locations, network)).toBeNull();
  });
});

describe('positionAlongWaypoints', () => {
  const L = [
    { x: 0, y: 0 },
    { x: 0.5, y: 0 },
    { x: 0.5, y: 0.5 },
  ];

  test('walks the segments in order with total-length progress', () => {
    expect(positionAlongWaypoints(L, 0)).toMatchObject({ x: 0, y: 0, direction: 'right' });
    const quarter = positionAlongWaypoints(L, 0.25);
    expect(quarter.x).toBeCloseTo(0.25);
    expect(quarter.y).toBeCloseTo(0);
    expect(quarter.direction).toBe('right');
    const threeQuarters = positionAlongWaypoints(L, 0.75);
    expect(threeQuarters.x).toBeCloseTo(0.5);
    expect(threeQuarters.y).toBeCloseTo(0.25);
    expect(threeQuarters.direction).toBe('down');
    expect(positionAlongWaypoints(L, 1)).toMatchObject({ x: 0.5, y: 0.5 });
  });

  test('clamps progress and survives degenerate input', () => {
    expect(positionAlongWaypoints(L, -1).progress).toBe(0);
    expect(positionAlongWaypoints(L, 9).progress).toBe(1);
    expect(positionAlongWaypoints([{ x: 1, y: 1 }], 0.5)).toBeNull();
  });
});

describe('segmentDistance', () => {
  test('measures point-to-segment distance with clamped projection', () => {
    expect(segmentDistance({ x: 0.5, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(0);
    expect(segmentDistance({ x: 0.5, y: 0.2 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(0.2);
    expect(segmentDistance({ x: 2, y: 0.3 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(
      Math.hypot(1, 0.3),
    );
    expect(segmentDistance({ x: 3, y: 4 }, { x: 3, y: 4 }, { x: 3, y: 4 })).toBeCloseTo(0);
  });
});

describe('aggregateEdgeFlows', () => {
  test('prefers authoritative routeEdgeFlows', () => {
    const flows = aggregateEdgeFlows({
      'agent-1': {
        fromLocationId: 'town-square',
        toLocationId: 'school',
        routeLocationIds: ['town-square', 'residential-block', 'school'],
        congestionMultiplier: 1.2,
        routeEdgeFlows: [
          {
            fromLocationId: 'town-square',
            toLocationId: 'residential-block',
            activeTraversalCount: 3,
            congestionMultiplier: 1.4,
          },
          {
            fromLocationId: 'residential-block',
            toLocationId: 'school',
            activeTraversalCount: 1,
            congestionMultiplier: 1,
          },
        ],
      },
    });
    const first = flows.get(edgeKey('town-square', 'residential-block'));
    expect(first.count).toBe(3);
    expect(first.multiplier).toBeCloseTo(1.4);
    expect(flows.get(edgeKey('residential-block', 'school')).count).toBe(1);
  });

  test('falls back to counting active transits per hop', () => {
    const flows = aggregateEdgeFlows({
      'agent-1': {
        fromLocationId: 'clinic',
        toLocationId: 'school',
        routeLocationIds: ['clinic', 'town-square', 'residential-block', 'school'],
        congestionMultiplier: 1.1,
      },
      'agent-2': {
        fromLocationId: 'town-square',
        toLocationId: 'clinic',
        congestionMultiplier: 1,
      },
    });
    expect(flows.get(edgeKey('clinic', 'town-square')).count).toBe(2);
    expect(flows.get(edgeKey('town-square', 'residential-block')).count).toBe(1);
  });

  test('tolerates empty and malformed input', () => {
    expect(aggregateEdgeFlows({}).size).toBe(0);
    expect(aggregateEdgeFlows(undefined).size).toBe(0);
    expect(aggregateEdgeFlows({ broken: null }).size).toBe(0);
  });
});

describe('congestionLevel / congestionColor', () => {
  test('level is monotonic and bounded', () => {
    expect(congestionLevel(null)).toBe(0);
    expect(congestionLevel({ count: 1, multiplier: 1 })).toBe(0);
    expect(congestionLevel({ count: 4, multiplier: 1 })).toBeGreaterThan(0);
    expect(congestionLevel({ count: 20, multiplier: 3 })).toBe(1);
    expect(congestionLevel({ count: 4, multiplier: 1 })).toBeLessThanOrEqual(
      congestionLevel({ count: 9, multiplier: 2.5 }),
    );
  });

  test('color is a green-to-red rgba ramp', () => {
    expect(congestionColor(0)).toMatch(/^rgba\(/);
    expect(congestionColor(0.5)).not.toBe(congestionColor(1));
    expect(congestionColor(2)).toBe(congestionColor(1));
  });
});
