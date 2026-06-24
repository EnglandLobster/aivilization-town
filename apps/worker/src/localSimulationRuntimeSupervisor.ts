import type { PartitionKey, SimulationTimestamp } from '@aivilization/sim-core';
import type {
  LocalSimulationLifecyclePauseResult,
  LocalSimulationLifecycleStartResult,
  LocalSimulationLifecycleStatus,
} from './localSimulationLifecycle';
import type { LocalSimulationBackendLifecycleResult } from './localSimulationBackend';
import type { LocalSimulationRuntimeHost } from './localSimulationRuntimeHost';

export type LocalSimulationRuntimeSupervisorHealth = 'healthy' | 'attention';

export type LocalSimulationRuntimeSupervisorPartitionStatus =
  | 'bootstrapped'
  | LocalSimulationLifecycleStatus;

export type LocalSimulationRuntimeSupervisorPartition = {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly scenarioPresetId: string;
  readonly status: LocalSimulationRuntimeSupervisorPartitionStatus;
  readonly health: LocalSimulationRuntimeSupervisorHealth;
  readonly initializedCheckpoint: boolean;
  readonly seededAgentCount: number;
  readonly skippedAgentCount: number;
  readonly lastAppliedSequence: number;
  readonly nextTickIndex?: number;
  readonly updatedAt?: SimulationTimestamp;
};

export type LocalSimulationRuntimeSupervisorStatus = {
  readonly manifestId: string;
  readonly partitionCount: number;
  readonly healthyPartitionCount: number;
  readonly attentionPartitionCount: number;
  readonly partitions: readonly LocalSimulationRuntimeSupervisorPartition[];
};

export type LocalSimulationRuntimeSupervisorRequest = {
  readonly requestedAt: SimulationTimestamp;
};

export type LocalSimulationRuntimeSupervisorCommandOutcome =
  | 'succeeded'
  | 'partial-failure'
  | 'failed';

export type LocalSimulationRuntimeSupervisorPartitionCommandError = {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
};

export type LocalSimulationRuntimeSupervisorPartitionCommandSuccess<
  TStatus extends string,
  TResult,
> = {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly outcome: 'succeeded';
  readonly status: TStatus;
  readonly result: TResult;
};

export type LocalSimulationRuntimeSupervisorPartitionCommandFailure = {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly outcome: 'failed';
  readonly status: 'failed';
  readonly error: LocalSimulationRuntimeSupervisorPartitionCommandError;
};

export type LocalSimulationRuntimeSupervisorStartPartitionResult =
  | LocalSimulationRuntimeSupervisorPartitionCommandSuccess<
      LocalSimulationLifecycleStartResult['status'],
      LocalSimulationLifecycleStartResult
    >
  | LocalSimulationRuntimeSupervisorPartitionCommandFailure;

export type LocalSimulationRuntimeSupervisorPausePartitionResult =
  | LocalSimulationRuntimeSupervisorPartitionCommandSuccess<
      LocalSimulationLifecyclePauseResult['status'],
      LocalSimulationLifecyclePauseResult
    >
  | LocalSimulationRuntimeSupervisorPartitionCommandFailure;

export type LocalSimulationRuntimeSupervisorStartAllResult = {
  readonly outcome: LocalSimulationRuntimeSupervisorCommandOutcome;
  readonly succeededPartitionCount: number;
  readonly failedPartitionCount: number;
  readonly partitions: readonly LocalSimulationRuntimeSupervisorStartPartitionResult[];
  readonly status: LocalSimulationRuntimeSupervisorStatus;
};

export type LocalSimulationRuntimeSupervisorPauseAllResult = {
  readonly outcome: LocalSimulationRuntimeSupervisorCommandOutcome;
  readonly succeededPartitionCount: number;
  readonly failedPartitionCount: number;
  readonly partitions: readonly LocalSimulationRuntimeSupervisorPausePartitionResult[];
  readonly status: LocalSimulationRuntimeSupervisorStatus;
};

export type LocalSimulationRuntimeSupervisor = {
  readonly getStatus: () => LocalSimulationRuntimeSupervisorStatus;
  readonly startAll: (
    request: LocalSimulationRuntimeSupervisorRequest,
  ) => Promise<LocalSimulationRuntimeSupervisorStartAllResult>;
  readonly pauseAll: (
    request: LocalSimulationRuntimeSupervisorRequest,
  ) => Promise<LocalSimulationRuntimeSupervisorPauseAllResult>;
};

export function createLocalSimulationRuntimeSupervisor(input: {
  readonly host: LocalSimulationRuntimeHost;
}): LocalSimulationRuntimeSupervisor {
  return {
    getStatus: () => createSupervisorStatus(input.host),
    startAll: async (request) => {
      assertNonNegativeFinite(request.requestedAt, 'requestedAt');
      const partitions = await Promise.all(
        input.host.partitions.map(async (partition) => {
          try {
            const result = assertStartResult(
              await input.host.registry.api.startSimulation({
                simulationId: partition.simulationId,
                partitionKey: partition.partitionKey,
                requestedAt: request.requestedAt,
              }),
            );
            return {
              simulationId: partition.simulationId,
              partitionKey: partition.partitionKey,
              outcome: 'succeeded' as const,
              status: result.status,
              result,
            };
          } catch (error) {
            return createPartitionCommandFailure(partition, error);
          }
        }),
      );
      return createBulkCommandResult({
        partitions,
        status: createSupervisorStatus(input.host),
      });
    },
    pauseAll: async (request) => {
      assertNonNegativeFinite(request.requestedAt, 'requestedAt');
      const partitions = await Promise.all(
        input.host.partitions.map(async (partition) => {
          try {
            const result = assertPauseResult(
              await input.host.registry.api.pauseSimulation({
                simulationId: partition.simulationId,
                partitionKey: partition.partitionKey,
                requestedAt: request.requestedAt,
              }),
            );
            return {
              simulationId: partition.simulationId,
              partitionKey: partition.partitionKey,
              outcome: 'succeeded' as const,
              status: result.status,
              result,
            };
          } catch (error) {
            return createPartitionCommandFailure(partition, error);
          }
        }),
      );
      return createBulkCommandResult({
        partitions,
        status: createSupervisorStatus(input.host),
      });
    },
  };
}

