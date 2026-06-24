import type { PartitionKey, SimulationTimestamp } from '@aivilization/sim-core';
import { join } from 'node:path';
import type {
  LocalSimulationLifecycleValidationFailure,
  LocalSimulationLifecyclePauseResult,
  LocalSimulationLifecycleStartResult,
  LocalSimulationLifecycleStatus,
  LocalSimulationLifecycleValidationStatus,
} from './localSimulationLifecycle';
import type { LocalSimulationBackendLifecycleResult } from './localSimulationBackend';
import type { LocalSimulationRuntimeHost } from './localSimulationRuntimeHost';
import {
  FileLocalSimulationRuntimeOperationTraceRepository,
  type LocalSimulationRuntimeOperationCommand,
  type LocalSimulationRuntimeOperationTrace,
  type LocalSimulationRuntimeOperationTraceQuery,
  type LocalSimulationRuntimeOperationTraceRepository,
  type LocalSimulationRuntimeOperationValidationFailureTrace,
  type LocalSimulationRuntimeOperationValidationReportTrace,
} from './localSimulationRuntimeOperationTrace';

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
  readonly lastValidationStatus?: LocalSimulationLifecycleValidationStatus;
  readonly lastValidationReportRunId?: string;
  readonly lastValidationGeneratedAt?: SimulationTimestamp;
  readonly lastValidationFailure?: LocalSimulationLifecycleValidationFailure;
};

export type LocalSimulationRuntimeSupervisorStatus = {
  readonly manifestId: string;
  readonly partitionCount: number;
  readonly healthyPartitionCount: number;
  readonly attentionPartitionCount: number;
  readonly partitions: readonly LocalSimulationRuntimeSupervisorPartition[];
};

export type LocalSimulationRuntimeSupervisorRequest = {
  readonly operationId?: string;
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
  readonly traceId: string;
  readonly outcome: LocalSimulationRuntimeSupervisorCommandOutcome;
  readonly succeededPartitionCount: number;
  readonly failedPartitionCount: number;
  readonly partitions: readonly LocalSimulationRuntimeSupervisorStartPartitionResult[];
  readonly status: LocalSimulationRuntimeSupervisorStatus;
};

export type LocalSimulationRuntimeSupervisorPauseAllResult = {
  readonly traceId: string;
  readonly outcome: LocalSimulationRuntimeSupervisorCommandOutcome;
  readonly succeededPartitionCount: number;
  readonly failedPartitionCount: number;
  readonly partitions: readonly LocalSimulationRuntimeSupervisorPausePartitionResult[];
  readonly status: LocalSimulationRuntimeSupervisorStatus;
};

export type LocalSimulationRuntimeSupervisor = {
  readonly getStatus: () => LocalSimulationRuntimeSupervisorStatus;
  readonly getOperationTrace: (
    traceId: string,
  ) => Promise<LocalSimulationRuntimeOperationTrace | undefined>;
  readonly queryOperationTraces: (
    query: LocalSimulationRuntimeOperationTraceQuery,
  ) => Promise<LocalSimulationRuntimeOperationTrace[]>;
  readonly startAll: (
    request: LocalSimulationRuntimeSupervisorRequest,
  ) => Promise<LocalSimulationRuntimeSupervisorStartAllResult>;
  readonly pauseAll: (
    request: LocalSimulationRuntimeSupervisorRequest,
  ) => Promise<LocalSimulationRuntimeSupervisorPauseAllResult>;
};

export function createLocalSimulationRuntimeSupervisor(input: {
  readonly host: LocalSimulationRuntimeHost;
  readonly operationTraceRepository?: LocalSimulationRuntimeOperationTraceRepository;
}): LocalSimulationRuntimeSupervisor {
  const operationTraceRepository =
    input.operationTraceRepository ??
    new FileLocalSimulationRuntimeOperationTraceRepository({
      rootDir: join(input.host.rootDir, 'operations'),
    });

  return {
    getStatus: () => createSupervisorStatus(input.host),
    getOperationTrace: (traceId) => operationTraceRepository.get(traceId),
    queryOperationTraces: (query) => operationTraceRepository.query(query),
    startAll: async (request) => {
      assertNonNegativeFinite(request.requestedAt, 'requestedAt');
      const traceId = createOperationTraceId(input.host, 'start-all', request);
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
      const result = createBulkCommandResult({
        traceId,
        partitions,
        status: createSupervisorStatus(input.host),
      });
      await operationTraceRepository.record(
        createOperationTrace({
          traceId,
          host: input.host,
          command: 'start-all',
          requestedAt: request.requestedAt,
          result,
        }),
      );
      return result;
    },
    pauseAll: async (request) => {
      assertNonNegativeFinite(request.requestedAt, 'requestedAt');
      const traceId = createOperationTraceId(input.host, 'pause-all', request);
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
      const result = createBulkCommandResult({
        traceId,
        partitions,
        status: createSupervisorStatus(input.host),
      });
      await operationTraceRepository.record(
        createOperationTrace({
          traceId,
          host: input.host,
          command: 'pause-all',
          requestedAt: request.requestedAt,
          result,
        }),
      );
      return result;
    },
  };
}

