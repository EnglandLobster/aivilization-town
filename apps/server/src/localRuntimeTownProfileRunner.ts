import {
  aivilizationScenarioDefaults,
  commodities,
  jobTiers,
  occupations,
} from '@aivilization/content';
import type { PartitionKey, SimulationTimestamp } from '@aivilization/sim-core';
import type { WorldCommandPolicies } from '@aivilization/world';
import {
  buildWorkerTickAgentsFromActivePlans,
  completeFinishedActiveObjectives,
  createCanonicalWorkerRuntimeResolver,
  renewMissingActiveObjectives,
  type LocalWorldRuntimeAgentProvider,
  type WorldCommandPolicyResolver,
  type WorldCommandPolicySource,
} from '@aivilization/worker';
import type { LocalRuntimeTownDaemonHealth } from './localRuntimeTownOrchestration';
import { createLocalRuntimeTownDaemonScenarioProfile } from './localRuntimeTownScenarioProfile';
import type { LocalRuntimeTownDaemonScenarioProfileId } from './localRuntimeTownScenarioProfile';
import { createLocalRuntimeTownApi } from './localRuntimeTownServer';

export type LocalRuntimeTownProfileRunnerInput = {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly rootDir: string;
  readonly cycleCount: number;
  readonly requestedAt: SimulationTimestamp;
  readonly cycleIntervalMs?: number;
  readonly policies?: WorldCommandPolicySource;
  readonly agentProvider?: LocalWorldRuntimeAgentProvider;
};

export type LocalRuntimeTownProfileRunnerPartitionSummary = {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly scenarioPresetId: string;
  readonly status: string;
  readonly health: string;
  readonly lastAppliedSequence: number;
  readonly streamVersion: number;
  readonly eventCount: number;
  readonly projectionAgentCount: number;
  readonly agentTraceCount: number;
};

export type LocalRuntimeTownProfileRunnerSummary = {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly manifestId: string;
  readonly rootDir: string;
  readonly requestedAt: SimulationTimestamp;
  readonly daemonHealth: LocalRuntimeTownDaemonHealth;
  readonly partitionCount: number;
  readonly totalProjectionAgentCount: number;
  readonly totalEventCount: number;
  readonly totalAgentTraceCount: number;
  readonly run: {
    readonly traceId: string;
    readonly outcome: string;
    readonly requestedCycleCount: number;
    readonly completedCycleCount: number;
    readonly stopReason: string;
  };
  readonly partitions: readonly LocalRuntimeTownProfileRunnerPartitionSummary[];
};

export async function runLocalRuntimeTownDaemonScenarioProfile(
  input: LocalRuntimeTownProfileRunnerInput,
): Promise<LocalRuntimeTownProfileRunnerSummary> {
  assertNonEmpty(input.rootDir, 'rootDir');
  assertPositiveInteger(input.cycleCount, 'cycleCount');
  assertNonNegativeFinite(input.requestedAt, 'requestedAt');
  if (input.cycleIntervalMs !== undefined) {
    assertNonNegativeFinite(input.cycleIntervalMs, 'cycleIntervalMs');
  }

  const profile = createLocalRuntimeTownDaemonScenarioProfile(input.profileId);
  const policies = input.policies ?? createLocalRuntimeTownProfileWorldPolicies();
  const agentProvider =
    input.agentProvider ?? createLocalRuntimeTownProfileAgentProvider({ policies });
  const runtime = await createLocalRuntimeTownApi({
    rootDir: input.rootDir,
    bootstrappedAt: input.requestedAt,
    manifest: profile.manifest,
    scenarioPresets: profile.scenarioPresets,
    policies,
    localizedPlanners: [],
    steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
    agents: [],
    agentProvider,
    runtimeRunQueue: profile.runtimeRunQueue,
    runtimeScheduler: profile.runtimeScheduler,
    runtimeRecovery: profile.runtimeRecovery,
  });
  const run = await runtime.supervisor.runCycles({
    operationId: `${profile.manifest.id}:profile-run:${input.requestedAt}`,
    requestedAt: input.requestedAt,
    cycleCount: input.cycleCount,
    ...(input.cycleIntervalMs === undefined ? {} : { cycleIntervalMs: input.cycleIntervalMs }),
  });
  const daemonStatus = await runtime.runtimeDaemonApi.getRuntimeDaemonStatus();
  const partitions = await Promise.all(
    runtime.host.partitions.map(async (partition) => {
      const backend = runtime.host.registry.getBackend({
        simulationId: partition.simulationId,
        partitionKey: partition.partitionKey,
      });
      const projection = await backend.projectionQueries.getProjection({
        simulationId: partition.simulationId,
        partitionKey: partition.partitionKey,
      });
      const traces = await backend.storage.agentCycleTraceRepository.query({
        simulationId: partition.simulationId,
      });
      const status = run.status.partitions.find(
        (candidate) =>
          candidate.simulationId === partition.simulationId &&
          candidate.partitionKey === partition.partitionKey,
      );

      return {
        simulationId: partition.simulationId,
        partitionKey: partition.partitionKey,
        scenarioPresetId: partition.scenarioPresetId,
        status: status?.status ?? 'unknown',
        health: status?.health ?? 'attention',
        lastAppliedSequence: projection.lastAppliedSequence,
        streamVersion: projection.streamVersion,
        eventCount: backend.storage.eventStore.getStreamVersion(
          backend.storage.partition.eventStreamName,
        ),
        projectionAgentCount: Object.keys(projection.projection.agents).length,
        agentTraceCount: traces.length,
      };
    }),
  );

  return {
    profileId: profile.profileId,
    manifestId: profile.manifest.id,
    rootDir: input.rootDir,
    requestedAt: input.requestedAt,
    daemonHealth: daemonStatus.health,
    partitionCount: partitions.length,
    totalProjectionAgentCount: sumBy(partitions, (partition) => partition.projectionAgentCount),
    totalEventCount: sumBy(partitions, (partition) => partition.eventCount),
    totalAgentTraceCount: sumBy(partitions, (partition) => partition.agentTraceCount),
    run: {
      traceId: run.traceId,
      outcome: run.outcome,
      requestedCycleCount: run.requestedCycleCount,
      completedCycleCount: run.completedCycleCount,
      stopReason: run.stopReason,
    },
    partitions,
  };
}

