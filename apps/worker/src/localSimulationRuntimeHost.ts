import { type AgentId, type PartitionKey, type SimulationTimestamp } from '@aivilization/sim-core';
import type { AmmPool } from '@aivilization/economy';
import type { WorldProjection } from '@aivilization/world';
import {
  createLocalSimulationBackendRegistry,
  type LocalSimulationBackendRegistry,
} from './localSimulationBackendRegistry';
import {
  bootstrapLocalScenarioRuntime,
  type LocalScenarioRuntimeBootstrapResult,
} from './localScenarioBootstrap';
import {
  createLocalSimulationBackendRegistrationsFromResolvedManifest,
  resolveLocalSimulationRuntimeManifest,
  type LocalSimulationRuntimeRegistryInput,
} from './localSimulationRuntimeManifest';
import {
  createLocalSimulationSocietyDirectoryService,
  type LocalSimulationSocietyDirectoryService,
} from './localSimulationSocietyDirectory';
import {
  createLocalSimulationSocialInteractionService,
  type LocalSimulationSocialInteractionService,
} from './localSimulationSocialInteraction';
import {
  createLocalSimulationSocietyProjectionService,
  type LocalSimulationSocietyProjectionService,
} from './localSimulationSocietyProjection';
import {
  createSimulationWideAuthority,
  type SimulationWideAuthoritySeed,
  type SimulationWideAuthorityService,
} from './simulationWideAuthority';
import {
  createSimulationWideAuthorityMaterializer,
  type SimulationWideAuthorityMaterializer,
  type SimulationWideAuthorityMaterializerLease,
} from './simulationWideAuthorityMaterializer';
import {
  createSimulationCommandRouter,
  type SimulationCommandRouter,
} from './simulationCommandRouter';

export type LocalSimulationRuntimeHostInput = LocalSimulationRuntimeRegistryInput & {
  readonly bootstrappedAt: SimulationTimestamp;
  readonly simulationWideAuthority?: SimulationWideAuthorityHostOptions;
};

export type SimulationWideAuthorityHostOptions = {
  readonly enabled: true;
  readonly workerId: string;
  readonly leaseDurationMs: number;
  /**
   * When true, the authority seed preserves per-region AMM pools instead of
   * collapsing them into one global pool: pools sharing a regionId are summed
   * within that region, while pools in different regions stay independent so
   * prices can diverge. Omitted/false keeps the legacy single-global-pool merge.
   */
  readonly regionalMarkets?: boolean;
};

export type LocalSimulationRuntimeHostPartition = {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly scenarioPresetId: string;
  readonly bootstrap: LocalScenarioRuntimeBootstrapResult;
};

export type LocalSimulationRuntimeHost = {
  readonly rootDir: string;
  readonly manifestId: string;
  readonly registry: LocalSimulationBackendRegistry;
  readonly partitions: readonly LocalSimulationRuntimeHostPartition[];
  readonly societyDirectory: LocalSimulationSocietyDirectoryService;
  readonly socialInteractions: LocalSimulationSocialInteractionService;
  readonly societyProjection: LocalSimulationSocietyProjectionService;
  readonly authorityEnabled: boolean;
  readonly authority?: SimulationWideAuthorityService;
  readonly materializers: ReadonlyMap<PartitionKey, SimulationWideAuthorityMaterializer>;
};