function createBulkCommandResult<
  TPartition extends
    | LocalSimulationRuntimeSupervisorStartPartitionResult
    | LocalSimulationRuntimeSupervisorPausePartitionResult,
>(input: {
  readonly partitions: readonly TPartition[];
  readonly status: LocalSimulationRuntimeSupervisorStatus;
}): {
  readonly outcome: LocalSimulationRuntimeSupervisorCommandOutcome;
  readonly succeededPartitionCount: number;
  readonly failedPartitionCount: number;
  readonly partitions: readonly TPartition[];
  readonly status: LocalSimulationRuntimeSupervisorStatus;
} {
  const failedPartitionCount = input.partitions.filter(
    (partition) => partition.outcome === 'failed',
  ).length;
  const succeededPartitionCount = input.partitions.length - failedPartitionCount;

  return {
    outcome: createCommandOutcome({
      partitionCount: input.partitions.length,
      failedPartitionCount,
    }),
    succeededPartitionCount,
    failedPartitionCount,
    partitions: input.partitions,
    status: input.status,
  };
}

function createSupervisorStatus(
  host: LocalSimulationRuntimeHost,
): LocalSimulationRuntimeSupervisorStatus {
  const partitions = host.partitions.map((partition): LocalSimulationRuntimeSupervisorPartition => {
    const lifecycleState = partition.bootstrap.storage.lifecycleStateStore.getState({
      simulationId: partition.simulationId,
      partitionKey: partition.partitionKey,
    });
    const status: LocalSimulationRuntimeSupervisorPartitionStatus =
      lifecycleState?.status ?? 'bootstrapped';
    const health: LocalSimulationRuntimeSupervisorHealth = statusRequiresAttention(status)
      ? 'attention'
      : 'healthy';

    return {
      simulationId: partition.simulationId,
      partitionKey: partition.partitionKey,
      scenarioPresetId: partition.scenarioPresetId,
      status,
      health,
      initializedCheckpoint: partition.bootstrap.initializedCheckpoint,
      seededAgentCount: partition.bootstrap.profileSeeding.seededAgentIds.length,
      skippedAgentCount: partition.bootstrap.profileSeeding.skippedAgentIds.length,
      lastAppliedSequence:
        lifecycleState?.lastAppliedSequence ?? partition.bootstrap.checkpoint.lastAppliedSequence,
      ...(lifecycleState === undefined ? {} : { nextTickIndex: lifecycleState.nextTickIndex }),
      ...(lifecycleState === undefined ? {} : { updatedAt: lifecycleState.updatedAt }),
    };
  });
  const healthyPartitionCount = partitions.filter(
    (partition) => partition.health === 'healthy',
  ).length;

  return {
    manifestId: host.manifestId,
    partitionCount: partitions.length,
    healthyPartitionCount,
    attentionPartitionCount: partitions.length - healthyPartitionCount,
    partitions,
  };
}

function statusRequiresAttention(status: LocalSimulationRuntimeSupervisorPartitionStatus): boolean {
  return status === 'command-drain-failed' || status === 'reset-requested';
}

function assertStartResult(
  result: LocalSimulationBackendLifecycleResult,
): LocalSimulationLifecycleStartResult {
  if (
    (result.status === 'completed' ||
      result.status === 'command-drain-failed' ||
      result.status === 'paused') &&
    'loop' in result
  ) {
    return result;
  }
  throw new Error(`expected start lifecycle result, received ${result.status}`);
}

function assertPauseResult(
  result: LocalSimulationBackendLifecycleResult,
): LocalSimulationLifecyclePauseResult {
  if (result.status === 'paused' && !('loop' in result)) {
    return result;
  }
  throw new Error(`expected pause lifecycle result, received ${result.status}`);
}

function createPartitionCommandFailure(
  partition: { readonly simulationId: string; readonly partitionKey: PartitionKey },
  error: unknown,
): LocalSimulationRuntimeSupervisorPartitionCommandFailure {
  return {
    simulationId: partition.simulationId,
    partitionKey: partition.partitionKey,
    outcome: 'failed',
    status: 'failed',
    error: serializeCommandError(error),
  };
}

function createCommandOutcome(input: {
  readonly partitionCount: number;
  readonly failedPartitionCount: number;
}): LocalSimulationRuntimeSupervisorCommandOutcome {
  if (input.failedPartitionCount === 0) {
    return 'succeeded';
  }
  if (input.failedPartitionCount === input.partitionCount) {
    return 'failed';
  }
  return 'partial-failure';
}

function serializeCommandError(
  error: unknown,
): LocalSimulationRuntimeSupervisorPartitionCommandError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  return {
    name: 'Error',
    message: String(error),
  };
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
}
