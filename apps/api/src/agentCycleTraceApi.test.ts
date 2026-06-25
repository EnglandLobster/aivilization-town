import { describe, expect, test } from 'vitest';
import { createAgentCycleTraceApiService } from './agentCycleTraceApi';

type TestAgentCycleTrace = {
  readonly traceId: string;
  readonly agentId: string;
};

describe('agent cycle trace API service', () => {
  test('normalizes lookup and query requests before delegating', async () => {
    const calls: unknown[] = [];
    const service = createAgentCycleTraceApiService<TestAgentCycleTrace>({
      traces: {
        getTrace: (request) => {
          calls.push({ method: 'getTrace', request });
          return { traceId: request.traceId, agentId: 'agent-1' };
        },
        queryTraces: (request) => {
          calls.push({ method: 'queryTraces', request });
          return [
            {
              traceId: request.traceId ?? 'cycle-trace-1',
              agentId: request.agentId ?? 'agent-1',
            },
          ];
        },
      },
    });

    await expect(
      service.getAgentCycleTrace({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        traceId: 'cycle-trace-1',
      }),
    ).resolves.toEqual({ traceId: 'cycle-trace-1', agentId: 'agent-1' });
    await expect(
      service.queryAgentCycleTraces({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        traceId: 'cycle-trace-1',
        agentId: 'agent-1',
        fromCycleStartedAt: 100,
        toCycleStartedAt: 200,
        limit: 3,
      }),
    ).resolves.toEqual([{ traceId: 'cycle-trace-1', agentId: 'agent-1' }]);

    expect(calls).toEqual([
      {
        method: 'getTrace',
        request: {
          simulationId: 'sim-1',
          partitionKey: 'world-main',
          traceId: 'cycle-trace-1',
        },
      },
      {
        method: 'queryTraces',
        request: {
          simulationId: 'sim-1',
          partitionKey: 'world-main',
          traceId: 'cycle-trace-1',
          agentId: 'agent-1',
          fromCycleStartedAt: 100,
          toCycleStartedAt: 200,
          limit: 3,
        },
      },
    ]);
  });

  test('rejects invalid lookup and query input before delegation', async () => {
    const calls: unknown[] = [];
    const service = createAgentCycleTraceApiService<TestAgentCycleTrace>({
      traces: {
        getTrace: (request) => {
          calls.push(request);
          return undefined;
        },
        queryTraces: (request) => {
          calls.push(request);
          return [];
        },
      },
    });

    await expect(
      service.getAgentCycleTrace({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        traceId: ' ',
      }),
    ).rejects.toThrow('traceId must not be empty');
    await expect(
      service.queryAgentCycleTraces({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        fromCycleStartedAt: Number.POSITIVE_INFINITY,
      }),
    ).rejects.toThrow('fromCycleStartedAt must be finite');
    await expect(
      service.queryAgentCycleTraces({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        limit: 0,
      }),
    ).rejects.toThrow('limit must be a positive integer');
    expect(calls).toEqual([]);
  });
});
