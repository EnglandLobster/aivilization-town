import { describe, expect, test } from 'vitest';
import { createSimulationSyncSseRoute } from './simulationSyncSse';

describe('simulation sync SSE route', () => {
  test('matches sync-stream paths and emits an initial sync event from the sync port', async () => {
    const calls: unknown[] = [];
    const route = createSimulationSyncSseRoute({
      sync: {
        getSync: (request) => {
          calls.push(request);
          return Promise.resolve({
            streamName: 'simulation/sim-1/partition/world-main/events',
            streamVersion: 5,
            projectionSequence: 5,
            nextAfterSequence: 3,
            hasMoreEvents: true,
            projection: { agents: 80 },
            events: [{ sequence: 3, type: 'SimulationTimeAdvanced' }],
          });
        },
      },
      pollIntervalMs: 60_000,
    });

    const request = {
      method: 'GET' as const,
      path: '/simulations/sim-1/partitions/world-main/sync-stream',
      query: { afterSequence: '2', limit: '1' },
    };
    expect(route.match(request)).toBe(true);

    const abort = new AbortController();
    const stream = route.createStream(request, { signal: abort.signal });
    const iterator = stream[Symbol.asyncIterator]();
    const first = await iterator.next();
    abort.abort();
    await iterator.return?.();

    expect(first.done).toBe(false);
    expect(first.value).toEqual({
      id: '3',
      event: 'sync',
      data: {
        streamName: 'simulation/sim-1/partition/world-main/events',
        streamVersion: 5,
        projectionSequence: 5,
        nextAfterSequence: 3,
        hasMoreEvents: true,
        projection: { agents: 80 },
        events: [{ sequence: 3, type: 'SimulationTimeAdvanced' }],
      },
    });
    expect(calls).toEqual([
      {
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        afterSequence: 2,
        limit: 1,
      },
    ]);
  });

  test('rejects invalid cursor query values before calling the sync port', async () => {
    const calls: unknown[] = [];
    const route = createSimulationSyncSseRoute({
      sync: {
        getSync: (request) => {
          calls.push(request);
          return Promise.resolve({
            streamVersion: 0,
            projectionSequence: 0,
            nextAfterSequence: 0,
            hasMoreEvents: false,
          });
        },
      },
    });

    const stream = route.createStream(
      {
        method: 'GET',
        path: '/simulations/sim-1/partitions/world-main/sync-stream',
        query: { limit: '0' },
      },
      { signal: new AbortController().signal },
    );

    await expect(stream[Symbol.asyncIterator]().next()).rejects.toThrow(
      'limit must be a positive integer',
    );
    expect(calls).toEqual([]);
  });
});
