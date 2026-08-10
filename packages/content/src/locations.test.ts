import { asLocationId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { townLocations } from './locations';

describe('town location catalog', () => {
  test('defines stable unique location ids with activity affinities', () => {
    const ids = townLocations.map((location) => location.locationId);

    expect(new Set(ids).size).toBe(townLocations.length);
    expect(ids).toContain(asLocationId('town-square'));
    expect(ids).toContain(asLocationId('restaurant'));
    expect(ids).toContain(asLocationId('clinic'));
  });

  test('keeps paper-derived activity sources near each location', () => {
    const restaurant = townLocations.find(
      (location) => location.locationId === asLocationId('restaurant'),
    );
    const school = townLocations.find((location) => location.locationId === asLocationId('school'));

    expect(restaurant).toMatchObject({
      kind: 'food',
      activityAffinities: ['eat', 'socialize', 'trade'],
      source: 'AIvilization v0 Appendix B Table 8 activities and Section 3.3 environment',
    });
    expect(school?.activityAffinities).toContain('study');
  });

  test('defines a connected bidirectional spatial graph aligned with the pixel map', () => {
    const locationsById = new Map(townLocations.map((location) => [location.locationId, location]));

    for (const location of townLocations) {
      expect(location.capacity).toBeGreaterThan(0);
      expect(Number.isFinite(location.mapPosition.x)).toBe(true);
      expect(Number.isFinite(location.mapPosition.y)).toBe(true);
      expect(Number.isFinite(location.mapPosition.width)).toBe(true);
      expect(Number.isFinite(location.mapPosition.height)).toBe(true);
      expect(location.connections.length).toBeGreaterThan(0);
      for (const connection of location.connections) {
        const target = locationsById.get(connection.targetLocationId);
        expect(target).toBeDefined();
        expect(target?.connections).toContainEqual({
          targetLocationId: location.locationId,
          travelDurationSeconds: connection.travelDurationSeconds,
        });
      }
    }
  });
});
