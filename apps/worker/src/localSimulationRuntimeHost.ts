import {
  type AgentId,
  asAgentId,
  type PartitionKey,
  type SimulationTimestamp,
} from '@aivilization/sim-core';
import type { AmmPool } from '@aivilization/economy';
import type { WorldProjection } from '@aivilization/world';
import type { AgentPostBulletinPayload } from '@aivilization/world';
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
  type ResolvedLocalSimulationRuntimeManifest,
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
import { captureAgentCognitiveSnapshot } from './agentCognitiveSnapshot';
import type { WorkerSteeringCommand } from './steering';
import {
  createAivilizationTownConditionsPolicy,
  createAivilizationTownWeatherPolicy,
  createAivilizationTownServiceQualityPolicy,
} from './aivilizationWorldPolicies';
import {
  resolveWorldCommandPolicies,
  type WorldCommandPolicySource,
} from './worldCommandPolicySource';

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
  /**
   * Opt-in town weather. When true, the
   * authority settles the simulation-wide weather Markov chain during time
   * advancement and emits WeatherChanged events. Omitted/false keeps the run
   * free of weather state and events, matching legacy behavior.
   */
  readonly townWeather?: boolean;
  /** Opt-in authority-settled regional service quality. */
  readonly townServiceQuality?: boolean;
  /** Opt-in authoritative town policy command settlement. */
  readonly townGovernance?: boolean;
  /**
   * Opt-in town-condition catalog. When
   * true, the society projection derives per-agent conditions from the
   * authority snapshot on every read. Omitted/false keeps the projection
   * condition-free, matching legacy behavior.
   */
  readonly townConditions?: boolean;
  /**
   * Opt-in town bulletin board. When
   * true, bulletins settle against the authority's single board and operator
   * IssueTownBulletin steering commands are wired to it. Omitted/false keeps
   * the run bulletin-free, matching legacy behavior.
   */
  readonly townBulletin?: boolean;
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
        ...(partition.initialTreasury === undefined ? {} : { treasury: partition.initialTreasury }),
        ...(partition.initialBankReserves === undefined
          ? {}
          : { bankReserves: partition.initialBankReserves }),
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
      ...(activeAuthorityOptions.regionalMarkets === true ? { regionalMarketsEnabled: true } : {}),
      ...(activeAuthorityOptions.townWeather === true
        ? { townWeather: createAivilizationTownWeatherPolicy() }
        : {}),
      ...(activeAuthorityOptions.townServiceQuality === true
        ? { townServiceQuality: createAivilizationTownServiceQualityPolicy() }
        : {}),
    });
    const lease = (): SimulationWideAuthorityMaterializerLease => materializeLease!;
    authority.recover({
      workerId: activeAuthorityOptions.workerId,
      observedAt: input.bootstrappedAt,
      durationMs: activeAuthorityOptions.leaseDurationMs,
    });
    const resolveLocationOwner = createLocationAffinityResolver(resolvedManifest);
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
      const partitionStorage = partition.bootstrap.storage;
      routers.set(
        partition.partitionKey,
        createSimulationCommandRouter({
          authority,
          lease,
          partitionKey: partition.partitionKey,
          deferLocalStateSync: true,
          resolveLocationOwner,
          captureCognitiveSnapshot: ({ agentId, capturedAt }) =>
            captureAgentCognitiveSnapshot({
              storage: partitionStorage,
              agentId: asAgentId(agentId),
              sourcePartitionKey: partition.partitionKey,
              capturedAt,
            }),
        }),
      );
    }
  }
  const authorityEnabled = authority !== undefined;
  // The simulation-wide authority is the only writer for the town-bank
  // aggregate. Partition ticks retain the original policy in the Agent context
  // (so banking can be planned), but must not run a second daily accrual loop.
  const partitionPolicies: WorldCommandPolicySource = authorityEnabled
    ? (projection) => {
        const { credit: authorityOwnedCredit, ...localPolicies } = resolveWorldCommandPolicies({
          policies: input.policies,
          projection,
        });
        void authorityOwnedCredit;
        return localPolicies;
      }
    : input.policies;

  const societyProjection = createLocalSimulationSocietyProjectionService({
    partitions,
    societyDirectory,
    ...(authorityOptions?.townConditions === true
      ? { conditionPolicy: createAivilizationTownConditionsPolicy() }
      : {}),
    ...(authority === undefined
      ? {}
      : {
          authoritySource: () => {
            const snapshot = authority.getSnapshot();
            return {
              projection: snapshot.projection,
              revision: snapshot.revision,
              latestFencingToken: snapshot.latestFencingToken,
            };
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
      policies: partitionPolicies,
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
              preTickMaterialize: async ({
                projection,
                issuedAt,
              }: {
                readonly projection: WorldProjection;
                readonly issuedAt: number;
              }) => {
                // Refresh the lease timestamp per invocation: the materializer
                // stamps checkpoint boundaries with the lease observedAt, so a
                // boot-time lease would age-trip the checkpoint freshness SLO
                // as uptime grows.
                const leaseNow: SimulationWideAuthorityMaterializerLease = {
                  workerId: materializeLease!.workerId,
                  observedAt: issuedAt,
                  durationMs: materializeLease!.durationMs,
                };
                // Publish the owner partition's complete post-tick state before
                // advancing the authority clock. Credit accrual must see every
                // borrower's latest balance, including Agents skipped as busy
                // during the previous action phase.
                router.syncPartitionState(projection);
                // Keep the authority clock level with the partition clocks so
                // in-transit travel settled globally completes on schedule and
                // its arrival deliveries are ready to materialize. Partitions
                // advance in lockstep; the deterministic target-keyed
                // operationId makes the second partition's call a no-op replay.
                const authorityClockNow = authority!.getSnapshot().projection.clock.now;
                if (authorityClockNow < projection.clock.now) {
                  authority!.advanceTime({
                    operationId: `advance-time-to:${projection.clock.now}`,
                    workerId: leaseNow.workerId,
                    observedAt: leaseNow.observedAt,
                    durationMs: leaseNow.durationMs,
                    deltaMs: projection.clock.now - authorityClockNow,
                  });
                }
                const result = await materialize({ lease: leaseNow });
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
              // Operator town bulletins settle against the one authoritative
              // board; only wired when the town-bulletin switch is on.
              ...(authorityOptions?.townBulletin === true
                ? {
                    townBulletinIssuer: ({
                      command,
                    }: {
                      readonly command: WorkerSteeringCommand;
                    }): {
                      readonly bulletinId: string;
                      readonly status: 'posted' | 'scheduled';
                    } => {
                      const operation = authority!.settleBulletin({
                        operationId: `steering-bulletin:${command.id}`,
                        workerId: materializeLease!.workerId,
                        observedAt: command.issuedAt,
                        durationMs: materializeLease!.durationMs,
                        bulletin: command.payload as AgentPostBulletinPayload,
                        ...(command.humanAttribution === undefined
                          ? {}
                          : { humanAttribution: command.humanAttribution }),
                      });
                      return { bulletinId: operation.bulletinId, status: operation.status };
                    },
                  }
                : {}),
              ...(authorityOptions?.townGovernance === true
                ? {
                    townGovernanceIssuer: ({
                      command,
                    }: {
                      readonly command: WorkerSteeringCommand;
                    }): {
                      readonly policyKind: 'tax' | 'public-budget' | 'subsidy';
                      readonly governanceRevision: number;
                    } => {
                      if (
                        command.type !== 'SetTaxPolicy' &&
                        command.type !== 'SetPublicBudget' &&
                        command.type !== 'SetSubsidyPolicy'
                      ) {
                        throw new Error(`unsupported governance command ${command.type}`);
                      }
                      const operation = authority!.settleGovernance({
                        operationId: `steering-governance:${command.id}`,
                        workerId: materializeLease!.workerId,
                        observedAt: command.issuedAt,
                        durationMs: materializeLease!.durationMs,
                        commandType: command.type,
                        payload: command.payload,
                        ...(command.actorId === undefined ? {} : { actorAgentId: command.actorId }),
                        ...(command.humanAttribution === undefined
                          ? {}
                          : { humanAttribution: command.humanAttribution }),
                      });
                      const changed = operation.events.find(
                        (event) => event.type === 'GovernancePolicyChanged',
                      );
                      if (changed?.type !== 'GovernancePolicyChanged') {
                        throw new Error('governance operation produced no policy event');
                      }
                      return {
                        policyKind: changed.payload.policyKind,
                        governanceRevision: operation.governanceRevision,
                      };
                    },
                  }
                : {}),
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

/**
 * Build the location-affinity resolver from manifest declarations. Affinity is
 * explicit and conflict-free by construction: a location claimed by two
 * partitions fails bootstrap closed, and unclaimed locations resolve to
 * undefined so movers keep their current owner.
 */
function createLocationAffinityResolver(
  resolvedManifest: ResolvedLocalSimulationRuntimeManifest,
): (locationId: string) => PartitionKey | undefined {
  const ownerByLocation = new Map<string, PartitionKey>();
  for (const partition of resolvedManifest.partitions) {
    for (const locationId of partition.ownedLocationIds ?? []) {
      const existing = ownerByLocation.get(locationId);
      if (existing !== undefined && existing !== partition.partitionKey) {
        throw new Error(
          `location ${locationId} is claimed by both ${existing} and ${partition.partitionKey}; affinity must be unambiguous`,
        );
      }
      ownerByLocation.set(locationId, partition.partitionKey);
    }
  }
  return (locationId) => ownerByLocation.get(locationId);
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
 * Money supply, treasury cash, and pristine bank reserves are summed across
 * partitions because each partition seed contributes circulating accounts to
 * the one town ledger. A non-pristine seed bank fails closed: merging live
 * deposit/loan books by arithmetic would invent a second banking history.
 * All partitions must declare the same pool key set; a divergent key fails
 * closed so no partition silently contributes a shallow pool.
 */
function mergeSeedProjection(
  partitions: readonly LocalSimulationRuntimeHostPartition[],
): WorldProjection {
  const base = partitions[0]!.bootstrap.initialProjection;
  const agents: Record<string, (typeof base.agents)[string]> = {};
  const locations: Record<string, (typeof base.locations)[string]> = {};
  const socialRelations: Record<string, (typeof base.socialRelations)[string]> = {};
  const marketPools: Record<string, AmmPool> = {};
  let moneySupply = 0;
  let treasury = 0;
  let hasTreasury = false;
  let bankBalance = 0;
  let hasBank = false;
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
    if (projection.treasury !== undefined) {
      hasTreasury = true;
      treasury += projection.treasury;
    }
    if (projection.bank !== undefined) {
      if (
        Object.keys(projection.bank.deposits).length > 0 ||
        Object.keys(projection.bank.loans).length > 0 ||
        Object.keys(projection.bank.creditHistoryByAgent).length > 0
      ) {
        throw new Error(
          `simulation-wide authority seed partition ${partition.partitionKey} has a non-pristine bank ledger`,
        );
      }
      hasBank = true;
      bankBalance += projection.bank.balance;
    }
  }
  assertUniformPoolKeySet(partitions, marketPools);
  return {
    ...base,
    agents,
    locations,
    socialRelations,
    marketPools,
    moneySupply,
    ...(hasTreasury ? { treasury } : {}),
    ...(hasBank
      ? {
          bank: {
            balance: bankBalance,
            deposits: {},
            loans: {},
            creditHistoryByAgent: {},
          },
        }
      : {}),
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
    const partitionKeys = Object.keys(partition.bootstrap.initialProjection.marketPools).sort();
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