export async function bootstrapLocalSimulationRuntimeHostFromManifest(
  input: LocalSimulationRuntimeHostInput,
): Promise<LocalSimulationRuntimeHost> {
  const resolvedManifest = resolveLocalSimulationRuntimeManifest({
    manifest: input.manifest,
    scenarioPresets: input.scenarioPresets,
  });
  const partitions = await Promise.all(
    resolvedManifest.partitions.map(async (partition) => {
      const bootstrap = await bootstrapLocalScenarioRuntime({
        rootDir: input.rootDir,
        simulationId: partition.simulationId,
        partitionKey: partition.partitionKey,
        preset: partition.preset,
        ...(partition.marketPools === undefined ? {} : { marketPools: partition.marketPools }),
        ...(partition.moneySupply === undefined ? {} : { moneySupply: partition.moneySupply }),
        bootstrappedAt: input.bootstrappedAt,
      });

      return {
        simulationId: partition.simulationId,
        partitionKey: partition.partitionKey,
        scenarioPresetId: partition.scenarioPresetId,
        bootstrap,
      };
    }),
  );
  const societyDirectory = createLocalSimulationSocietyDirectoryService({
    manifestId: resolvedManifest.id,
    partitions,
  });
  const socialInteractions = createLocalSimulationSocialInteractionService({
    rootDir: input.rootDir,
    partitions,
    societyDirectory,
    policies: input.policies,
    ...(input.simulationWideAuthority?.enabled === true ? { disabled: true } : {}),
  });
  await socialInteractions.recoverPending();

  const authorityOptions = input.simulationWideAuthority;
  let authority: SimulationWideAuthorityService | undefined;
  const materializers = new Map<PartitionKey, SimulationWideAuthorityMaterializer>();
  const routers = new Map<PartitionKey, SimulationCommandRouter>();
  // Captured once so closures keep the narrowed non-undefined authority config.
  let materializeLease: SimulationWideAuthorityMaterializerLease | undefined;
  if (authorityOptions?.enabled === true) {
    const activeAuthorityOptions = authorityOptions;
    materializeLease = {
      workerId: activeAuthorityOptions.workerId,
      observedAt: input.bootstrappedAt,
      durationMs: activeAuthorityOptions.leaseDurationMs,
    };
    authority = createSimulationWideAuthority({
      rootDir: input.rootDir,
      policies: input.policies,
      seed: createAuthoritySeed({
        manifestId: resolvedManifest.id,
        partitions,
      }),
      ...(activeAuthorityOptions.regionalMarkets === true
        ? { regionalMarketsEnabled: true }
        : {}),
    });
    const lease = (): SimulationWideAuthorityMaterializerLease => materializeLease!;
    authority.recover({
      workerId: activeAuthorityOptions.workerId,
      observedAt: input.bootstrappedAt,
      durationMs: activeAuthorityOptions.leaseDurationMs,
    });
    for (const partition of partitions) {
      const materializer = createSimulationWideAuthorityMaterializer({
        authority,
        storage: partition.bootstrap.storage,
        partitionKey: partition.partitionKey,
        consumerId: activeAuthorityOptions.workerId,
        initialProjection: partition.bootstrap.initialProjection,
      });
      await materializer.recover(lease());
      materializers.set(partition.partitionKey, materializer);
      routers.set(
        partition.partitionKey,
        createSimulationCommandRouter({ authority, lease, partitionKey: partition.partitionKey }),
      );
    }
  }
  const authorityEnabled = authority !== undefined;

  const societyProjection = createLocalSimulationSocietyProjectionService({
    partitions,
    societyDirectory,
    ...(authority === undefined
      ? {}
      : {
          authorityMarketSource: () => {
            const projection = authority.getSnapshot().projection;
            return { marketPools: projection.marketPools, moneySupply: projection.moneySupply };
          },
        }),
  });
  const directoryAwareAgentProvider =
    input.agentProvider === undefined
      ? undefined
      : (providerInput: Parameters<NonNullable<typeof input.agentProvider>>[0]) =>
          input.agentProvider?.({
            ...providerInput,
            societyDirectory: societyDirectory.getDirectory({
              simulationId: providerInput.simulationId,
            }),
          }) ?? [];
  const registry = createLocalSimulationBackendRegistry({
    rootDir: input.rootDir,
    registrations: createLocalSimulationBackendRegistrationsFromResolvedManifest({
      resolvedManifest,
      policies: input.policies,
      localizedPlanners: input.localizedPlanners,
      steeringSimulator: input.steeringSimulator,
      ...(input.strategicPlanCompiler === undefined
        ? {}
        : { strategicPlanCompiler: input.strategicPlanCompiler }),
      agents: input.agents,
      ...(input.pauseBeforeTick === undefined ? {} : { pauseBeforeTick: input.pauseBeforeTick }),
      ...(input.commandDrainLimit === undefined
        ? {}
        : { commandDrainLimit: input.commandDrainLimit }),
      ...(input.timeDeltaMs === undefined ? {} : { timeDeltaMs: input.timeDeltaMs }),
      ...(input.marketMetrics === undefined ? {} : { marketMetrics: input.marketMetrics }),
      ...(input.marketObservations === undefined
        ? {}
        : { marketObservations: input.marketObservations }),
      ...(input.ambientObservationMemory === undefined
        ? {}
        : { ambientObservationMemory: input.ambientObservationMemory }),
      ...(directoryAwareAgentProvider === undefined
        ? {}
        : { agentProvider: directoryAwareAgentProvider }),
      ...(input.validationSchedule === undefined
        ? {}
        : { validationSchedule: input.validationSchedule }),
      ...(input.memoryConsolidationSchedule === undefined
        ? {}
        : { memoryConsolidationSchedule: input.memoryConsolidationSchedule }),
    }),
    ...(authorityEnabled
      ? {
          resolveBackendAugment: (lookup: { readonly partitionKey: PartitionKey }) => {
            const router = routers.get(lookup.partitionKey);
            const materializer = materializers.get(lookup.partitionKey);
            if (router === undefined || materializer === undefined) {
              return undefined;
            }
            const materialize = materializer.materializeInbox.bind(materializer);
            return {
              commandRouter: router,
              preTickMaterialize: async ({ projection }: { readonly projection: WorldProjection }) => {
                const result = await materialize({ lease: materializeLease! });
                // The materializer's projection reflects the partition stream
                // after consuming the inbox. The step passes its own hydrated
                // projection for context; we return the materialized one so the
                // tick plans against authoritative state. The market override is
                // the authority's unified global pool sampled once for this tick:
                // the partition projection's own pools only reflect this
                // partition's trades, so planning and the price index read the
                // authoritative pools instead. It is read-only and never
                // persisted into the partition checkpoint.
                void projection;
                const authorityProjection = authority!.getSnapshot().projection;
                return {
                  projection: result.projection,
                  marketOverride: { marketPools: authorityProjection.marketPools },
                };
              },
            };
          },
        }
      : {}),
  });

  return {
    rootDir: input.rootDir,
    manifestId: resolvedManifest.id,
    registry,
    partitions,
    societyDirectory,
    socialInteractions,
    societyProjection,
    authorityEnabled,
    ...(authority === undefined ? {} : { authority }),
    materializers,
  };
}

