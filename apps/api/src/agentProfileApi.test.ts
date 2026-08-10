import { describe, expect, test } from 'vitest';
import { createAgentProfileApiService } from './index';

type TestAgentProfile = {
  readonly agentId: string;
  readonly values: readonly string[];
};

describe('agent profile API service', () => {
  test('normalizes lookup requests before delegating to the profile port', async () => {
    const calls: unknown[] = [];
    const service = createAgentProfileApiService<TestAgentProfile>({
      profiles: {
        getProfile: (request) => {
          calls.push(request);
          return Promise.resolve({ agentId: request.agentId, values: ['cooperation'] });
        },
        queryProfiles: () => Promise.resolve([]),
      },
    });

    await expect(
      service.getAgentProfile({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        agentId: 'agent-1',
      }),
    ).resolves.toEqual({ agentId: 'agent-1', values: ['cooperation'] });
    expect(calls).toEqual([
      {
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        agentId: 'agent-1',
      },
    ]);
  });

  test('normalizes query filters and limits before delegating to the profile port', async () => {
    const calls: unknown[] = [];
    const service = createAgentProfileApiService<TestAgentProfile>({
      profiles: {
        getProfile: () => Promise.resolve(undefined),
        queryProfiles: (request) => {
          calls.push(request);
          return Promise.resolve([{ agentId: request.agentId ?? 'agent-1', values: [] }]);
        },
      },
    });

    await expect(
      service.queryAgentProfiles({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        agentId: 'agent-1',
        limit: 2,
      }),
    ).resolves.toEqual([{ agentId: 'agent-1', values: [] }]);
    expect(calls).toEqual([
      {
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        agentId: 'agent-1',
        limit: 2,
      },
    ]);
  });

  test('rejects empty ids and invalid query limits', async () => {
    const calls: unknown[] = [];
    const service = createAgentProfileApiService<TestAgentProfile>({
      profiles: {
        getProfile: (request) => {
          calls.push(request);
          return Promise.resolve({ agentId: request.agentId, values: [] });
        },
        queryProfiles: (request) => {
          calls.push(request);
          return Promise.resolve([]);
        },
      },
    });

    await expect(
      service.getAgentProfile({
        simulationId: ' ',
        partitionKey: 'world-main',
        agentId: 'agent-1',
      }),
    ).rejects.toThrow('simulationId must not be empty');
    await expect(
      service.queryAgentProfiles({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        limit: 0,
      }),
    ).rejects.toThrow('limit must be a positive integer');
    expect(calls).toEqual([]);
  });
});
