import { createHash } from 'node:crypto';
import { asSimulationId, type PartitionKey, type SimulationId } from '@aivilization/sim-core';
import type { AmmPool } from '@aivilization/economy';
import type { SocialRelationState } from '@aivilization/society';
import {
  DEFAULT_MARKET_REGION_ID,
  type WorldLocationState,
  type WorldProjection,
} from '@aivilization/world';
import type { LocalSimulationSocietyDirectoryService } from './localSimulationSocietyDirectory';
import type { LocalSimulationRuntimeHostPartition } from './localSimulationRuntimeHost';

export const LOCAL_SIMULATION_SOCIETY_PROJECTION_SCHEMA_VERSION =
  'local-simulation-society-projection-v1';

export type LocalSimulationSocietyProjection = {
  readonly schemaVersion: typeof LOCAL_SIMULATION_SOCIETY_PROJECTION_SCHEMA_VERSION;
  readonly projectionId: string;
  readonly simulationId: SimulationId;
  readonly partitionBoundaries: readonly {
    readonly partitionKey: PartitionKey;
    readonly simulationTime: number;
    readonly streamVersion: number;
  }[];
  readonly population: {
    readonly totalAgentCount: number;
    readonly owners: readonly { readonly partitionKey: PartitionKey; readonly agentCount: number }[];
  };
  readonly locations: readonly {
    readonly location: WorldLocationState;
    readonly occupantAgentIds: readonly string[];
    readonly occupancy: number;
  }[];
  readonly socialRelations: readonly SocialRelationState[];
  /**
   * This is a simulation-wide current migration view, not an inferred route
   * history. It is sourced from the owner directory so consumers can tell an
   * Agent in transit from an Agent that has completed an owner transfer.
   */
  readonly migrations: readonly {
    readonly agentId: string;
    readonly ownerPartitionKey: PartitionKey;
    readonly locationId: string | null;
    readonly transit?: {
      readonly fromLocationId: string;
      readonly toLocationId: string;
      readonly departedAt: number;
      readonly arrivesAt: number;
    };
  }[];
  /**
   * This endpoint never hides a split market behind a town-wide average. When
   * the simulation-wide authority owns the unified AMM, the market is reported
   * as `unified-authority` with the single global pool and total money supply.
   * Otherwise a consumer can render the global population immediately, while the
   * legacy market view stays an explicit replica/partitioned status.
   */
  readonly market:
    | {
        readonly status: 'unified-authority';
        readonly pools: readonly AmmPool[];
        readonly moneySupply: number;
      }
    | {
        readonly status: 'consistent-replica';
        readonly pools: readonly AmmPool[];
        readonly moneySupplyByPartition: readonly {
          readonly partitionKey: PartitionKey;
          readonly moneySupply: number;
        }[];
      }
    | {
        readonly status: 'partitioned';
        readonly partitions: readonly {
          readonly partitionKey: PartitionKey;
          readonly pools: readonly AmmPool[];
          readonly moneySupply: number;
        }[];
      }
    | {
        /**
         * The authority owns the market but keeps per-region AMM pools. This is a
         * repository-specific extension (not a paper mechanism): one settlement
         * authority, multiple regional markets whose prices diverge. Regions are
         * listed with their own pools and the money supply stays the town total.
         */
        readonly status: 'regional-authority';
        readonly regions: readonly {
          readonly regionId: string;
          readonly pools: readonly AmmPool[];
        }[];
        readonly moneySupply: number;
      };
};

/**
 * A read-only view of the unified authority market. When provided to the
 * society projection service, the market is reported as `unified-authority`
 * from these global pools rather than compared across per-partition replicas.
 */
export type LocalSimulationSocietyAuthorityMarketSource = () => {
  readonly marketPools: Readonly<Record<string, AmmPool>>;
  readonly moneySupply: number;
};

export type LocalSimulationSocietyProjectionService = {
  readonly getProjection: (input: { readonly simulationId: string }) => LocalSimulationSocietyProjection;
};

