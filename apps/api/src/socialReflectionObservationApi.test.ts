import { describe, expect, test } from 'vitest';
import { createSocialReflectionObservationApiService } from './socialReflectionObservationApi';

type TestSocialReflectionObservation = {
  readonly observationId: string;
  readonly agentId: string;
  readonly targetAgentId: string;
};

describe('social reflection observation API service', () => {
  test('normalizes lookup and query requests before delegating', async () => {
    const calls: unknown[] = [];
    const service = createSocialReflectionObservationApiService<TestSocialReflectionObservation>({
      observations: {
        getObservation: (request) => {
          calls.push({ method: 'getObservation', request });
          return {
            observationId: request.observationId,
            agentId: 'agent-1',
            targetAgentId: 'agent-2',
          };
        },
        queryObservations: (request) => {
          calls.push({ method: 'queryObservations', request });
          return [
            {
              observationId: request.observationId ?? 'observation-1',
              agentId: request.agentId ?? 'agent-1',
              targetAgentId: request.targetAgentId ?? 'agent-2',
            },
          ];
        },
      },
    });

    await expect(
      service.getSocialReflectionObservation({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        observationId: 'observation-1',
      }),
    ).resolves.toEqual({
      observationId: 'observation-1',
      agentId: 'agent-1',
      targetAgentId: 'agent-2',
    });
    await expect(
      service.querySocialReflectionObservations({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        observationId: 'observation-1',
        agentId: 'agent-1',
        targetAgentId: 'agent-2',
        fromGeneratedAt: 100,
        toGeneratedAt: 200,
        limit: 3,
      }),
    ).resolves.toEqual([
      {
        observationId: 'observation-1',
        agentId: 'agent-1',
        targetAgentId: 'agent-2',
      },
    ]);

    expect(calls).toEqual([
      {
        method: 'getObservation',
        request: {
          simulationId: 'sim-1',
          partitionKey: 'world-main',
          observationId: 'observation-1',
        },
      },
      {
        method: 'queryObservations',
        request: {
          simulationId: 'sim-1',
          partitionKey: 'world-main',
          observationId: 'observation-1',
          agentId: 'agent-1',
          targetAgentId: 'agent-2',
          fromGeneratedAt: 100,
          toGeneratedAt: 200,
          limit: 3,
        },
      },
    ]);
  });

  test('rejects invalid lookup and query input before delegation', async () => {
    const calls: unknown[] = [];
    const service = createSocialReflectionObservationApiService<TestSocialReflectionObservation>({
      observations: {
        getObservation: (request) => {
          calls.push(request);
          return undefined;
        },
        queryObservations: (request) => {
          calls.push(request);
          return [];
        },
      },
    });

    await expect(
      service.getSocialReflectionObservation({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        observationId: ' ',
      }),
    ).rejects.toThrow('observationId must not be empty');
    await expect(
      service.querySocialReflectionObservations({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        fromGeneratedAt: Number.POSITIVE_INFINITY,
      }),
    ).rejects.toThrow('fromGeneratedAt must be finite');
    await expect(
      service.querySocialReflectionObservations({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        limit: 0,
      }),
    ).rejects.toThrow('limit must be a positive integer');
    expect(calls).toEqual([]);
  });
});
