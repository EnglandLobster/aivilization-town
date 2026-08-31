import { createHash } from 'node:crypto';
import type { AgentId, PartitionKey, SimulationId } from '@aivilization/sim-core';
import { asAgentId, asSimulationId } from '@aivilization/sim-core';
import type { WorldAgentState, WorldProjection } from '@aivilization/world';
import type { LocalScenarioRuntimeBootstrapResult } from './localScenarioBootstrap';

export const LOCAL_SIMULATION_SOCIETY_DIRECTORY_SCHEMA_VERSION =
  'local-simulation-society-directory-v1';

export type LocalSimulationSocietyDirectoryAgent = {
  readonly agentId: AgentId;
  readonly ownerPartitionKey: PartitionKey;
  readonly ownerLastAppliedSequence: number;
  readonly publicState: {
    readonly locationId: WorldAgentState['locationId'];
    readonly job: WorldAgentState['job'];
    readonly residentialTier: number;
    readonly educationScore: number;
    readonly displayName?: string;
    readonly activityAvailableAt?: number;
    readonly transit?: {
      readonly fromLocationId: string;
      readonly toLocationId: string;
      readonly routeLocationIds?: readonly string[];
      readonly spatialPolicyVersion?: string;
      readonly baseTravelDurationSeconds?: number;
      readonly congestionMultiplier?: number;
      readonly travelDurationSeconds?: number;
      readonly departedAt: number;
      readonly arrivesAt: number;
    };
  };
};

export type LocalSimulationSocietyDirectory = {
  readonly schemaVersion: typeof LOCAL_SIMULATION_SOCIETY_DIRECTORY_SCHEMA_VERSION;
  readonly directoryId: string;
  readonly manifestId: string;
  readonly simulationId: SimulationId;
  readonly partitionBoundaries: readonly {
    readonly partitionKey: PartitionKey;
    readonly lastAppliedSequence: number;
    readonly snapshotSequence: number;
    readonly simulationTime: number;
  }[];
  readonly agents: readonly LocalSimulationSocietyDirectoryAgent[];
};

export type LocalSimulationSocietyDirectoryService = {
  readonly listSimulationIds: () => readonly SimulationId[];
  readonly getDirectory: (input: {
    readonly simulationId: string;
  }) => LocalSimulationSocietyDirectory;
  readonly getAgent: (input: {
    readonly simulationId: string;
    readonly agentId: string;
  }) => LocalSimulationSocietyDirectoryAgent | undefined;
};

export type LocalSimulationSocietyDirectoryPartitionSource = {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly bootstrap: LocalScenarioRuntimeBootstrapResult;
};