function createAuthoritySeed(input: {
  readonly manifestId: string;
  readonly partitions: readonly LocalSimulationRuntimeHostPartition[];
}): SimulationWideAuthoritySeed {
  if (input.partitions.length === 0) {
    throw new Error('simulation-wide authority requires at least one partition');
  }
  const seedPartition = input.partitions[0];
  if (seedPartition === undefined) {
    throw new Error('simulation-wide authority seed partition is missing');
  }
  const owners = input.partitions.flatMap((partition) =>
    Object.keys(partition.bootstrap.initialProjection.agents).map((agentId) => ({
      agentId: agentId as AgentId,
      partitionKey: partition.partitionKey,
    })),
  );
  return {
    manifestId: input.manifestId,
    simulationId: seedPartition.simulationId,
    projection: mergeSeedProjection(input.partitions),
    owners,
    partitionKeys: input.partitions.map((partition) => partition.partitionKey),
  };
}

/**
 * Builds one simulation-wide seed projection from the partition initial
 * projections. Agents, locations and social relations are merged with a
 * uniqueness/divergence guard so the authority sees the whole town.
 *
 * Market pools are merged by their stored pool key. When no pool carries a
 * regionId the stored key is the bare commodity, so all partitions' pools for a
 * commodity collapse into ONE global pool per commodity by summing the reserves
 * — canonical profile seeds give every partition identical reserves, so summing
 * preserves the seed spot price while scaling pool depth with the town
 * population. When pools carry a regionId the stored key is the composite
 * `${regionId}::${commodity}`, so pools sharing a regionId merge within that
 * region while pools in different regions stay independent and prices diverge.
 * The merge behavior is therefore driven entirely by whether the seed pools are
 * region-tagged, not by a runtime switch: the switch only governs trade
 * settlement and agent decision context.
 *
 * money supply is the sum of every partition's money supply — the conserved
 * total town money. All partitions must declare the same pool key set; a
 * divergent key fails closed so no partition silently contributes a shallow pool.
 */
