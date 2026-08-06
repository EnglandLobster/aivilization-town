import { asLocationId, type LocationId } from '@aivilization/sim-core';

export type TownLocationKind =
  | 'residence'
  | 'education'
  | 'healthcare'
  | 'food'
  | 'market'
  | 'production'
  | 'social';

export type TownActivityAffinity =
  | 'sleep'
  | 'study'
  | 'health'
  | 'eat'
  | 'trade'
  | 'work'
  | 'produce'
  | 'socialize';

export type TownLocationConfig = {
  readonly locationId: LocationId;
  readonly name: string;
  readonly kind: TownLocationKind;
  readonly activityAffinities: readonly TownActivityAffinity[];
  readonly capacity: number | null;
  readonly mapPosition?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly connections?: readonly {
    readonly targetLocationId: LocationId;
    readonly travelDurationSeconds: number;
  }[];
  /**
   * Optional regional market this location belongs to (lowercase kebab-case,
   * e.g. "downtown" / "harbor"). When the regional-markets switch is enabled,
   * locations in the same region share one AMM pool per commodity. Omitted maps
   * to the default single region.
   */
  readonly regionId?: string;
  readonly source: string;
};

const townEnvironmentSource =
  'AIvilization v0 Appendix B Table 8 activities and Section 3.3 environment';

export const townLocations = [
  {
    locationId: asLocationId('town-square'),
    name: 'Town Square',
    kind: 'social',
    activityAffinities: ['socialize', 'trade'],
    capacity: 70,
    mapPosition: { x: 0.16, y: 0.22, width: 0.28, height: 0.35 },
    regionId: 'downtown',
    connections: [
      { targetLocationId: asLocationId('residential-block'), travelDurationSeconds: 360 },
      { targetLocationId: asLocationId('clinic'), travelDurationSeconds: 420 },
      { targetLocationId: asLocationId('restaurant'), travelDurationSeconds: 300 },
    ],
    source: townEnvironmentSource,
  },
  {
    locationId: asLocationId('residential-block'),
    name: 'Residential Block',
    kind: 'residence',
    activityAffinities: ['sleep', 'socialize'],
    capacity: 100,
    mapPosition: { x: 0.5, y: 0.22, width: 0.28, height: 0.37 },
    regionId: 'downtown',
    connections: [
      { targetLocationId: asLocationId('town-square'), travelDurationSeconds: 360 },
      { targetLocationId: asLocationId('school'), travelDurationSeconds: 360 },
      { targetLocationId: asLocationId('restaurant'), travelDurationSeconds: 420 },
    ],
    source: townEnvironmentSource,
  },
  {
    locationId: asLocationId('school'),
    name: 'School',
    kind: 'education',
    activityAffinities: ['study', 'socialize'],
    capacity: 40,
    mapPosition: { x: 0.82, y: 0.22, width: 0.28, height: 0.38 },
    regionId: 'downtown',
    connections: [
      { targetLocationId: asLocationId('residential-block'), travelDurationSeconds: 360 },
      { targetLocationId: asLocationId('workshop'), travelDurationSeconds: 420 },
    ],
    source: townEnvironmentSource,
  },
  {
    locationId: asLocationId('clinic'),
    name: 'Clinic',
    kind: 'healthcare',
    activityAffinities: ['health', 'socialize'],
    capacity: 20,
    mapPosition: { x: 0.14, y: 0.66, width: 0.25, height: 0.39 },
    regionId: 'downtown',
    connections: [
      { targetLocationId: asLocationId('town-square'), travelDurationSeconds: 420 },
      { targetLocationId: asLocationId('restaurant'), travelDurationSeconds: 300 },
    ],
    source: townEnvironmentSource,
  },
  {
    locationId: asLocationId('restaurant'),
    name: 'Restaurant',
    kind: 'food',
    activityAffinities: ['eat', 'socialize', 'trade'],
    capacity: 30,
    mapPosition: { x: 0.4, y: 0.68, width: 0.26, height: 0.41 },
    regionId: 'downtown',
    connections: [
      { targetLocationId: asLocationId('town-square'), travelDurationSeconds: 300 },
      { targetLocationId: asLocationId('residential-block'), travelDurationSeconds: 420 },
      { targetLocationId: asLocationId('clinic'), travelDurationSeconds: 300 },
      { targetLocationId: asLocationId('market'), travelDurationSeconds: 240 },
    ],
    source: townEnvironmentSource,
  },
  {
    locationId: asLocationId('market'),
    name: 'Market',
    kind: 'market',
    activityAffinities: ['trade', 'socialize'],
    capacity: 45,
    mapPosition: { x: 0.63, y: 0.68, width: 0.25, height: 0.4 },
    regionId: 'harbor',
    connections: [
      { targetLocationId: asLocationId('restaurant'), travelDurationSeconds: 240 },
      { targetLocationId: asLocationId('workshop'), travelDurationSeconds: 300 },
    ],
    source: townEnvironmentSource,
  },
  {
    locationId: asLocationId('workshop'),
    name: 'Workshop',
    kind: 'production',
    activityAffinities: ['work', 'produce', 'trade'],
    capacity: 45,
    mapPosition: { x: 0.86, y: 0.68, width: 0.25, height: 0.4 },
    regionId: 'harbor',
    connections: [
      { targetLocationId: asLocationId('school'), travelDurationSeconds: 420 },
      { targetLocationId: asLocationId('market'), travelDurationSeconds: 300 },
    ],
    source: townEnvironmentSource,
  },
] as const satisfies readonly TownLocationConfig[];
