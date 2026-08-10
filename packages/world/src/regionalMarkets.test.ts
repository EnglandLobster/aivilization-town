import { type AmmPool } from '@aivilization/economy';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MARKET_REGION_ID,
  REGIONAL_POOL_KEY_SEPARATOR,
  groupMarketPoolsByRegion,
  iterateMarketPoolsByRegion,
  regionIdFromPoolKey,
  resolveAgentRegion,
  resolveMarketPool,
  resolveMarketPoolKey,
  resolveRegionId,
} from './regionalMarkets';
import { createWorldProjection, type WorldProjection } from './projection';

function buildProjectionWithPools(pools: readonly AmmPool[]): WorldProjection {
  return createWorldProjection({
    clock: {
      now: 0,
      tickDurationMs: 1000,
    },
    agents: [],
    locations: [
      {
        locationId: 'downtown-market' as never,
        name: 'Downtown Market',
        kind: 'market',
        activityAffinities: ['trade'],
        capacity: 10,
        regionId: 'downtown',
      },
      {
        locationId: 'harbor-market' as never,
        name: 'Harbor Market',
        kind: 'market',
        activityAffinities: ['trade'],
        capacity: 10,
        regionId: 'harbor',
      },
      {
        locationId: 'unmarked-square' as never,
        name: 'Unmarked Square',
        kind: 'social',
        activityAffinities: ['socialize'],
        capacity: 10,
      },
    ],
    marketPools: pools,
  });
}

describe('resolveRegionId', () => {
  it('maps undefined and empty to the default region', () => {
    expect(resolveRegionId(undefined)).toBe(DEFAULT_MARKET_REGION_ID);
    expect(resolveRegionId('')).toBe(DEFAULT_MARKET_REGION_ID);
  });

  it('returns an explicit region unchanged', () => {
    expect(resolveRegionId('harbor')).toBe('harbor');
  });
});

describe('resolveMarketPoolKey', () => {
  it('produces the bare commodity name for the default region (legacy key)', () => {
    expect(resolveMarketPoolKey({ regionId: undefined, commodity: 'Fish' })).toBe('Fish');
    expect(resolveMarketPoolKey({ regionId: DEFAULT_MARKET_REGION_ID, commodity: 'Fish' })).toBe(
      'Fish',
    );
  });

  it('produces a composite key for a non-default region', () => {
    const key = resolveMarketPoolKey({ regionId: 'harbor', commodity: 'Fish' });
    expect(key).toBe(`harbor${REGIONAL_POOL_KEY_SEPARATOR}Fish`);
  });
});

describe('regionIdFromPoolKey', () => {
  it('recovers the region from a composite key', () => {
    expect(regionIdFromPoolKey(`harbor${REGIONAL_POOL_KEY_SEPARATOR}Fish`)).toBe('harbor');
  });

  it('falls back to the default region for a legacy bare key', () => {
    expect(regionIdFromPoolKey('Fish')).toBe(DEFAULT_MARKET_REGION_ID);
  });
});

describe('resolveAgentRegion', () => {
  const projection = buildProjectionWithPools([]);

  it('resolves the region of a located agent from its location', () => {
    expect(resolveAgentRegion({ projection, agentLocationId: 'downtown-market' })).toBe(
      'downtown',
    );
    expect(resolveAgentRegion({ projection, agentLocationId: 'harbor-market' })).toBe('harbor');
  });

  it('resolves an unmarked location to the default region', () => {
    expect(resolveAgentRegion({ projection, agentLocationId: 'unmarked-square' })).toBe(
      DEFAULT_MARKET_REGION_ID,
    );
  });

  it('resolves a null or unknown location to the default region', () => {
    expect(resolveAgentRegion({ projection, agentLocationId: null })).toBe(
      DEFAULT_MARKET_REGION_ID,
    );
    expect(resolveAgentRegion({ projection, agentLocationId: 'nope' })).toBe(
      DEFAULT_MARKET_REGION_ID,
    );
  });
});

describe('resolveMarketPool', () => {
  const projection = buildProjectionWithPools([
    { commodity: 'Fish', commodityReserve: 100, currencyReserve: 1000 },
    { commodity: 'Fish', commodityReserve: 50, currencyReserve: 250, regionId: 'harbor' },
  ]);

  it('returns the default-region pool for a bare commodity', () => {
    const pool = resolveMarketPool(projection, { regionId: undefined, commodity: 'Fish' });
    expect(pool).toBeDefined();
    expect(pool?.currencyReserve).toBe(1000);
  });

  it('returns the regional pool for a tagged region', () => {
    const pool = resolveMarketPool(projection, { regionId: 'harbor', commodity: 'Fish' });
    expect(pool).toBeDefined();
    expect(pool?.currencyReserve).toBe(250);
  });

  it('returns undefined when no pool matches', () => {
    expect(
      resolveMarketPool(projection, { regionId: 'harbor', commodity: 'Wood' }),
    ).toBeUndefined();
  });
});

describe('iterateMarketPoolsByRegion', () => {
  const projection = buildProjectionWithPools([
    { commodity: 'Fish', commodityReserve: 100, currencyReserve: 1000 },
    { commodity: 'Wood', commodityReserve: 80, currencyReserve: 800 },
    { commodity: 'Fish', commodityReserve: 50, currencyReserve: 250, regionId: 'harbor' },
  ]);

  it('yields only the pools of the requested region', () => {
    const harbor = [...iterateMarketPoolsByRegion(projection, 'harbor')];
    expect(harbor).toHaveLength(1);
    expect(harbor[0]?.commodity).toBe('Fish');
    expect(harbor[0]?.currencyReserve).toBe(250);
  });

  it('yields every default-region pool when region is the default', () => {
    const downtown = [...iterateMarketPoolsByRegion(projection, undefined)];
    expect(downtown).toHaveLength(2);
  });
});

describe('groupMarketPoolsByRegion', () => {
  const projection = buildProjectionWithPools([
    { commodity: 'Fish', commodityReserve: 100, currencyReserve: 1000 },
    { commodity: 'Fish', commodityReserve: 50, currencyReserve: 250, regionId: 'harbor' },
    { commodity: 'Wood', commodityReserve: 60, currencyReserve: 300, regionId: 'harbor' },
  ]);

  it('groups pools under their region id', () => {
    const grouped = groupMarketPoolsByRegion(projection);
    expect(Object.keys(grouped).sort()).toEqual([DEFAULT_MARKET_REGION_ID, 'harbor'].sort());
    expect(grouped['harbor']?.length).toBe(2);
    expect(grouped[DEFAULT_MARKET_REGION_ID]?.length).toBe(1);
  });
});
