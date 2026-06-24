import type { PartitionKey, SimulationTimestamp } from '@aivilization/sim-core';
import { join } from 'node:path';
import type {
  LocalSimulationLifecycleMemoryConsolidationStatus,
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
  type LocalSimulationRuntimeOperationMemoryConsolidationFailureTrace,
  type LocalSimulationRuntimeOperationMemoryConsolidationTrace,
  type LocalSimulationRuntimeOperationRunCycleTrace,
  type LocalSimulationRuntimeOperationTrace,
  type LocalSimulationRuntimeOperationTraceQuery,
  type LocalSimulationRuntimeOperationTraceRepository,
  type LocalSimulationRuntimeOperationValidationFailureTrace,
  type LocalSimulationRuntimeOperationValidationReportTrace,
} from './localSimulationRuntimeOperationTrace';
import {
  FileLocalSimulationRuntimeRunSessionRepository,
  type LocalSimulationRuntimeRunSessionRepository,
  type LocalSimulationRuntimeRunSessionState,
  type LocalSimulationRuntimeRunSessionStopRequest,
} from './localSimulationRuntimeRunSession';

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
  readonly lastMemoryConsolidationStatus?: LocalSimulationLifecycleMemoryConsolidationStatus;
  readonly lastMemoryConsolidationAt?: SimulationTimestamp;
  readonly lastMemoryConsolidationAgentCount?: number;
  readonly lastMemoryConsolidationPatchCount?: number;
  readonly lastMemoryConsolidationCursorCount?: number;
  readonly lastMemoryConsolidationFailure?: LocalSimulationLifecycleValidationFailure;
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

export type LocalSimulationRuntimeSupervisorRunCyclesRequest =
  LocalSimulationRuntimeSupervisorRequest & {
    readonly cycleCount: number;
    readonly cycleIntervalMs?: number;
    readonly stopOnAttention?: boolean;
  };

export type LocalSimulationRuntimeSupervisorCommandOutcome =
  | 'succeeded'
  | 'partial-failure'
  | 'failed';

export type LocalSimulationRuntimeSupervisorRunCyclesStopReason =
  | 'cycle-count-completed'
  | 'partition-failure'
  | 'attention'
  | 'stop-requested';

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

export type LocalSimulationRuntimeSupervisorRunCycleSummary = {
  readonly cycleIndex: number;
  readonly traceId: string;
  readonly requestedAt: SimulationTimestamp;
  readonly outcome: LocalSimulationRuntimeSupervisorCommandOutcome;
  readonly succeededPartitionCount: number;
  readonly failedPartitionCount: number;
  readonly attentionPartitionCount: number;
};

export type LocalSimulationRuntimeSupervisorRunCyclesResult = {
  readonly traceId: string;
  readonly outcome: LocalSimulationRuntimeSupervisorCommandOutcome;
  readonly requestedCycleCount: number;
  readonly completedCycleCount: number;
  readonly stopReason: LocalSimulationRuntimeSupervisorRunCyclesStopReason;
  readonly cycles: readonly LocalSimulationRuntimeSupervisorRunCycleSummary[];
  readonly status: LocalSimulationRuntimeSupervisorStatus;
};

export type LocalSimulationRuntimeSupervisor = {
  readonly getStatus: () => LocalSimulationRuntimeSupervisorStatus;
  readonly getRunSession: (
    traceId: string,
  ) => Promise<LocalSimulationRuntimeRunSessionState | undefined>;
  readonly requestRunSessionStop: (
    request: LocalSimulationRuntimeRunSessionStopRequest,
  ) => Promise<LocalSimulationRuntimeRunSessionState | undefined>;
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
  readonly runCycles: (
    request: LocalSimulationRuntimeSupervisorRunCyclesRequest,
  ) => Promise<LocalSimulationRuntimeSupervisorRunCyclesResult>;
};

