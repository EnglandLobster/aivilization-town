import { describe, expect, test } from 'vitest';
import {
  createSimulationApiService,
  type ExperimentValidationReportLookupRequest,
  type ExperimentValidationReportQueryRequest,
  type SimulationEventFeedRequest,
  type SimulationLifecycleRequest,
  type SimulationSyncRequest,
} from './index';

describe('simulation API control service', () => {
  test('submits human long-horizon objectives as command envelopes', async () => {
    const submitted: unknown[] = [];
    const contexts: unknown[] = [];
    const service = createSimulationApiService({
      projectionQueries: {
        getProjection: () => Promise.resolve({ agents: 0 }),
      },
      eventFeeds: createEventFeedPort(),
      sync: createSyncPort(),
      validationReports: createValidationReportsPort(),
      steeringCommands: {
        submit: (command, context) => {
          submitted.push(command);
          contexts.push(context);
          return Promise.resolve({ accepted: true, commandType: command.type });
        },
      },
      lifecycle: createLifecyclePort(),
    });

    const result = await service.submitLongHorizonObjective({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
      agentId: 'agent-1',
      objectiveId: 'objective-study',
      statement: 'Do not work yet; study until education score exceeds 100.',
      priority: 2,
      affinityTags: ['study', 'education'],
      issuedAt: 100,
      expectedVersion: 7,
    });

    expect(result.result).toEqual({ accepted: true, commandType: 'SetLongHorizonObjective' });
    expect(result.command).toMatchObject({
      id: 'api-objective-sim-1-agent-1-objective-study',
      simulationId: 'sim-1',
      idempotencyKey: 'api-objective-sim-1-agent-1-objective-study',
      actorId: 'agent-1',
      source: 'human',
      type: 'SetLongHorizonObjective',
      payload: {
        objectiveId: 'objective-study',
        statement: 'Do not work yet; study until education score exceeds 100.',
        priority: 2,
        affinityTags: ['study', 'education'],
      },
      issuedAt: 100,
      expectedVersion: 7,
    });
    expect(submitted).toEqual([result.command]);
    expect(contexts).toEqual([{ simulationId: 'sim-1', partitionKey: 'world-main' }]);
  });

  test('submits human reactive commands as command envelopes', async () => {
    const service = createSimulationApiService({
      projectionQueries: {
        getProjection: () => Promise.resolve({ agents: 0 }),
      },
      eventFeeds: createEventFeedPort(),
      sync: createSyncPort(),
      validationReports: createValidationReportsPort(),
      steeringCommands: {
        submit: (command) => Promise.resolve({ command }),
      },
      lifecycle: createLifecyclePort(),
    });

    const result = await service.submitReactiveCommand({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
      agentId: 'agent-1',
      reactiveCommandId: 'reactive-buy-fish',
      summary: 'buy 10 fish now',
      tags: ['trade', 'fish'],
      issuedAt: 200,
    });

    expect(result.command).toMatchObject({
      id: 'api-reactive-sim-1-agent-1-reactive-buy-fish',
      actorId: 'agent-1',
      source: 'human',
      type: 'IssueReactiveCommand',
      payload: {
        reactiveCommandId: 'reactive-buy-fish',
        summary: 'buy 10 fish now',
        tags: ['trade', 'fish'],
      },
      issuedAt: 200,
    });
  });

  test('delegates projection, event feed, validation report, and lifecycle controls to injected ports', async () => {
    const lifecycleRequests: SimulationLifecycleRequest[] = [];
    const eventFeedRequests: SimulationEventFeedRequest[] = [];
    const syncRequests: SimulationSyncRequest[] = [];
    const validationReportQueries: ExperimentValidationReportQueryRequest[] = [];
    const validationReportLookups: ExperimentValidationReportLookupRequest[] = [];
    const service = createSimulationApiService({
      projectionQueries: {
        getProjection: (query) => Promise.resolve({ query, agents: 80 }),
      },
      eventFeeds: {
        getEvents: (request) => {
          eventFeedRequests.push(request);
          return Promise.resolve({
            streamVersion: 5,
            nextAfterSequence: 4,
            events: [{ sequence: 4, type: 'SimulationTimeAdvanced' }],
          });
        },
      },
      sync: {
        getSync: (request) => {
          syncRequests.push(request);
          return Promise.resolve({
            streamVersion: 5,
            projectionSequence: 5,
            nextAfterSequence: 4,
            hasMoreEvents: true,
            projection: { agents: 80 },
            events: [{ sequence: 4, type: 'SimulationTimeAdvanced' }],
          });
        },
      },
      validationReports: {
        queryReports: (request) => {
          validationReportQueries.push(request);
          return Promise.resolve([{ run: { runId: 'validation-2' } }]);
        },
        getReport: (request) => {
          validationReportLookups.push(request);
          return Promise.resolve({ run: { runId: request.runId } });
        },
      },
      steeringCommands: {
        submit: (command) => Promise.resolve({ command }),
      },
      lifecycle: {
        start: (request) => {
          lifecycleRequests.push(request);
          return Promise.resolve({ status: 'started', request });
        },
        pause: (request) => {
          lifecycleRequests.push(request);
          return Promise.resolve({ status: 'paused', request });
        },
        reset: (request) => {
          lifecycleRequests.push(request);
          return Promise.resolve({ status: 'reset', request });
        },
        replay: (request) => {
          lifecycleRequests.push(request);
          return Promise.resolve({ status: 'replaying', request });
        },
      },
    });

    await expect(
      service.getProjection({ simulationId: 'sim-1', partitionKey: 'world-main' }),
    ).resolves.toEqual({
      query: { simulationId: 'sim-1', partitionKey: 'world-main' },
      agents: 80,
    });
    await expect(
      service.getEvents({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        afterSequence: 3,
        limit: 2,
      }),
    ).resolves.toEqual({
      streamVersion: 5,
      nextAfterSequence: 4,
      events: [{ sequence: 4, type: 'SimulationTimeAdvanced' }],
    });
    await expect(
      service.getSync({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        afterSequence: 3,
        limit: 1,
      }),
    ).resolves.toEqual({
      streamVersion: 5,
      projectionSequence: 5,
      nextAfterSequence: 4,
      hasMoreEvents: true,
      projection: { agents: 80 },
      events: [{ sequence: 4, type: 'SimulationTimeAdvanced' }],
    });
    await expect(
      service.queryExperimentValidationReports({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        fromGeneratedAt: 100,
        toGeneratedAt: 200,
        limit: 2,
      }),
    ).resolves.toEqual([{ run: { runId: 'validation-2' } }]);
    await expect(
      service.getExperimentValidationReport({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        runId: 'validation-2',
      }),
    ).resolves.toEqual({ run: { runId: 'validation-2' } });
    await expect(
      service.startSimulation({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        scenarioPresetId: 'aivilization-ablation-80-agent-cohort',
        requestedAt: 300,
      }),
    ).resolves.toMatchObject({ status: 'started' });
    await expect(
      service.pauseSimulation({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        requestedAt: 301,
      }),
    ).resolves.toMatchObject({ status: 'paused' });
    await expect(
      service.resetSimulation({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        requestedAt: 302,
      }),
    ).resolves.toMatchObject({ status: 'reset' });
    await expect(
      service.replaySimulation({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        requestedAt: 303,
        fromSequence: 0,
        toSequence: 10,
      }),
    ).resolves.toMatchObject({ status: 'replaying' });
    expect(lifecycleRequests).toHaveLength(4);
    expect(eventFeedRequests).toEqual([
      {
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        afterSequence: 3,
        limit: 2,
      },
    ]);
    expect(syncRequests).toEqual([
      {
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        afterSequence: 3,
        limit: 1,
      },
    ]);
    expect(validationReportQueries).toEqual([
      {
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        fromGeneratedAt: 100,
        toGeneratedAt: 200,
        limit: 2,
      },
    ]);
    expect(validationReportLookups).toEqual([
      {
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        runId: 'validation-2',
      },
    ]);
  });
});

