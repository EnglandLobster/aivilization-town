import { describe, expect, test } from 'vitest';
import { InMemoryCommandStore, createSimulationPartition } from '@aivilization/sim-core';
import {
  createCommandStoreSteeringSubmissionPort,
  createSimulationApiService,
  type SimulationLifecycleRequest,
} from './index';

describe('command-store-backed steering submission port', () => {
  test('persists API steering commands to the partition command stream with idempotent replay', async () => {
    const commandStore = new InMemoryCommandStore();
    const service = createSimulationApiService({
      projectionQueries: {
        getProjection: () => Promise.resolve({ agents: 0 }),
      },
      eventFeeds: {
        getEvents: () => Promise.resolve({ streamVersion: 0, nextAfterSequence: 0, events: [] }),
      },
      sync: {
        getSync: () =>
          Promise.resolve({
            streamVersion: 0,
            projectionSequence: 0,
            nextAfterSequence: 0,
            hasMoreEvents: false,
          }),
      },
      validationReports: {
        getReport: () => Promise.resolve(undefined),
        queryReports: () => Promise.resolve([]),
      },
      marketObservations: {
        queryMarketTradeObservations: () => Promise.resolve([]),
        queryMarketOhlcBars: () => Promise.resolve([]),
      },
      steeringCommands: createCommandStoreSteeringSubmissionPort({ commandStore }),
      lifecycle: createLifecyclePort(),
    });

    const request = {
      simulationId: 'sim-1',
      partitionKey: 'world-main',
      agentId: 'agent-1',
      reactiveCommandId: 'reactive-buy-fish',
      commandId: 'cmd-reactive-buy-fish',
      idempotencyKey: 'steering-reactive-buy-fish',
      summary: 'buy 10 fish now',
      tags: ['trade', 'fish'],
      issuedAt: 200,
      expectedVersion: 0,
    } as const;

    const firstSubmission = await service.submitReactiveCommand(request);
    const replaySubmission = await service.submitReactiveCommand(request);

    const partition = createSimulationPartition({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    expect(firstSubmission.result).toEqual({
      accepted: true,
      streamName: partition.commandStreamName,
      sequence: 1,
      streamVersion: 1,
      idempotentReplay: false,
    });
    expect(replaySubmission.result).toEqual({
      accepted: true,
      streamName: partition.commandStreamName,
      sequence: 1,
      streamVersion: 1,
      idempotentReplay: true,
    });
    expect(commandStore.readStream(partition.commandStreamName)).toEqual([
      { sequence: 1, command: firstSubmission.command },
    ]);
  });
});

function createLifecyclePort() {
  return {
    start: (request: SimulationLifecycleRequest) => Promise.resolve({ status: 'started', request }),
    pause: (request: SimulationLifecycleRequest) => Promise.resolve({ status: 'paused', request }),
    reset: (request: SimulationLifecycleRequest) => Promise.resolve({ status: 'reset', request }),
    replay: (request: SimulationLifecycleRequest) =>
      Promise.resolve({ status: 'replaying', request }),
  };
}
