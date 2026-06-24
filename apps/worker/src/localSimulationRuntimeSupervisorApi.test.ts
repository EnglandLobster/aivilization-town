import { describe, expect, test } from 'vitest';
import {
  createLocalSimulationRuntimeSupervisorApiService,
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
      getRunSession: () => Promise.resolve(undefined),
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
      { method: 'getOperationTrace', traceId: 'op-start-100' },
      {
        method: 'queryOperationTraces',
        query: { manifestId: 'town-runtime', command: 'start-all' },
      },
    ]);
  });
});
