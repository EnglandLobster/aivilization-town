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
  FileCommandConsumerCheckpointStore,
  FileCommandStore,
  FileEventStore,
  FileProjectionCheckpointStore,
  FileProjectionSnapshotStore,
  createSimulationPartition,
  type PartitionKey,
  type SimulationPartition,
} from '@aivilization/sim-core';
import { FileAgentCycleTraceRepository } from '@aivilization/observability';
import type { WorldEvent, WorldProjection } from '@aivilization/world';
import { join, resolve } from 'node:path';
import type {
  WorkerTickProjectionCheckpointHydrationInput,
  WorkerTickProjectionCheckpointingInput,
} from './tickRunner';
import type { WorkerSteeringCommand } from './steering';
import { FileLocalSimulationLifecycleStateStore } from './localSimulationLifecycle';

export type LocalWorldRuntimeStoragePaths = {
  readonly rootDir: string;
  readonly simulationDir: string;
  readonly partitionDir: string;
  readonly commandStoreDir: string;
  readonly commandConsumerCheckpointStoreDir: string;
  readonly eventStoreDir: string;
  readonly checkpointStoreDir: string;
  readonly snapshotStoreDir: string;
  readonly lifecycleStateStoreDir: string;
  readonly memoryDir: string;
  readonly planningDir: string;
  readonly observabilityDir: string;
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
  readonly commandStore: FileCommandStore<WorkerSteeringCommand>;
  readonly commandConsumerCheckpointStore: FileCommandConsumerCheckpointStore;
  readonly eventStore: FileEventStore<WorldEvent>;
  readonly checkpointStore: FileProjectionCheckpointStore;
  readonly snapshotStore: FileProjectionSnapshotStore<WorldProjection>;
  readonly lifecycleStateStore: FileLocalSimulationLifecycleStateStore;
  readonly intentionRepository: FileAgentIntentionRepository;
  readonly longTermProfileRepository: FileLongTermProfileRepository;
  readonly shortTermMemoryRepository: FileShortTermMemoryRepository;
  readonly planRepository: FileBranchPlanRepository;
  readonly planProgressRepository: FileBranchPlanProgressRepository;
  readonly agentCycleTraceRepository: FileAgentCycleTraceRepository;
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
  const commandStore = new FileCommandStore<WorkerSteeringCommand>({
    rootDir: paths.commandStoreDir,
  });
  const commandConsumerCheckpointStore = new FileCommandConsumerCheckpointStore({
    rootDir: paths.commandConsumerCheckpointStoreDir,
  });
  const eventStore = new FileEventStore<WorldEvent>({ rootDir: paths.eventStoreDir });
  const checkpointStore = new FileProjectionCheckpointStore({
    rootDir: paths.checkpointStoreDir,
  });
  const snapshotStore = new FileProjectionSnapshotStore<WorldProjection>({
    rootDir: paths.snapshotStoreDir,
  });
  const lifecycleStateStore = new FileLocalSimulationLifecycleStateStore({
    rootDir: paths.lifecycleStateStoreDir,
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
  const agentCycleTraceRepository = new FileAgentCycleTraceRepository({
    rootDir: paths.observabilityDir,
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
    commandStore,
    commandConsumerCheckpointStore,
    eventStore,
    checkpointStore,
    snapshotStore,
    lifecycleStateStore,
    intentionRepository,
    longTermProfileRepository,
    shortTermMemoryRepository,
    planRepository,
    planProgressRepository,
    agentCycleTraceRepository,
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
    commandStoreDir: join(partitionDir, 'commands'),
    commandConsumerCheckpointStoreDir: join(partitionDir, 'command-consumer-checkpoints'),
    eventStoreDir: join(partitionDir, 'events'),
    checkpointStoreDir: join(partitionDir, 'checkpoints'),
    snapshotStoreDir: join(partitionDir, 'snapshots'),
    lifecycleStateStoreDir: join(partitionDir, 'lifecycle'),
    memoryDir: join(partitionDir, 'memory'),
    planningDir: join(partitionDir, 'planning'),
    observabilityDir: join(partitionDir, 'observability'),
  };
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}
