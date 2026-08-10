import type { ScenarioMarketPoolSeed, ScenarioPreset } from '@aivilization/content';
import type { PartitionKey, ProjectionCheckpoint, SnapshotReference } from '@aivilization/sim-core';
import { createProjectionCheckpoint, type SimulationTimestamp } from '@aivilization/sim-core';
import type { WorldProjection } from '@aivilization/world';
import {
  createLocalWorldRuntimeStorage,
  type LocalWorldRuntimeStorage,
} from './localRuntimeStorage';
import {
  seedLongTermProfilesFromScenario,
  type ScenarioProfileSeedingResult,
} from './scenarioProfileSeeding';
import { createWorldProjectionFromScenario } from './scenarioProjection';

export type LocalScenarioRuntimeBootstrapInput = {
  readonly rootDir: string;
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly preset: ScenarioPreset;
  readonly marketPools?: readonly ScenarioMarketPoolSeed[];
  readonly moneySupply?: number;
  readonly bootstrappedAt: SimulationTimestamp;
};

export type LocalScenarioRuntimeBootstrapResult = {
  readonly storage: LocalWorldRuntimeStorage;
  readonly initialProjection: WorldProjection;
  readonly profileSeeding: ScenarioProfileSeedingResult;
  readonly checkpoint: ProjectionCheckpoint;
  readonly snapshot: SnapshotReference;
  readonly initializedCheckpoint: boolean;
};

export async function bootstrapLocalScenarioRuntime(
  input: LocalScenarioRuntimeBootstrapInput,
): Promise<LocalScenarioRuntimeBootstrapResult> {
  const storage = createLocalWorldRuntimeStorage({
    rootDir: input.rootDir,
    simulationId: input.simulationId,
    partitionKey: input.partitionKey,
  });
  const initialProjection = createWorldProjectionFromScenario({
    preset: input.preset,
    ...(input.marketPools === undefined ? {} : { marketPools: input.marketPools }),
    ...(input.moneySupply === undefined ? {} : { moneySupply: input.moneySupply }),
  });
  const profileSeeding = await seedLongTermProfilesFromScenario({
    preset: input.preset,
    repository: storage.longTermProfileRepository,
    seededAt: input.bootstrappedAt,
  });

  const existingCheckpoint = storage.checkpointStore.getLatestCheckpoint({
    simulationId: storage.partition.simulationId,
    partitionKey: storage.partition.partitionKey,
  });
  if (existingCheckpoint?.snapshot !== undefined) {
    return {
      storage,
      initialProjection,
      profileSeeding,
      checkpoint: existingCheckpoint,
      snapshot: existingCheckpoint.snapshot,
      initializedCheckpoint: false,
    };
  }

  const snapshot = storage.snapshotStore.saveSnapshot({
    simulationId: storage.partition.simulationId,
    partitionKey: storage.partition.partitionKey,
    sequence: 0,
    createdAt: input.bootstrappedAt,
    projection: initialProjection,
  });
  const checkpoint = storage.checkpointStore.saveCheckpoint(
    createProjectionCheckpoint({
      simulationId: storage.partition.simulationId,
      partitionKey: storage.partition.partitionKey,
      lastAppliedSequence: 0,
      snapshot,
    }),
  );

  return {
    storage,
    initialProjection,
    profileSeeding,
    checkpoint,
    snapshot,
    initializedCheckpoint: true,
  };
}
