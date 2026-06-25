import { describe, expect, test } from 'vitest';
import { createDailyPlanRenewalTraceApiService } from './dailyPlanRenewalTraceApi';

describe('daily plan renewal trace API service', () => {
  test('normalizes lookup and query requests before delegating', async () => {
    const calls: unknown[] = [];
    const service = createDailyPlanRenewalTraceApiService({
      traces: {
        getTrace: (request) => {
          calls.push({ method: 'getTrace', request });
          return { traceId: request.traceId };
        },
        queryTraces: (request) => {
          calls.push({ method: 'queryTraces', request });
          return [{ traceId: request.traceId ?? 'daily-plan-trace-1' }];
        },
      },
    });

    await expect(
      service.getDailyPlanRenewalTrace({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        traceId: 'daily-plan-trace-1',
      }),
    ).resolves.toEqual({ traceId: 'daily-plan-trace-1' });
    await expect(
      service.queryDailyPlanRenewalTraces({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        agentId: 'agent-1',
        dailyPlanId: 'daily-plan:agent-1:0',
        fromIssuedAt: 100,
        toIssuedAt: 200,
        limit: 5,
      }),
    ).resolves.toEqual([{ traceId: 'daily-plan-trace-1' }]);

    expect(calls).toEqual([
      {
        method: 'getTrace',
        request: {
          simulationId: 'sim-1',
          partitionKey: 'world-main',
          traceId: 'daily-plan-trace-1',
        },
      },
      {
        method: 'queryTraces',
        request: {
          simulationId: 'sim-1',
          partitionKey: 'world-main',
          agentId: 'agent-1',
          dailyPlanId: 'daily-plan:agent-1:0',
          fromIssuedAt: 100,
          toIssuedAt: 200,
          limit: 5,
        },
      },
    ]);
  });

  test('rejects invalid lookup and query input before delegation', async () => {
    const service = createDailyPlanRenewalTraceApiService({
      traces: {
        getTrace: () => undefined,
        queryTraces: () => [],
      },
    });

    await expect(
      service.getDailyPlanRenewalTrace({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        traceId: ' ',
      }),
    ).rejects.toThrow('traceId must not be empty');
    await expect(
      service.queryDailyPlanRenewalTraces({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        limit: 0,
      }),
    ).rejects.toThrow('limit must be a positive integer');
  });
});