function mergeSeedProjection(
  partitions: readonly LocalSimulationRuntimeHostPartition[],
): WorldProjection {
  const base = partitions[0]!.bootstrap.initialProjection;
  const agents: Record<string, typeof base.agents[string]> = {};
  const locations: Record<string, typeof base.locations[string]> = {};
  const socialRelations: Record<string, typeof base.socialRelations[string]> = {};
  const marketPools: Record<string, AmmPool> = {};
  let moneySupply = 0;
  for (const partition of partitions) {
    const projection = partition.bootstrap.initialProjection;
    for (const [agentId, agent] of Object.entries(projection.agents)) {
      if (agents[agentId] !== undefined) {
        throw new Error(`simulation-wide authority seed has duplicate agent ${agentId}`);
      }
      agents[agentId] = agent;
    }
    for (const [locationId, location] of Object.entries(projection.locations)) {
      const existing = locations[locationId];
      if (existing !== undefined && stableStringify(existing) !== stableStringify(location)) {
        throw new Error(`simulation-wide authority seed location ${locationId} diverged`);
      }
      locations[locationId] = location;
    }
    for (const [relationKey, relation] of Object.entries(projection.socialRelations)) {
      const existing = socialRelations[relationKey];
      if (existing !== undefined && stableStringify(existing) !== stableStringify(relation)) {
        throw new Error(`simulation-wide authority seed social relation ${relationKey} diverged`);
      }
      socialRelations[relationKey] = relation;
    }
    for (const [poolKey, pool] of Object.entries(projection.marketPools)) {
      const existing = marketPools[poolKey];
      marketPools[poolKey] =
        existing === undefined
          ? { ...pool }
          : {
              commodity: existing.commodity,
              commodityReserve: existing.commodityReserve + pool.commodityReserve,
              currencyReserve: existing.currencyReserve + pool.currencyReserve,
              ...(existing.regionId === undefined ? {} : { regionId: existing.regionId }),
            };
    }
    moneySupply += projection.moneySupply;
  }
  assertUniformPoolKeySet(partitions, marketPools);
  return {
    ...base,
    agents,
    locations,
    socialRelations,
    marketPools,
    moneySupply,
  };
}

/**
 * A unified market requires every partition to price the same pools. If a
 * partition is missing a pool key another partition has, summing would silently
 * produce a pool with fewer contributors and a distorted depth, so we fail
 * closed instead. Under regional markets the "pool key" is the composite
 * regional key, so every partition must declare the same regional coverage.
 */
function assertUniformPoolKeySet(
  partitions: readonly LocalSimulationRuntimeHostPartition[],
  mergedPools: Readonly<Record<string, AmmPool>>,
): void {
  const globalKeys = Object.keys(mergedPools).sort();
  for (const partition of partitions) {
    const partitionKeys = Object.keys(
      partition.bootstrap.initialProjection.marketPools,
    ).sort();
    if (stableStringify(partitionKeys) !== stableStringify(globalKeys)) {
      throw new Error(
        `simulation-wide authority seed partition ${partition.partitionKey} has a divergent pool key set`,
      );
    }
  }
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