export function createLocalRuntimeTownProfileAgentProvider(
  input: {
    readonly policies?: WorldCommandPolicySource;
  } = {},
): LocalWorldRuntimeAgentProvider {
  const policies = input.policies ?? createLocalRuntimeTownProfileWorldPolicies();

  return async ({ storage, projection, issuedAt }) => {
    await completeFinishedActiveObjectives({
      projection,
      intentionRepository: storage.intentionRepository,
      planRepository: storage.planRepository,
      planProgressRepository: storage.planProgressRepository,
      completedAt: issuedAt,
    });
    await renewMissingActiveObjectives({
      projection,
      intentionRepository: storage.intentionRepository,
      longTermProfileRepository: storage.longTermProfileRepository,
      shortTermMemoryRepository: storage.shortTermMemoryRepository,
      planRepository: storage.planRepository,
      issuedAt,
    });

    return buildWorkerTickAgentsFromActivePlans({
      projection,
      intentionRepository: storage.intentionRepository,
      planRepository: storage.planRepository,
      planProgressRepository: storage.planProgressRepository,
      resolveRuntime: createCanonicalWorkerRuntimeResolver({
        simulationId: storage.partition.simulationId,
        policies,
        issuedAt,
        commandIdPrefix: `${storage.partition.partitionKey}:profile-provider:${issuedAt}`,
      }),
    });
  };
}

export function createLocalRuntimeTownProfileWorldPolicies(): WorldCommandPolicyResolver {
  return (projection) => {
    const educationScores = Object.values(projection.agents).map((agent) => agent.educationScore);
    return createLocalRuntimeTownProfileWorldPoliciesSnapshot(educationScores);
  };
}

function createLocalRuntimeTownProfileWorldPoliciesSnapshot(
  populationEducationScores: readonly number[],
): WorldCommandPolicies {
  return {
    satietyRecoveryByCommodity: createSatietyRecoveryByCommodity(),
    maxSatiety: aivilizationScenarioDefaults.maxPhysiology.satiety,
    wageCalculator: calculateOccupationWage,
    laborCost: {
      energyCostPerHour: 10,
      satietyCostPerHour: 10,
    },
    criticalThresholds: {
      energy: 1,
      health: 1,
    },
    sleep: {
      energyRecoveryPerSecond: 1,
      maxEnergy: aivilizationScenarioDefaults.maxPhysiology.energy,
    },
    seeDoctor: {
      healthRecoveryPerSecond: 1,
      maxHealth: aivilizationScenarioDefaults.maxPhysiology.health,
    },
    jobApplication: {
      populationEducationScores,
      quotaByResidentialTier: [1000, 1000, 1000, 1000, 1000, 1000],
    },
    residentialTierUpgrade: {
      maxResidentialTier: 6,
      costs: jobTiers
        .filter((tier) => tier.tier > 1)
        .map((tier) => ({
          targetResidentialTier: tier.tier,
          currencyCost: tier.tier * 100,
          minEducationScore: tier.minEducationScore,
          ...(tier.prerequisiteCommodity === null
            ? {}
            : { inventoryCosts: { [tier.prerequisiteCommodity]: 1 } }),
        })),
    },
  };
}

function createSatietyRecoveryByCommodity(): Record<string, number> {
  const recoveries: Record<string, number> = {};
  for (const commodity of commodities) {
    if (commodity.tier === 'Primary' && commodity.role.toLowerCase().includes('food')) {
      recoveries[commodity.name] = 25;
    }
    if (commodity.tier === 'SecondaryProcessedFood') {
      recoveries[commodity.name] = 50;
    }
  }
  return recoveries;
}

function calculateOccupationWage(occupationName: string): number {
  const occupation = occupations.find((candidate) => candidate.name === occupationName);
  if (occupation === undefined) {
    throw new Error(`unknown occupation: ${occupationName}`);
  }
  return occupation.baseWage;
}

function sumBy<TValue>(values: readonly TValue[], project: (value: TValue) => number): number {
  return values.reduce((total, value) => total + project(value), 0);
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
}