export function createLocalSimulationRuntimeSupervisor(input: {
  readonly host: LocalSimulationRuntimeHost;
  readonly operationTraceRepository?: LocalSimulationRuntimeOperationTraceRepository;
  readonly runSessionRepository?: LocalSimulationRuntimeRunSessionRepository;
}): LocalSimulationRuntimeSupervisor {
  const operationsDir = join(input.host.rootDir, 'operations');
  const operationTraceRepository =
    input.operationTraceRepository ??
    new FileLocalSimulationRuntimeOperationTraceRepository({
      rootDir: operationsDir,
    });
  const runSessionRepository =
    input.runSessionRepository ??
    new FileLocalSimulationRuntimeRunSessionRepository({
      rootDir: operationsDir,
    });

  async function startAll(
    request: LocalSimulationRuntimeSupervisorRequest,
  ): Promise<LocalSimulationRuntimeSupervisorStartAllResult> {
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
  }

  async function pauseAll(
    request: LocalSimulationRuntimeSupervisorRequest,
  ): Promise<LocalSimulationRuntimeSupervisorPauseAllResult> {
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
  }

  async function runCycles(
    request: LocalSimulationRuntimeSupervisorRunCyclesRequest,
  ): Promise<LocalSimulationRuntimeSupervisorRunCyclesResult> {
    assertNonNegativeFinite(request.requestedAt, 'requestedAt');
    assertPositiveInteger(request.cycleCount, 'cycleCount');
    const cycleIntervalMs = request.cycleIntervalMs ?? 0;
    assertNonNegativeFinite(cycleIntervalMs, 'cycleIntervalMs');
    const stopOnAttention = request.stopOnAttention ?? true;
    const traceId = createOperationTraceId(input.host, 'run-cycles', request);
    const existingSession = await runSessionRepository.get(traceId);
    if (existingSession !== undefined) {
      assertRunSessionCompatible(existingSession, {
        manifestId: input.host.manifestId,
        requestedAt: request.requestedAt,
        requestedCycleCount: request.cycleCount,
        cycleIntervalMs,
        stopOnAttention,
      });
      if (existingSession.status !== 'running') {
        return createRunCyclesResultFromSession(existingSession);
      }
    }

    let session =
      existingSession ??
      (await runSessionRepository.save({
        traceId,
        manifestId: input.host.manifestId,
        requestedAt: request.requestedAt,
        requestedCycleCount: request.cycleCount,
        cycleIntervalMs,
        stopOnAttention,
        status: 'running',
        completedCycleCount: 0,
        cycles: [],
        statusSnapshot: createSupervisorStatus(input.host),
        updatedAt: request.requestedAt,
      }));
    const cycles: LocalSimulationRuntimeSupervisorRunCycleSummary[] = [...session.cycles];
    let stopReason: LocalSimulationRuntimeSupervisorRunCyclesStopReason = 'cycle-count-completed';
    for (let offset = cycles.length; offset < session.requestedCycleCount; offset += 1) {
      const cycleIndex = offset + 1;
      const cycleRequestedAt = session.requestedAt + offset * session.cycleIntervalMs;
      const cycleResult = await startAll({
        operationId: `${traceId}:cycle:${cycleIndex}`,
        requestedAt: cycleRequestedAt,
      });
      const cycle = createRunCycleSummary(cycleIndex, cycleRequestedAt, cycleResult);
      cycles.push(cycle);
      session = await runSessionRepository.save({
        ...session,
        status: 'running',
        completedCycleCount: cycles.length,
        cycles,
        statusSnapshot: cycleResult.status,
        updatedAt: cycleRequestedAt,
      });
      if (cycleResult.outcome !== 'succeeded') {
        stopReason = 'partition-failure';
        break;
      }
      if (session.stopOnAttention && cycleResult.status.attentionPartitionCount > 0) {
        stopReason = 'attention';
        break;
      }
      if (session.stopRequestedAt !== undefined) {
        stopReason = 'stop-requested';
        break;
      }
    }

    const result: LocalSimulationRuntimeSupervisorRunCyclesResult = {
      traceId,
      outcome: createRunCyclesOutcome(cycles),
      requestedCycleCount: session.requestedCycleCount,
      completedCycleCount: cycles.length,
      stopReason,
      cycles,
      status: createSupervisorStatus(input.host),
    };
    await runSessionRepository.save({
      ...session,
      status: stopReason === 'cycle-count-completed' ? 'completed' : 'stopped',
      outcome: result.outcome,
      stopReason,
      completedCycleCount: cycles.length,
      cycles,
      statusSnapshot: result.status,
      updatedAt: cycles.at(-1)?.requestedAt ?? session.updatedAt,
    });
    await operationTraceRepository.record(
      createOperationTrace({
        traceId,
        host: input.host,
        command: 'run-cycles',
        requestedAt: request.requestedAt,
        result,
      }),
    );
    return result;
  }

  return {
    getStatus: () => createSupervisorStatus(input.host),
    getRunSession: (traceId) => runSessionRepository.get(traceId),
    requestRunSessionStop: (request) => runSessionRepository.requestStop(request),
    getOperationTrace: (traceId) => operationTraceRepository.get(traceId),
    queryOperationTraces: (query) => operationTraceRepository.query(query),
    startAll,
    pauseAll,
    runCycles,
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

function createRunCycleSummary(
  cycleIndex: number,
  requestedAt: SimulationTimestamp,
  result: LocalSimulationRuntimeSupervisorStartAllResult,
): LocalSimulationRuntimeSupervisorRunCycleSummary {
  return {
    cycleIndex,
    traceId: result.traceId,
    requestedAt,
    outcome: result.outcome,
    succeededPartitionCount: result.succeededPartitionCount,
    failedPartitionCount: result.failedPartitionCount,
    attentionPartitionCount: result.status.attentionPartitionCount,
  };
}

function createRunCyclesOutcome(
  cycles: readonly LocalSimulationRuntimeSupervisorRunCycleSummary[],
): LocalSimulationRuntimeSupervisorCommandOutcome {
  const failedCycleCount = cycles.filter((cycle) => cycle.outcome === 'failed').length;
  if (failedCycleCount === 0 && cycles.every((cycle) => cycle.outcome === 'succeeded')) {
    return 'succeeded';
  }
  if (failedCycleCount === cycles.length) {
    return 'failed';
  }
  return 'partial-failure';
}

function createRunCyclesResultFromSession(
  session: LocalSimulationRuntimeRunSessionState,
): LocalSimulationRuntimeSupervisorRunCyclesResult {
  return {
    traceId: session.traceId,
    outcome: session.outcome ?? createRunCyclesOutcome(session.cycles),
    requestedCycleCount: session.requestedCycleCount,
    completedCycleCount: session.completedCycleCount,
    stopReason: session.stopReason ?? 'cycle-count-completed',
    cycles: session.cycles,
    status: session.statusSnapshot,
  };
}

function assertRunSessionCompatible(
  session: LocalSimulationRuntimeRunSessionState,
  request: {
    readonly manifestId: string;
    readonly requestedAt: SimulationTimestamp;
    readonly requestedCycleCount: number;
    readonly cycleIntervalMs: number;
    readonly stopOnAttention: boolean;
  },
): void {
  if (session.manifestId !== request.manifestId) {
    throw new Error('run session manifestId does not match request');
  }
  if (session.requestedAt !== request.requestedAt) {
    throw new Error('run session requestedAt does not match request');
  }
  if (session.requestedCycleCount !== request.requestedCycleCount) {
    throw new Error('run session cycleCount does not match request');
  }
  if (session.cycleIntervalMs !== request.cycleIntervalMs) {
    throw new Error('run session cycleIntervalMs does not match request');
  }
  if (session.stopOnAttention !== request.stopOnAttention) {
    throw new Error('run session stopOnAttention does not match request');
  }
}

function createOperationTrace(input: {
  readonly traceId: string;
  readonly host: LocalSimulationRuntimeHost;
  readonly command: LocalSimulationRuntimeOperationCommand;
  readonly requestedAt: SimulationTimestamp;
  readonly result:
    | LocalSimulationRuntimeSupervisorStartAllResult
    | LocalSimulationRuntimeSupervisorPauseAllResult
    | LocalSimulationRuntimeSupervisorRunCyclesResult;
}): LocalSimulationRuntimeOperationTrace {
  const counts = createOperationTraceCounts(input.result);
  return {
    traceId: input.traceId,
    manifestId: input.host.manifestId,
    command: input.command,
    requestedAt: input.requestedAt,
    recordedAt: input.requestedAt,
    outcome: input.result.outcome,
    succeededPartitionCount: counts.succeededPartitionCount,
    failedPartitionCount: counts.failedPartitionCount,
    partitions: createOperationPartitionTraces(input.result),
    ...createOperationRunCycleTraces(input.result),
    status: input.result.status,
  };
}

function createOperationTraceCounts(
  result:
    | LocalSimulationRuntimeSupervisorStartAllResult
    | LocalSimulationRuntimeSupervisorPauseAllResult
    | LocalSimulationRuntimeSupervisorRunCyclesResult,
): {
  readonly succeededPartitionCount: number;
  readonly failedPartitionCount: number;
} {
  if ('partitions' in result) {
    return {
      succeededPartitionCount: result.succeededPartitionCount,
      failedPartitionCount: result.failedPartitionCount,
    };
  }
  const lastCycle = result.cycles.at(-1);
  return {
    succeededPartitionCount: lastCycle?.succeededPartitionCount ?? 0,
    failedPartitionCount: lastCycle?.failedPartitionCount ?? 0,
  };
}

function createOperationPartitionTraces(
  result:
    | LocalSimulationRuntimeSupervisorStartAllResult
    | LocalSimulationRuntimeSupervisorPauseAllResult
    | LocalSimulationRuntimeSupervisorRunCyclesResult,
): LocalSimulationRuntimeOperationTrace['partitions'] {
  if (!('partitions' in result)) {
    return [];
  }
  return result.partitions.map((partition) => {
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
    const memoryConsolidation = createOperationMemoryConsolidationTrace(partition.result);
    const memoryConsolidationFailure = createOperationMemoryConsolidationFailureTrace(
      partition.result,
    );
    return {
      simulationId: partition.simulationId,
      partitionKey: partition.partitionKey,
      outcome: partition.outcome,
      status: partition.status,
      ...(validationReport === undefined ? {} : { validationReport }),
      ...(validationFailure === undefined ? {} : { validationFailure }),
      ...(memoryConsolidation === undefined ? {} : { memoryConsolidation }),
      ...(memoryConsolidationFailure === undefined ? {} : { memoryConsolidationFailure }),
    };
  });
}

function createOperationRunCycleTraces(
  result:
    | LocalSimulationRuntimeSupervisorStartAllResult
    | LocalSimulationRuntimeSupervisorPauseAllResult
    | LocalSimulationRuntimeSupervisorRunCyclesResult,
): { readonly cycles?: readonly LocalSimulationRuntimeOperationRunCycleTrace[] } {
  if (!('cycles' in result)) {
    return {};
  }
  return {
    cycles: result.cycles.map((cycle) => ({
      cycleIndex: cycle.cycleIndex,
      traceId: cycle.traceId,
      requestedAt: cycle.requestedAt,
      outcome: cycle.outcome,
      succeededPartitionCount: cycle.succeededPartitionCount,
      failedPartitionCount: cycle.failedPartitionCount,
      attentionPartitionCount: cycle.attentionPartitionCount,
    })),
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

function createOperationMemoryConsolidationTrace(
  result: LocalSimulationLifecycleStartResult | LocalSimulationLifecyclePauseResult,
): LocalSimulationRuntimeOperationMemoryConsolidationTrace | undefined {
  if (!('memoryConsolidation' in result) || result.memoryConsolidation === undefined) {
    return undefined;
  }
  return {
    agentCount: result.memoryConsolidation.results.length,
    patchCount: result.memoryConsolidation.patchCount,
    cursorCount: result.memoryConsolidation.cursors.length,
    consolidatedAt: result.state.lastMemoryConsolidationAt ?? result.state.updatedAt,
  };
}

function createOperationMemoryConsolidationFailureTrace(
  result: LocalSimulationLifecycleStartResult | LocalSimulationLifecyclePauseResult,
): LocalSimulationRuntimeOperationMemoryConsolidationFailureTrace | undefined {
  if (
    !('memoryConsolidationFailure' in result) ||
    result.memoryConsolidationFailure === undefined
  ) {
    return undefined;
  }
  return {
    name: result.memoryConsolidationFailure.name,
    message: result.memoryConsolidationFailure.message,
    ...(result.memoryConsolidationFailure.stack === undefined
      ? {}
      : { stack: result.memoryConsolidationFailure.stack }),
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
      lastMemoryConsolidationStatus: lifecycleState?.lastMemoryConsolidationStatus,
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
      ...(lifecycleState?.lastMemoryConsolidationStatus === undefined
        ? {}
        : { lastMemoryConsolidationStatus: lifecycleState.lastMemoryConsolidationStatus }),
      ...(lifecycleState?.lastMemoryConsolidationAt === undefined
        ? {}
        : { lastMemoryConsolidationAt: lifecycleState.lastMemoryConsolidationAt }),
      ...(lifecycleState?.lastMemoryConsolidationAgentCount === undefined
        ? {}
        : {
            lastMemoryConsolidationAgentCount: lifecycleState.lastMemoryConsolidationAgentCount,
          }),
      ...(lifecycleState?.lastMemoryConsolidationPatchCount === undefined
        ? {}
        : {
            lastMemoryConsolidationPatchCount: lifecycleState.lastMemoryConsolidationPatchCount,
          }),
      ...(lifecycleState?.lastMemoryConsolidationCursorCount === undefined
        ? {}
        : {
            lastMemoryConsolidationCursorCount: lifecycleState.lastMemoryConsolidationCursorCount,
          }),
      ...(lifecycleState?.lastMemoryConsolidationFailure === undefined
        ? {}
        : { lastMemoryConsolidationFailure: lifecycleState.lastMemoryConsolidationFailure }),
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
  readonly lastMemoryConsolidationStatus:
    | LocalSimulationLifecycleMemoryConsolidationStatus
    | undefined;
}): boolean {
  return (
    statusRequiresAttention(input.status) ||
    input.lastValidationStatus === 'failed' ||
    input.lastMemoryConsolidationStatus === 'failed'
  );
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

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}
