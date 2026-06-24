import { describe, expect, test } from 'vitest';
import { createObjectiveRenewalTraceApiService } from './objectiveRenewalTraceApi';

describe('objective renewal trace API service', () => {
  test('normalizes lookup and query requests before delegating', async () => {
    const calls: unknown[] = [];
    const service = createObjectiveRenewalTraceApiService({
      traces: {
        getTrace: (request) => {
          calls.push({ method: 'getTrace', request });
          return { traceId: request.traceId };
        },
        queryTraces: (request) => {
          calls.push({ method: 'queryTraces', request });
          return [{ traceId: request.traceId ?? 'trace-1' }];
        },
      },
    });

    await expect(
      service.getObjectiveRenewalTrace({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        traceId: 'trace-1',
      }),
    ).resolves.toEqual({ traceId: 'trace-1' });
    await expect(
      service.queryObjectiveRenewalTraces({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        agentId: 'agent-1',
        objectiveId: 'objective-1',
        fromIssuedAt: 100,
        toIssuedAt: 200,
        limit: 5,
      }),
    ).resolves.toEqual([{ traceId: 'trace-1' }]);

    expect(calls).toEqual([
      {
        method: 'getTrace',
        request: {
          simulationId: 'sim-1',
          partitionKey: 'world-main',
          traceId: 'trace-1',
        },
      },
      {
        method: 'queryTraces',
        request: {
          simulationId: 'sim-1',
          partitionKey: 'world-main',
          agentId: 'agent-1',
          objectiveId: 'objective-1',
          fromIssuedAt: 100,
          toIssuedAt: 200,
          limit: 5,
        },
      },
    ]);
  });

  test('rejects invalid lookup and query input before delegation', async () => {
    const service = createObjectiveRenewalTraceApiService({
      traces: {
        getTrace: () => undefined,
        queryTraces: () => [],
      },
    });

    await expect(
      service.getObjectiveRenewalTrace({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        traceId: ' ',
      }),
    ).rejects.toThrow('traceId must not be empty');
    await expect(
      service.queryObjectiveRenewalTraces({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        limit: 0,
      }),
    ).rejects.toThrow('limit must be a positive integer');
  });
});
