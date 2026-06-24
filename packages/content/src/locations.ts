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
    capacity: null,
    source: townEnvironmentSource,
  },
  {
    locationId: asLocationId('residential-block'),
    name: 'Residential Block',
    kind: 'residence',
    activityAffinities: ['sleep', 'socialize'],
    capacity: null,
    source: townEnvironmentSource,
  },
  {
    locationId: asLocationId('school'),
    name: 'School',
    kind: 'education',
    activityAffinities: ['study', 'socialize'],
    capacity: null,
    source: townEnvironmentSource,
  },
  {
    locationId: asLocationId('clinic'),
    name: 'Clinic',
    kind: 'healthcare',
    activityAffinities: ['health', 'socialize'],
    capacity: null,
    source: townEnvironmentSource,
  },
  {
    locationId: asLocationId('restaurant'),
    name: 'Restaurant',
    kind: 'food',
    activityAffinities: ['eat', 'socialize', 'trade'],
    capacity: null,
    source: townEnvironmentSource,
  },
  {
    locationId: asLocationId('market'),
    name: 'Market',
    kind: 'market',
    activityAffinities: ['trade', 'socialize'],
    capacity: null,
    source: townEnvironmentSource,
  },
  {
    locationId: asLocationId('workshop'),
    name: 'Workshop',
    kind: 'production',
    activityAffinities: ['work', 'produce', 'trade'],
    capacity: null,
    source: townEnvironmentSource,
  },
] as const satisfies readonly TownLocationConfig[];
