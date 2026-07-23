import { describe, expect, test } from 'vitest';
import {
  createLocalSimulationRuntimeSupervisorApiService,
  type LocalSimulationRuntimeRunSessionState,
  type LocalSimulationRuntimeOperationTrace,
  type LocalSimulationRuntimeSupervisor,
  type LocalSimulationRuntimeSupervisorPauseAllResult,
  type LocalSimulationRuntimeSupervisorRunCyclesResult,
  type LocalSimulationRuntimeSupervisorStartAllResult,
  type LocalSimulationRuntimeSupervisorStatus,
} from './index';

describe('local simulation runtime supervisor API adapter', () => {
  test('exposes a local supervisor through the runtime supervisor API service', async () => {
    const calls: unknown[] = [];
    const status: LocalSimulationRuntimeSupervisorStatus = {
      manifestId: 'town-runtime',
      partitionCount: 0,
      healthyPartitionCount: 0,
      attentionPartitionCount: 0,
      partitions: [],
    };
    const startResult: LocalSimulationRuntimeSupervisorStartAllResult = {
      traceId: 'op-start-100',
      outcome: 'succeeded',
      succeededPartitionCount: 0,
      failedPartitionCount: 0,
      partitions: [],
      status,
    };
    const pauseResult: LocalSimulationRuntimeSupervisorPauseAllResult = {
      traceId: 'op-pause-150',
      outcome: 'succeeded',
      succeededPartitionCount: 0,
      failedPartitionCount: 0,
      partitions: [],
      status,
    };
    const runResult: LocalSimulationRuntimeSupervisorRunCyclesResult = {
      traceId: 'op-run-200',
      outcome: 'succeeded',
      requestedCycleCount: 2,
      completedCycleCount: 2,
      stopReason: 'cycle-count-completed',
      cycles: [],
      status,
    };
    const runSession: LocalSimulationRuntimeRunSessionState = {
      traceId: 'op-run-200',
      manifestId: 'town-runtime',
      requestedAt: 200,
      requestedCycleCount: 2,
      cycleIntervalMs: 50,
      stopOnAttention: true,
      status: 'completed',
      completedCycleCount: 2,
      cycles: [],
      statusSnapshot: status,
      outcome: 'succeeded',
      stopReason: 'cycle-count-completed',
      updatedAt: 250,
    };
    const stoppedRunSession: LocalSimulationRuntimeRunSessionState = {
      ...runSession,
      status: 'running',
      stopRequestedAt: 260,
      updatedAt: 260,
    };
    const trace: LocalSimulationRuntimeOperationTrace = {
      traceId: 'op-start-100',
      manifestId: 'town-runtime',
      command: 'start-all',
      requestedAt: 100,
      recordedAt: 100,
      outcome: 'succeeded',
      succeededPartitionCount: 0,
      failedPartitionCount: 0,
      partitions: [],
      status,
    };
    const supervisor: LocalSimulationRuntimeSupervisor = {
      getStatus: () => {
        calls.push({ method: 'getStatus' });
        return status;
      },
      startAll: (request) => {
        calls.push({ method: 'startAll', request });
        return Promise.resolve(startResult);
      },
      pauseAll: (request) => {
        calls.push({ method: 'pauseAll', request });
        return Promise.resolve(pauseResult);
      },
      runCycles: (request) => {
        calls.push({ method: 'runCycles', request });
        return Promise.resolve(runResult);
      },
      getRunSession: (traceId) => {
        calls.push({ method: 'getRunSession', traceId });
        return Promise.resolve(traceId === runSession.traceId ? runSession : undefined);
      },
      getResolvedRunManifest: (runManifestId) => {
        calls.push({ method: 'getResolvedRunManifest', runManifestId });
        return Promise.resolve(undefined);
      },
      requestRunSessionStop: (request) => {
        calls.push({ method: 'requestRunSessionStop', request });
        return Promise.resolve(
          request.traceId === runSession.traceId ? stoppedRunSession : undefined,
        );
      },
      getOperationTrace: (traceId) => {
        calls.push({ method: 'getOperationTrace', traceId });
        return Promise.resolve(trace);
      },
      queryOperationTraces: (query) => {
        calls.push({ method: 'queryOperationTraces', query });
        return Promise.resolve([trace]);
      },
    };
    const api = createLocalSimulationRuntimeSupervisorApiService({ supervisor });

    await expect(api.getRuntimeStatus()).resolves.toBe(status);
    await expect(api.startRuntime({ operationId: 'op-start-100', requestedAt: 100 })).resolves.toBe(
      startResult,
    );
    await expect(api.pauseRuntime({ operationId: 'op-pause-150', requestedAt: 150 })).resolves.toBe(
      pauseResult,
    );
    await expect(
      api.runRuntime({
        operationId: 'op-run-200',
        requestedAt: 200,
        cycleCount: 2,
      }),
    ).resolves.toBe(runResult);
    await expect(api.getRuntimeRunSession({ traceId: 'op-run-200' })).resolves.toBe(runSession);
    await expect(
      api.getRuntimeResolvedRunManifest({ runManifestId: 'resolved-run-manifest:sha256:abc' }),
    ).resolves.toBeUndefined();
    await expect(
      api.stopRuntimeRunSession({ traceId: 'op-run-200', requestedAt: 260 }),
    ).resolves.toBe(stoppedRunSession);
    await expect(api.getRuntimeOperationTrace({ traceId: 'op-start-100' })).resolves.toBe(trace);
    await expect(
      api.queryRuntimeOperationTraces({ manifestId: 'town-runtime', command: 'start-all' }),
    ).resolves.toEqual([trace]);
    expect(calls).toEqual([
      { method: 'getStatus' },
      { method: 'startAll', request: { operationId: 'op-start-100', requestedAt: 100 } },
      { method: 'pauseAll', request: { operationId: 'op-pause-150', requestedAt: 150 } },
      {
        method: 'runCycles',
        request: { operationId: 'op-run-200', requestedAt: 200, cycleCount: 2 },
      },
      { method: 'getRunSession', traceId: 'op-run-200' },
      {
        method: 'getResolvedRunManifest',
        runManifestId: 'resolved-run-manifest:sha256:abc',
      },
      {
        method: 'requestRunSessionStop',
        request: { traceId: 'op-run-200', requestedAt: 260 },
      },
      { method: 'getOperationTrace', traceId: 'op-start-100' },
      {
        method: 'queryOperationTraces',
        query: { manifestId: 'town-runtime', command: 'start-all' },
      },
    ]);
  });
});
