import { describe, expect, test } from 'vitest';
import { createBranchPlanApiService } from './branchPlanApi';

describe('branch plan API service', () => {
  test('normalizes a partition-scoped plan query before delegating', async () => {
    const calls: unknown[] = [];
    const service = createBranchPlanApiService({
      plans: {
        queryPlans: (request) => {
          calls.push(request);
          return [{ planId: request.planId ?? 'plan-1' }];
        },
      },
    });

    await expect(
      service.queryBranchPlans({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        planId: 'plan-1',
        agentId: 'agent-1',
        fromCreatedAt: 10,
        toCreatedAt: 20,
        fromUpdatedAt: 30,
        toUpdatedAt: 40,
        limit: 5,
      }),
    ).resolves.toEqual([{ planId: 'plan-1' }]);
    expect(calls).toEqual([
      {
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        planId: 'plan-1',
        agentId: 'agent-1',
        fromCreatedAt: 10,
        toCreatedAt: 20,
        fromUpdatedAt: 30,
        toUpdatedAt: 40,
        limit: 5,
      },
    ]);
  });

  test('rejects invalid filters before delegation', async () => {
    const calls: unknown[] = [];
    const service = createBranchPlanApiService({
      plans: {
        queryPlans: (request) => {
          calls.push(request);
          return [];
        },
      },
    });

    await expect(
      service.queryBranchPlans({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        planId: ' ',
      }),
    ).rejects.toThrow('planId must not be empty');
    await expect(
      service.queryBranchPlans({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        fromUpdatedAt: Number.NaN,
      }),
    ).rejects.toThrow('fromUpdatedAt must be finite');
    await expect(
      service.queryBranchPlans({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        limit: 0,
      }),
    ).rejects.toThrow('limit must be a positive integer');
    expect(calls).toEqual([]);
  });
});
