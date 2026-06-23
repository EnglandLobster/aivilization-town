import {
  FileEventStore,
  FileProjectionCheckpointStore,
  FileProjectionSnapshotStore,
  createSimulationPartition,
  type PartitionKey,
  type SimulationPartition,
} from '@aivilization/sim-core';
import type { WorldEvent, WorldProjection } from '@aivilization/world';
import { join, resolve } from 'node:path';
import type {
  WorkerTickProjectionCheckpointHydrationInput,
  WorkerTickProjectionCheckpointingInput,
} from './tickRunner';

export type LocalWorldRuntimeStoragePaths = {
  readonly rootDir: string;
  readonly simulationDir: string;
  readonly partitionDir: string;
  readonly eventStoreDir: string;
  readonly checkpointStoreDir: string;
  readonly snapshotStoreDir: string;
};

export type LocalWorldRuntimeStorage = {
  readonly partition: SimulationPartition;
  readonly eventStore: FileEventStore<WorldEvent>;
  readonly checkpointStore: FileProjectionCheckpointStore;
  readonly snapshotStore: FileProjectionSnapshotStore<WorldProjection>;
  readonly checkpointing: WorkerTickProjectionCheckpointingInput;
  readonly checkpointHydration: WorkerTickProjectionCheckpointHydrationInput;
  readonly paths: LocalWorldRuntimeStoragePaths;
};

export function createLocalWorldRuntimeStorage(input: {
  readonly rootDir: string;
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
}): LocalWorldRuntimeStorage {
  const partition = createSimulationPartition({
    simulationId: input.simulationId,
    partitionKey: input.partitionKey,
  });
  const paths = createLocalWorldRuntimeStoragePaths({
    rootDir: input.rootDir,
    simulationId: partition.simulationId,
    partitionKey: partition.partitionKey,
  });
  const eventStore = new FileEventStore<WorldEvent>({ rootDir: paths.eventStoreDir });
  const checkpointStore = new FileProjectionCheckpointStore({
    rootDir: paths.checkpointStoreDir,
  });
  const snapshotStore = new FileProjectionSnapshotStore<WorldProjection>({
    rootDir: paths.snapshotStoreDir,
  });
  const checkpointing = {
    partitionKey: partition.partitionKey,
    checkpointStore,
    snapshotStore,
  };

  return {
    partition,
    eventStore,
    checkpointStore,
    snapshotStore,
    checkpointing,
    checkpointHydration: checkpointing,
    paths,
  };
}

function createLocalWorldRuntimeStoragePaths(input: {
  readonly rootDir: string;
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
}): LocalWorldRuntimeStoragePaths {
  const rootDir = resolve(input.rootDir);
  const simulationDir = join(rootDir, 'simulations', encodePathSegment(input.simulationId));
  const partitionDir = join(simulationDir, 'partitions', encodePathSegment(input.partitionKey));

  return {
    rootDir,
    simulationDir,
    partitionDir,
    eventStoreDir: join(partitionDir, 'events'),
    checkpointStoreDir: join(partitionDir, 'checkpoints'),
    snapshotStoreDir: join(partitionDir, 'snapshots'),
  };
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}
