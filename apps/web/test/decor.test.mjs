/**
 * Unit tests for the deterministic scenery layout (decor.js) — pure module,
 * no DOM access.
 */
import { describe, expect, test } from 'vitest';
import {
  computeScenery,
  computeWaterRegions,
  regionBounds,
  regionGroundTones,
  regionLabel,
} from '../public/ui/map/decor.js';
import { computeRoadNetwork } from '../public/ui/map/roads.js';

const locations = {
  'town-square': {
    locationId: 'town-square',
    mapPosition: { x: 0.16, y: 0.22, width: 0.28, height: 0.35 },
    regionId: 'downtown',
    connections: [{ targetLocationId: 'market', travelDurationSeconds: 240 }],
  },
  clinic: {
    locationId: 'clinic',
    mapPosition: { x: 0.14, y: 0.66, width: 0.25, height: 0.39 },
    regionId: 'downtown',
  },
  market: {
    locationId: 'market',
    mapPosition: { x: 0.63, y: 0.68, width: 0.25, height: 0.4 },
    regionId: 'harbor',
    connections: [{ targetLocationId: 'town-square', travelDurationSeconds: 240 }],
  },
  workshop: {
    locationId: 'workshop',
    mapPosition: { x: 0.86, y: 0.68, width: 0.25, height: 0.4 },
    regionId: 'harbor',
  },
};

const network = computeRoadNetwork(locations);
const waterRects = computeWaterRegions(locations);
const scenery = computeScenery(locations, network, waterRects);

function insideRect(point, rect, margin = 0) {
  return (
    Math.abs(point.x - rect.x) <= rect.width / 2 + margin &&
    Math.abs(point.y - rect.y) <= rect.height / 2 + margin
  );
}

describe('computeWaterRegions', () => {
  test('creates a shoreline below the maritime region without covering buildings', () => {
    expect(waterRects).toHaveLength(1);
    const water = waterRects[0];
    expect(water.regionId).toBe('harbor');
    const top = water.rect.y - water.rect.height / 2;
    const bottomMostBuilding = Math.max(
      ...Object.values(locations).map((l) => l.mapPosition.y + l.mapPosition.height / 2),
    );
    expect(top).toBeGreaterThanOrEqual(bottomMostBuilding + 0.015);
  });

  test('produces nothing for landlocked layouts', () => {
    const inland = {
      school: {
        locationId: 'school',
        mapPosition: { x: 0.5, y: 0.5, width: 0.2, height: 0.2 },
        regionId: 'downtown',
      },
    };
    expect(computeWaterRegions(inland)).toHaveLength(0);
  });
});

describe('computeScenery', () => {
  test('is deterministic', () => {
    const again = computeScenery(locations, network, waterRects);
    expect(again.items).toEqual(scenery.items);
    expect(again.lampposts).toEqual(scenery.lampposts);
  });

  test('places a variety of items across the map', () => {
    const types = new Set(scenery.items.map((item) => item.type));
    expect(types.has('tree')).toBe(true);
    expect(scenery.items.length).toBeGreaterThan(20);
  });

  test('never intersects building rects, water or road corridors', () => {
    for (const item of scenery.items) {
      for (const location of Object.values(locations)) {
        expect(insideRect(item, location.mapPosition, 0.014)).toBe(false);
      }
      for (const water of waterRects) {
        expect(insideRect(item, water.rect, 0.009)).toBe(false);
      }
      for (const edge of network.edges) {
        for (let index = 1; index < edge.waypoints.length; index += 1) {
          const a = edge.waypoints[index - 1];
          const b = edge.waypoints[index];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const lengthSquared = dx * dx + dy * dy;
          let t = ((item.x - a.x) * dx + (item.y - a.y) * dy) / lengthSquared;
          t = Math.min(1, Math.max(0, t));
          const distance = Math.hypot(item.x - (a.x + dx * t), item.y - (a.y + dy * t));
          expect(distance).toBeGreaterThan(0.027);
        }
      }
    }
  });

  test('lampposts sit on road geometry and off buildings', () => {
    expect(scenery.lampposts.length).toBeGreaterThan(0);
    for (const lamp of scenery.lampposts) {
      let onRoad = false;
      for (const edge of network.edges) {
        for (let index = 1; index < edge.waypoints.length; index += 1) {
          const a = edge.waypoints[index - 1];
          const b = edge.waypoints[index];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const lengthSquared = dx * dx + dy * dy;
          let t = ((lamp.x - a.x) * dx + (lamp.y - a.y) * dy) / lengthSquared;
          t = Math.min(1, Math.max(0, t));
          if (Math.hypot(lamp.x - (a.x + dx * t), lamp.y - (a.y + dy * t)) <= 0.005) {
            onRoad = true;
          }
        }
      }
      expect(onRoad).toBe(true);
      for (const location of Object.values(locations)) {
        expect(insideRect(lamp, location.mapPosition, 0.014)).toBe(false);
      }
    }
  });

  test('tolerates empty worlds', () => {
    const empty = computeScenery({}, computeRoadNetwork({}), []);
    expect(empty.items.length).toBeGreaterThan(0);
    expect(empty.lampposts).toHaveLength(0);
  });
});

describe('regionGroundTones', () => {
  test('scales tint with relative land value', () => {
    const tones = regionGroundTones(locations, { downtown: 100, harbor: 300 });
    expect(tones.size).toBe(2);
    expect(tones.get('harbor').normalized).toBe(1);
    expect(tones.get('harbor').alpha).toBeGreaterThan(tones.get('downtown').alpha);
  });

  test('empty without the authoritative slice (flag-gated)', () => {
    expect(regionGroundTones(locations, undefined).size).toBe(0);
    expect(regionGroundTones(locations, {}).size).toBe(0);
  });
});

describe('regionBounds / regionLabel', () => {
  test('bounds cover every region rect', () => {
    const bounds = regionBounds(locations);
    expect(bounds.map((entry) => entry.regionId).sort()).toEqual(['downtown', 'harbor']);
    const downtown = bounds.find((entry) => entry.regionId === 'downtown');
    expect(downtown.rect.x - downtown.rect.width / 2).toBeLessThanOrEqual(
      locations['town-square'].mapPosition.x - locations['town-square'].mapPosition.width / 2,
    );
  });

  test('labels are humanized', () => {
    expect(regionLabel('old-town')).toBe('Old Town');
    expect(regionLabel('harbor')).toBe('Harbor');
  });
});
