import type { AmmPool } from '@aivilization/economy';
import type { WorldProjection } from './projection';

/**
 * The region every location is treated as belonging to when no explicit
 * {@link WorldLocationState.regionId} is configured. This keeps legacy
 * single-market scenarios byte-for-byte unchanged: every untagged location
 * collapses into one region, so there is exactly one AMM pool per commodity
 * and regional lookup is identical to the old global lookup.
 */
export const DEFAULT_MARKET_REGION_ID = 'town-center';

/**
 * Composite pool-key separator. Pools are still stored in the flat
 * `Record<string, AmmPool>` on {@link WorldProjection} so that the persisted
 * shape is backward-compatible: with regional markets disabled the keys are
 * bare commodity names (as before); with regional markets enabled the keys
 * become `${regionId}${REGIONAL_POOL_KEY_SEPARATOR}${commodity}`.
 */
export const REGIONAL_POOL_KEY_SEPARATOR = '::';

/**
 * Normalize a (possibly undefined) regionId to a concrete region key. Untagged
 * locations resolve to {@link DEFAULT_MARKET_REGION_ID} so all lookups have a
 * stable address even when regional markets are off.
 */
export function resolveRegionId(regionId: string | undefined): string {
  return regionId === undefined || regionId.length === 0
    ? DEFAULT_MARKET_REGION_ID
    : regionId;
}

/**
 * Build the composite AMM pool key for a (region, commodity) pair. When the
 * region is the default single region this returns the bare commodity name,
 * preserving the legacy global-pool key and therefore the persisted event shape.
 */
export function resolveMarketPoolKey(input: {
  readonly regionId: string | undefined;
  readonly commodity: string;
}): string {
  const regionId = resolveRegionId(input.regionId);
  if (regionId === DEFAULT_MARKET_REGION_ID) {
    return input.commodity;
  }
  return `${regionId}${REGIONAL_POOL_KEY_SEPARATOR}${input.commodity}`;
}

/**
 * Inverse of {@link resolveMarketPoolKey}: recover the regionId encoded in a
 * pool key, falling back to the default region for legacy bare-commodity keys.
 */
export function regionIdFromPoolKey(poolKey: string): string {
  const separatorIndex = poolKey.indexOf(REGIONAL_POOL_KEY_SEPARATOR);
  if (separatorIndex < 0) {
    return DEFAULT_MARKET_REGION_ID;
  }
  return poolKey.slice(0, separatorIndex);
}

/**
 * Resolve the region an agent currently belongs to, from its location. An agent
 * with no location resolves to {@link DEFAULT_MARKET_REGION_ID} so it can still
 * trade against the default-region pool (matching the legacy behavior where
 * trade did not require a location at all, before co-location gating was added).
 */
export function resolveAgentRegion(input: {
  readonly projection: WorldProjection;
  readonly agentLocationId: string | null;
}): string {
  if (input.agentLocationId === null) {
    return DEFAULT_MARKET_REGION_ID;
  }
  const location = input.projection.locations[input.agentLocationId];
  if (location === undefined) {
    return DEFAULT_MARKET_REGION_ID;
  }
  return resolveRegionId(location.regionId);
}

/**
 * Look up the AMM pool for a (region, commodity) pair in a projection's flat
 * pool map. Returns undefined when no such pool exists.
 */
export function resolveMarketPool(
  projection: WorldProjection,
  input: { readonly regionId: string | undefined; readonly commodity: string },
): AmmPool | undefined {
  return projection.marketPools[resolveMarketPoolKey(input)];
}

/**
 * Iterate the pools that belong to a single region. With regional markets
 * disabled this yields every pool (since they all live in the default region).
 */
export function* iterateMarketPoolsByRegion(
  projection: WorldProjection,
  regionId: string | undefined,
): IterableIterator<AmmPool> {
  const target = resolveRegionId(regionId);
  for (const [poolKey, pool] of Object.entries(projection.marketPools)) {
    if (regionIdFromPoolKey(poolKey) === target) {
      yield pool;
    }
  }
}

/**
 * Group every pool in a projection by region id. Used by the read-only market
 * override and society projection to expose per-region market views.
 */
export function groupMarketPoolsByRegion(
  projection: WorldProjection,
): Readonly<Record<string, readonly AmmPool[]>> {
  const grouped: Record<string, AmmPool[]> = {};
  for (const [poolKey, pool] of Object.entries(projection.marketPools)) {
    const regionId = regionIdFromPoolKey(poolKey);
    (grouped[regionId] ??= []).push(pool);
  }
  return grouped;
}
