import { describe, expect, test } from 'vitest';
import { createRuntimeSupervisorApiService } from './index';

type TestStatus = {
  readonly manifestId: string;
  readonly partitionCount: number;
};

type TestTrace = {
  readonly traceId: string;
  readonly command: 'start-all' | 'pause-all' | 'run-cycles';
  readonly requestedAt: number;
};

describe('runtime supervisor API service', () => {
  test('delegates status, bulk commands, and trace queries to the injected control port', async () => {
    const calls: unknown[] = [];
    const status: TestStatus = { manifestId: 'town-runtime', partitionCount: 2 };
    const service = createRuntimeSupervisorApiService({
      control: {
        getStatus: () => {
          calls.push({ method: 'getStatus' });
          return Promise.resolve(status);
        },
        startAll: (request) => {
          calls.push({ method: 'startAll', request });
          return Promise.resolve({
            traceId: request.operationId ?? 'generated-start',
            outcome: 'succeeded',
            requestedAt: request.requestedAt,
          });
        },
        pauseAll: (request) => {
          calls.push({ method: 'pauseAll', request });
          return Promise.resolve({
            traceId: request.operationId ?? 'generated-pause',
            outcome: 'succeeded',
            requestedAt: request.requestedAt,
          });
        },
        runCycles: (request) => {
          calls.push({ method: 'runCycles', request });
          return Promise.resolve({
            traceId: request.operationId ?? 'generated-run',
            outcome: 'succeeded',
            requestedAt: request.requestedAt,
            completedCycleCount: request.cycleCount,
          });
        },
        getOperationTrace: (traceId) => {
          calls.push({ method: 'getOperationTrace', traceId });
          return Promise.resolve({
            traceId,
            command: 'start-all',
            requestedAt: 100,
          } satisfies TestTrace);
        },
        queryOperationTraces: (query) => {
          calls.push({ method: 'queryOperationTraces', query });
          return Promise.resolve([
            { traceId: 'op-start-100', command: 'start-all', requestedAt: 100 },
          ] satisfies readonly TestTrace[]);
        },
      },
    });

    await expect(service.getRuntimeStatus()).resolves.toBe(status);
    await expect(
      service.startRuntime({ operationId: 'op-start-100', requestedAt: 100 }),
    ).resolves.toEqual({
      traceId: 'op-start-100',
      outcome: 'succeeded',
      requestedAt: 100,
    });
    await expect(service.pauseRuntime({ requestedAt: 150 })).resolves.toEqual({
      traceId: 'generated-pause',
      outcome: 'succeeded',
      requestedAt: 150,
    });
    await expect(
      service.runRuntime({
        operationId: 'op-run-200',
        requestedAt: 200,
        cycleCount: 3,
        cycleIntervalMs: 50,
      }),
    ).resolves.toEqual({
      traceId: 'op-run-200',
      outcome: 'succeeded',
      requestedAt: 200,
      completedCycleCount: 3,
    });
    await expect(service.getRuntimeOperationTrace({ traceId: 'op-start-100' })).resolves.toEqual({
      traceId: 'op-start-100',
      command: 'start-all',
      requestedAt: 100,
    });
    await expect(
      service.queryRuntimeOperationTraces({
        manifestId: 'town-runtime',
        command: 'start-all',
        fromRequestedAt: 50,
        toRequestedAt: 200,
        limit: 10,
      }),
    ).resolves.toEqual([{ traceId: 'op-start-100', command: 'start-all', requestedAt: 100 }]);
    expect(calls).toEqual([
      { method: 'getStatus' },
      { method: 'startAll', request: { operationId: 'op-start-100', requestedAt: 100 } },
      { method: 'pauseAll', request: { requestedAt: 150 } },
      {
        method: 'runCycles',
        request: {
          operationId: 'op-run-200',
          requestedAt: 200,
          cycleCount: 3,
          cycleIntervalMs: 50,
        },
      },
      { method: 'getOperationTrace', traceId: 'op-start-100' },
      {
        method: 'queryOperationTraces',
        query: {
          manifestId: 'town-runtime',
          command: 'start-all',
          fromRequestedAt: 50,
          toRequestedAt: 200,
          limit: 10,
        },
      },
    ]);
  });

  test('rejects invalid trace requests at the API boundary before hitting the port', async () => {
    const calls: string[] = [];
    const service = createRuntimeSupervisorApiService({
      control: {
        getStatus: () => {
          calls.push('getStatus');
          return Promise.resolve({ manifestId: 'town-runtime', partitionCount: 0 });
        },
        startAll: (request) => {
          calls.push('startAll');
          return Promise.resolve({
            traceId: request.operationId ?? 'op-start',
            outcome: 'succeeded',
          });
        },
        pauseAll: (request) => {
          calls.push('pauseAll');
          return Promise.resolve({
            traceId: request.operationId ?? 'op-pause',
            outcome: 'succeeded',
          });
        },
        runCycles: (request) => {
          calls.push('runCycles');
          return Promise.resolve({
            traceId: request.operationId ?? 'op-run',
            outcome: 'succeeded',
          });
        },
        getOperationTrace: (traceId) => {
          calls.push(traceId);
          return Promise.resolve(undefined);
        },
        queryOperationTraces: () => {
          calls.push('queryOperationTraces');
          return Promise.resolve([]);
        },
      },
    });

    await expect(service.getRuntimeOperationTrace({ traceId: '   ' })).rejects.toThrow(
      'traceId must not be empty',
    );
    await expect(service.runRuntime({ requestedAt: 100, cycleCount: 0 })).rejects.toThrow(
      'cycleCount must be a positive integer',
    );
    expect(calls).toEqual([]);
  });
});