export function createLocalSimulationSocietyProjectionService(input: {
  readonly partitions: readonly LocalSimulationRuntimeHostPartition[];
  readonly societyDirectory: LocalSimulationSocietyDirectoryService;
  readonly authorityMarketSource?: LocalSimulationSocietyAuthorityMarketSource;
}): LocalSimulationSocietyProjectionService {
  return {
    getProjection({ simulationId }) {
      const directory = input.societyDirectory.getDirectory({ simulationId });
      const partitions = input.partitions
        .filter((partition) => partition.simulationId === directory.simulationId)
        .sort((left, right) => left.partitionKey.localeCompare(right.partitionKey));
      if (partitions.length === 0) throw new Error(`unknown society simulation ${simulationId}`);
      const materialized = partitions.map((partition) => ({
        partition,
        projection: loadProjection(partition),
        streamVersion: partition.bootstrap.storage.checkpointStore.getLatestCheckpoint({
          simulationId: asSimulationId(partition.simulationId),
          partitionKey: partition.partitionKey,
        })!.lastAppliedSequence,
      }));
      const locations = mergeLocations(materialized.map((entry) => entry.projection));
      const occupants = new Map<string, string[]>();
      for (const agent of directory.agents) {
        if (agent.publicState.locationId === null) continue;
        const current = occupants.get(agent.publicState.locationId) ?? [];
        current.push(agent.agentId);
        occupants.set(agent.publicState.locationId, current);
      }
      const locationViews = Object.values(locations)
        .map((location) => {
          const occupantAgentIds = [...(occupants.get(location.locationId) ?? [])].sort();
          return { location, occupantAgentIds, occupancy: occupantAgentIds.length };
        })
        .sort((left, right) => left.location.locationId.localeCompare(right.location.locationId));
      const socialRelations = mergeSocialRelations(materialized.map((entry) => entry.projection));
      const migrations = directory.agents.map((agent) => ({
        agentId: agent.agentId,
        ownerPartitionKey: agent.ownerPartitionKey,
        locationId: agent.publicState.locationId,
        ...(agent.publicState.transit === undefined
          ? {}
          : { transit: { ...agent.publicState.transit } }),
      }));
      const market =
        input.authorityMarketSource === undefined
          ? describeMarket(materialized)
          : describeUnifiedAuthorityMarket(input.authorityMarketSource());
      const projectionWithoutId: Omit<LocalSimulationSocietyProjection, 'projectionId'> = {
        schemaVersion: LOCAL_SIMULATION_SOCIETY_PROJECTION_SCHEMA_VERSION,
        simulationId: directory.simulationId,
        partitionBoundaries: materialized.map(({ partition, projection, streamVersion }) => ({
          partitionKey: partition.partitionKey,
          simulationTime: projection.clock.now,
          streamVersion,
        })),
        population: {
          totalAgentCount: directory.agents.length,
          owners: partitions.map((partition) => ({
            partitionKey: partition.partitionKey,
            agentCount: directory.agents.filter(
              (agent) => agent.ownerPartitionKey === partition.partitionKey,
            ).length,
          })),
        },
        locations: locationViews,
        socialRelations,
        migrations,
        market,
      };
      return {
        ...projectionWithoutId,
        projectionId: `local-simulation-society-projection:sha256:${sha256(
          stableStringify(projectionWithoutId),
        )}`,
      };
    },
  };
}

function loadProjection(partition: LocalSimulationRuntimeHostPartition): WorldProjection {
  const checkpoint = partition.bootstrap.storage.checkpointStore.getLatestCheckpoint({
    simulationId: asSimulationId(partition.simulationId),
    partitionKey: partition.partitionKey,
  });
  if (checkpoint?.snapshot === undefined) {
    throw new Error(`society projection partition ${partition.partitionKey} has no snapshot`);
  }
  const projection = partition.bootstrap.storage.snapshotStore.loadSnapshot(checkpoint.snapshot);
  if (projection === undefined) {
    throw new Error(`society projection partition ${partition.partitionKey} snapshot is missing`);
  }
  return projection;
}

