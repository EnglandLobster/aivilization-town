import {
  FileBranchPlanProgressRepository,
  FileBranchPlanRepository,
} from '@aivilization/agent-runtime';
import {
  FileAgentIntentionRepository,
  FileLongTermProfileRepository,
  FileShortTermMemoryRepository,
} from '@aivilization/memory';
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
  readonly memoryDir: string;
  readonly planningDir: string;
};

export type LocalWorldRuntimeRepositories = {
  readonly intentionRepository: FileAgentIntentionRepository;
  readonly longTermProfileRepository: FileLongTermProfileRepository;
  readonly shortTermMemoryRepository: FileShortTermMemoryRepository;
  readonly planRepository: FileBranchPlanRepository;
  readonly planProgressRepository: FileBranchPlanProgressRepository;
};

export type LocalWorldRuntimeStorage = {
  readonly partition: SimulationPartition;
  readonly eventStore: FileEventStore<WorldEvent>;
  readonly checkpointStore: FileProjectionCheckpointStore;
  readonly snapshotStore: FileProjectionSnapshotStore<WorldProjection>;
  readonly intentionRepository: FileAgentIntentionRepository;
  readonly longTermProfileRepository: FileLongTermProfileRepository;
  readonly shortTermMemoryRepository: FileShortTermMemoryRepository;
  readonly planRepository: FileBranchPlanRepository;
  readonly planProgressRepository: FileBranchPlanProgressRepository;
  readonly repositories: LocalWorldRuntimeRepositories;
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
  const intentionRepository = new FileAgentIntentionRepository({ rootDir: paths.memoryDir });
  const longTermProfileRepository = new FileLongTermProfileRepository({
    rootDir: paths.memoryDir,
  });
  const shortTermMemoryRepository = new FileShortTermMemoryRepository({
    rootDir: paths.memoryDir,
  });
  const planRepository = new FileBranchPlanRepository({
    rootDir: paths.planningDir,
  });
  const planProgressRepository = new FileBranchPlanProgressRepository({
    rootDir: paths.planningDir,
  });
  const repositories = {
    intentionRepository,
    longTermProfileRepository,
    shortTermMemoryRepository,
    planRepository,
    planProgressRepository,
  };
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
    intentionRepository,
    longTermProfileRepository,
    shortTermMemoryRepository,
    planRepository,
    planProgressRepository,
    repositories,
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
    memoryDir: join(partitionDir, 'memory'),
    planningDir: join(partitionDir, 'planning'),
  };
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}