function createEventFeedPort() {
  return {
    getEvents: (request: SimulationEventFeedRequest) =>
      Promise.resolve({ request, streamVersion: 0, nextAfterSequence: request.afterSequence ?? 0 }),
  };
}

function createSyncPort() {
  return {
    getSync: (request: SimulationSyncRequest) =>
      Promise.resolve({
        request,
        streamVersion: 0,
        projectionSequence: 0,
        nextAfterSequence: request.afterSequence ?? 0,
        hasMoreEvents: false,
      }),
  };
}

function createValidationReportsPort() {
  return {
    queryReports: (request: ExperimentValidationReportQueryRequest) =>
      Promise.resolve([{ run: { runId: request.runId ?? 'validation-1' } }]),
    getReport: (request: ExperimentValidationReportLookupRequest) =>
      Promise.resolve({ run: { runId: request.runId } }),
  };
}

function createLifecyclePort() {
  return {
    start: (request: SimulationLifecycleRequest) => Promise.resolve({ status: 'started', request }),
    pause: (request: SimulationLifecycleRequest) => Promise.resolve({ status: 'paused', request }),
    reset: (request: SimulationLifecycleRequest) => Promise.resolve({ status: 'reset', request }),
    replay: (request: SimulationLifecycleRequest) =>
      Promise.resolve({ status: 'replaying', request }),
  };
}