function mergeLocations(projections: readonly WorldProjection[]): Readonly<Record<string, WorldLocationState>> {
  const locations: Record<string, WorldLocationState> = {};
  for (const projection of projections) {
    for (const [locationId, location] of Object.entries(projection.locations)) {
      const existing = locations[locationId];
      if (existing !== undefined && stableStringify(existing) !== stableStringify(location)) {
        throw new Error(`society projection location ${locationId} diverged across partitions`);
      }
      locations[locationId] = structuredClone(location);
    }
  }
  return locations;
}

function mergeSocialRelations(projections: readonly WorldProjection[]): readonly SocialRelationState[] {
  const relations = new Map<string, SocialRelationState>();
  for (const projection of projections) {
    for (const [key, relation] of Object.entries(projection.socialRelations)) {
      const existing = relations.get(key);
      if (existing !== undefined && stableStringify(existing) !== stableStringify(relation)) {
        throw new Error(`society projection relation ${key} diverged across partitions`);
      }
      relations.set(key, structuredClone(relation));
    }
  }
  return [...relations.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, relation]) => relation);
}

function describeUnifiedAuthorityMarket(market: {
  readonly marketPools: Readonly<Record<string, AmmPool>>;
  readonly moneySupply: number;
}): LocalSimulationSocietyProjection['market'] {
  // Region-tagged pools carry a regionId. When any pool is region-tagged, the
  // authority keeps per-region AMM pools and the market is reported as
  // `regional-authority` so consumers can see the divergent regional prices
  // rather than a flat pool list. Otherwise every pool belongs to the single
  // default region and the legacy `unified-authority` view (one global pool per
  // commodity) is preserved.
  const grouped: Record<string, AmmPool[]> = {};
  for (const pool of Object.values(market.marketPools)) {
    const regionId = pool.regionId ?? DEFAULT_MARKET_REGION_ID;
    (grouped[regionId] ??= []).push(pool);
  }
  const regionKeys = Object.keys(grouped);
  const hasMultipleRegions =
    regionKeys.length > 1 || (regionKeys.length === 1 && regionKeys[0] !== DEFAULT_MARKET_REGION_ID);

  if (hasMultipleRegions) {
    return {
      status: 'regional-authority',
      regions: regionKeys
        .sort()
        .map((regionId) => ({
          regionId,
          pools: (grouped[regionId] ?? [])
            .map((pool) => ({ ...pool }))
            .sort((left, right) => left.commodity.localeCompare(right.commodity)),
        })),
      moneySupply: market.moneySupply,
    };
  }

  return {
    status: 'unified-authority',
    pools: Object.values(market.marketPools)
      .map((pool) => ({ ...pool }))
      .sort((left, right) => left.commodity.localeCompare(right.commodity)),
    moneySupply: market.moneySupply,
  };
}

function describeMarket(
  partitions: readonly {
    readonly partition: LocalSimulationRuntimeHostPartition;
    readonly projection: WorldProjection;
  }[],
): LocalSimulationSocietyProjection['market'] {
  const entries = partitions.map(({ partition, projection }) => ({
    partitionKey: partition.partitionKey,
    pools: Object.values(projection.marketPools)
      .map((pool) => ({ ...pool }))
      .sort((left, right) => left.commodity.localeCompare(right.commodity)),
    moneySupply: projection.moneySupply,
  }));
  const reference = entries[0];
  if (reference === undefined) throw new Error('society projection requires partitions');
  const samePools = entries.every((entry) => stableStringify(entry.pools) === stableStringify(reference.pools));
  return samePools
    ? {
        status: 'consistent-replica',
        pools: reference.pools,
        moneySupplyByPartition: entries.map((entry) => ({
          partitionKey: entry.partitionKey,
          moneySupply: entry.moneySupply,
        })),
      }
    : { status: 'partitioned', partitions: entries };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(',')}}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