function createBulkCommandResult<
  TPartition extends
    | LocalSimulationRuntimeSupervisorStartPartitionResult
    | LocalSimulationRuntimeSupervisorPausePartitionResult,
>(input: {
  readonly traceId: string;
  readonly partitions: readonly TPartition[];
  readonly status: LocalSimulationRuntimeSupervisorStatus;
}): {
  readonly traceId: string;
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
    traceId: input.traceId,
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

function createOperationTrace(input: {
  readonly traceId: string;
  readonly host: LocalSimulationRuntimeHost;
  readonly command: LocalSimulationRuntimeOperationCommand;
  readonly requestedAt: SimulationTimestamp;
  readonly result:
    | LocalSimulationRuntimeSupervisorStartAllResult
    | LocalSimulationRuntimeSupervisorPauseAllResult;
}): LocalSimulationRuntimeOperationTrace {
  return {
    traceId: input.traceId,
    manifestId: input.host.manifestId,
    command: input.command,
    requestedAt: input.requestedAt,
    recordedAt: input.requestedAt,
    outcome: input.result.outcome,
    succeededPartitionCount: input.result.succeededPartitionCount,
    failedPartitionCount: input.result.failedPartitionCount,
    partitions: input.result.partitions.map((partition) => {
      if (partition.outcome === 'failed') {
        return {
          simulationId: partition.simulationId,
          partitionKey: partition.partitionKey,
          outcome: partition.outcome,
          status: partition.status,
          error: partition.error,
        };
      }
      const validationReport = createOperationValidationReportTrace(partition.result);
      const validationFailure = createOperationValidationFailureTrace(partition.result);
      return {
        simulationId: partition.simulationId,
        partitionKey: partition.partitionKey,
        outcome: partition.outcome,
        status: partition.status,
        ...(validationReport === undefined ? {} : { validationReport }),
        ...(validationFailure === undefined ? {} : { validationFailure }),
      };
    }),
    status: input.result.status,
  };
}

function createOperationValidationReportTrace(
  result: LocalSimulationLifecycleStartResult | LocalSimulationLifecyclePauseResult,
): LocalSimulationRuntimeOperationValidationReportTrace | undefined {
  if (!('validationReport' in result) || result.validationReport === undefined) {
    return undefined;
  }

  const validationReport = result.validationReport;
  return {
    runId: validationReport.report.run.runId,
    generatedAt: validationReport.report.run.generatedAt,
    ...(validationReport.report.run.source === undefined
      ? {}
      : { source: validationReport.report.run.source }),
    streamVersion: validationReport.streamVersion,
    fromSequence: validationReport.fromSequence,
    toSequence: validationReport.toSequence,
    eventCount: validationReport.eventCount,
    projectionSequence: validationReport.projectionSequence,
  };
}

function createOperationValidationFailureTrace(
  result: LocalSimulationLifecycleStartResult | LocalSimulationLifecyclePauseResult,
): LocalSimulationRuntimeOperationValidationFailureTrace | undefined {
  if (!('validationFailure' in result) || result.validationFailure === undefined) {
    return undefined;
  }
  return {
    name: result.validationFailure.name,
    message: result.validationFailure.message,
    ...(result.validationFailure.stack === undefined
      ? {}
      : { stack: result.validationFailure.stack }),
  };
}

function createOperationTraceId(
  host: LocalSimulationRuntimeHost,
  command: LocalSimulationRuntimeOperationCommand,
  request: LocalSimulationRuntimeSupervisorRequest,
): string {
  if (request.operationId !== undefined) {
    assertNonEmpty(request.operationId, 'operationId');
    return request.operationId;
  }
  return `${host.manifestId}:${command}:${request.requestedAt}`;
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
    const health: LocalSimulationRuntimeSupervisorHealth = partitionRequiresAttention({
      status,
      lastValidationStatus: lifecycleState?.lastValidationStatus,
    })
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
      ...(lifecycleState?.lastValidationStatus === undefined
        ? {}
        : { lastValidationStatus: lifecycleState.lastValidationStatus }),
      ...(lifecycleState?.lastValidationReportRunId === undefined
        ? {}
        : { lastValidationReportRunId: lifecycleState.lastValidationReportRunId }),
      ...(lifecycleState?.lastValidationGeneratedAt === undefined
        ? {}
        : { lastValidationGeneratedAt: lifecycleState.lastValidationGeneratedAt }),
      ...(lifecycleState?.lastValidationFailure === undefined
        ? {}
        : { lastValidationFailure: lifecycleState.lastValidationFailure }),
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

function partitionRequiresAttention(input: {
  readonly status: LocalSimulationRuntimeSupervisorPartitionStatus;
  readonly lastValidationStatus: LocalSimulationLifecycleValidationStatus | undefined;
}): boolean {
  return statusRequiresAttention(input.status) || input.lastValidationStatus === 'failed';
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

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}
