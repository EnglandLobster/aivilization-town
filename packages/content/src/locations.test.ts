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
});