export function createLocalSimulationSocietyDirectoryService(input: {
  readonly manifestId: string;
  readonly partitions: readonly LocalSimulationSocietyDirectoryPartitionSource[];
}): LocalSimulationSocietyDirectoryService {
  assertNonEmpty(input.manifestId, 'manifestId');
  const simulationIds = [
    ...new Set(input.partitions.map((partition) => partition.simulationId)),
  ].sort();
  if (simulationIds.length === 0) {
    throw new Error('society directory requires at least one simulation partition');
  }

  const getDirectory = ({
    simulationId: requestedSimulationId,
  }: {
    readonly simulationId: string;
  }): LocalSimulationSocietyDirectory => {
    const simulationId = asSimulationId(requestedSimulationId);
    const partitions = input.partitions
      .filter((partition) => partition.simulationId === simulationId)
      .sort((left, right) => left.partitionKey.localeCompare(right.partitionKey));
    if (partitions.length === 0) {
      throw new Error(`unknown society simulation ${simulationId}`);
    }
    const boundaries: LocalSimulationSocietyDirectory['partitionBoundaries'][number][] = [];
    const agents: LocalSimulationSocietyDirectoryAgent[] = [];
    const ownerByAgentId = new Map<AgentId, PartitionKey>();
    for (const partition of partitions) {
      const checkpoint = partition.bootstrap.storage.checkpointStore.getLatestCheckpoint({
        simulationId,
        partitionKey: partition.partitionKey,
      });
      if (checkpoint?.snapshot === undefined) {
        throw new Error(
          `society directory partition ${partition.partitionKey} has no durable snapshot boundary`,
        );
      }
      const projection = partition.bootstrap.storage.snapshotStore.loadSnapshot(
        checkpoint.snapshot,
      );
      if (projection === undefined) {
        throw new Error(
          `society directory partition ${partition.partitionKey} snapshot is missing`,
        );
      }
      boundaries.push({
        partitionKey: partition.partitionKey,
        lastAppliedSequence: checkpoint.lastAppliedSequence,
        snapshotSequence: checkpoint.snapshot.sequence,
        simulationTime: projection.clock.now,
      });
      for (const agent of Object.values(projection.agents).sort((left, right) =>
        left.agentId.localeCompare(right.agentId),
      )) {
        const existingOwner = ownerByAgentId.get(agent.agentId);
        if (existingOwner !== undefined) {
          throw new Error(
            `duplicate society agent ${agent.agentId} owned by ${existingOwner} and ${partition.partitionKey}`,
          );
        }
        ownerByAgentId.set(agent.agentId, partition.partitionKey);
        agents.push(
          createDirectoryAgent({
            agent,
            projection,
            partitionKey: partition.partitionKey,
            lastAppliedSequence: checkpoint.lastAppliedSequence,
          }),
        );
      }
    }
    agents.sort((left, right) => left.agentId.localeCompare(right.agentId));
    const withoutId: Omit<LocalSimulationSocietyDirectory, 'directoryId'> = {
      schemaVersion: LOCAL_SIMULATION_SOCIETY_DIRECTORY_SCHEMA_VERSION,
      manifestId: input.manifestId,
      simulationId,
      partitionBoundaries: boundaries,
      agents,
    };
    return {
      ...withoutId,
      directoryId: `local-simulation-society-directory:sha256:${sha256(
        stableStringify(withoutId),
      )}`,
    };
  };

  // Validate global uniqueness at composition time instead of waiting for the
  // first API consumer. Subsequent reads repeat the validation so dynamically
  // registered duplicate identities also fail closed.
  for (const simulationId of simulationIds) getDirectory({ simulationId });

  return {
    listSimulationIds: () => simulationIds.map(asSimulationId),
    getDirectory,
    getAgent({ simulationId, agentId }) {
      const normalizedAgentId = asAgentId(agentId);
      return getDirectory({ simulationId }).agents.find(
        (agent) => agent.agentId === normalizedAgentId,
      );
    },
  };
}

function createDirectoryAgent(input: {
  readonly agent: WorldAgentState;
  readonly projection: WorldProjection;
  readonly partitionKey: PartitionKey;
  readonly lastAppliedSequence: number;
}): LocalSimulationSocietyDirectoryAgent {
  const activity = input.projection.activityTimeByAgent[input.agent.agentId];
  const transit = input.projection.transitByAgent?.[input.agent.agentId];
  return {
    agentId: input.agent.agentId,
    ownerPartitionKey: input.partitionKey,
    ownerLastAppliedSequence: input.lastAppliedSequence,
    publicState: {
      locationId: input.agent.locationId,
      job: input.agent.job,
      residentialTier: input.agent.residentialTier,
      educationScore: input.agent.educationScore,
      ...(input.agent.registration?.displayName === undefined
        ? {}
        : { displayName: input.agent.registration.displayName }),
      ...(activity === undefined ? {} : { activityAvailableAt: activity.availableAt }),
      ...(transit === undefined
        ? {}
        : {
            transit: {
              fromLocationId: transit.fromLocationId,
              toLocationId: transit.toLocationId,
              routeLocationIds: [...transit.routeLocationIds],
              spatialPolicyVersion: transit.spatialPolicyVersion,
              baseTravelDurationSeconds: transit.baseTravelDurationSeconds,
              congestionMultiplier: transit.congestionMultiplier,
              travelDurationSeconds: transit.travelDurationSeconds,
              departedAt: transit.departedAt,
              arrivesAt: transit.arrivesAt,
            },
          }),
    },
  };
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

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) throw new Error(`${name} must not be empty`);
}
