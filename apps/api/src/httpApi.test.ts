import { describe, expect, test } from 'vitest';
import { createCommandEnvelope } from '@aivilization/sim-core';
import { createTownHttpApiHandler } from './index';
import type { SimulationApiService } from './simulationApi';
import type { RuntimeSupervisorApiService } from './runtimeSupervisorApi';
import type { RuntimeRunQueueApiService } from './runtimeRunQueueApi';
import type { RuntimeRunQueueWorkerApiService } from './runtimeRunQueueWorkerApi';

type TestProjection = {
  readonly agents: number;
};

type TestSteeringResult = {
  readonly accepted: boolean;
};

type TestLifecycleResult = {
  readonly status: string;
  readonly requestedAt: number;
};

type TestEventFeed = {
  readonly streamVersion: number;
  readonly nextAfterSequence: number;
  readonly events: readonly {
    readonly sequence: number;
    readonly type: string;
  }[];
};

type TestSyncEnvelope = {
  readonly streamVersion: number;
  readonly projectionSequence: number;
  readonly nextAfterSequence: number;
  readonly hasMoreEvents: boolean;
  readonly projection: TestProjection;
  readonly events: readonly {
    readonly sequence: number;
    readonly type: string;
  }[];
};

type TestValidationReport = {
  readonly run: {
    readonly runId: string;
  };
};

type TestRuntimeStatus = {
  readonly manifestId: string;
};

type TestRuntimeCommandResult = {
  readonly traceId: string;
  readonly requestedAt: number;
  readonly completedCycleCount?: number;
};

type TestRuntimeRunSession = {
  readonly traceId: string;
  readonly status: 'running' | 'completed' | 'stopped';
  readonly completedCycleCount: number;
  readonly stopRequestedAt?: number;
};

type TestRuntimeTrace = {
  readonly traceId: string;
  readonly command: 'start-all' | 'pause-all' | 'run-cycles';
};

type TestRuntimeRunQueueJob = {
  readonly jobId: string;
  readonly status: 'queued' | 'dead-lettered';
  readonly enqueuedAt: number;
  readonly deadLetteredAt?: number;
  readonly replayCount?: number;
  readonly runRequest: {
    readonly operationId?: string;
    readonly requestedAt: number;
    readonly cycleCount: number;
    readonly cycleIntervalMs?: number;
    readonly stopOnAttention?: boolean;
  };
};

type TestRuntimeRunQueueWorkerStatus = {
  readonly running: boolean;
  readonly inFlight: boolean;
  readonly processedJobCount: number;
};

type TestRuntimeRunQueueWorkerDrainResult = {
  readonly processedJobCount: number;
  readonly completedJobCount: number;
  readonly failedJobCount: number;
  readonly idle: boolean;
};

describe('town HTTP API router', () => {
  test('routes projection, steering, and lifecycle requests to the simulation service', async () => {
    const calls: unknown[] = [];
    const handler = createTownHttpApiHandler({
      simulation: createSimulationService(calls),
      runtimeSupervisor: createRuntimeSupervisorService(calls),
      runtimeRunQueue: createRuntimeRunQueueService(calls),
      runtimeRunQueueWorker: createRuntimeRunQueueWorkerService(calls),
    });

    await expect(
      handler({
        method: 'GET',
        path: '/simulations/sim-1/partitions/world-main/projection',
      }),
    ).resolves.toEqual({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { agents: 80 },
    });
    await expect(
      handler({
        method: 'GET',
        path: '/simulations/sim-1/partitions/world-main/events',
        query: { afterSequence: '2', limit: '3' },
      }),
    ).resolves.toEqual({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: {
        streamVersion: 5,
        nextAfterSequence: 5,
        events: [
          { sequence: 3, type: 'SimulationTimeAdvanced' },
          { sequence: 4, type: 'EducationChanged' },
          { sequence: 5, type: 'ShortTermMemoryRecorded' },
        ],
      },
    });
    await expect(
      handler({
        method: 'GET',
        path: '/simulations/sim-1/partitions/world-main/sync',
        query: { afterSequence: '2', limit: '3' },
      }),
    ).resolves.toEqual({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: {
        streamVersion: 5,
        projectionSequence: 5,
        nextAfterSequence: 5,
        hasMoreEvents: false,
        projection: { agents: 80 },
        events: [
          { sequence: 3, type: 'SimulationTimeAdvanced' },
          { sequence: 4, type: 'EducationChanged' },
          { sequence: 5, type: 'ShortTermMemoryRecorded' },
        ],
      },
    });
    await expect(
      handler({
        method: 'GET',
        path: '/simulations/sim-1/partitions/world-main/validation-reports',
        query: { fromGeneratedAt: '100', toGeneratedAt: '200', limit: '2' },
      }),
    ).resolves.toEqual({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: [{ run: { runId: 'validation-2' } }],
    });
    await expect(
      handler({
        method: 'GET',
        path: '/simulations/sim-1/partitions/world-main/validation-reports/validation-2',
      }),
    ).resolves.toEqual({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { run: { runId: 'validation-2' } },
    });
    await expect(
      handler({
        method: 'POST',
        path: '/simulations/sim-1/partitions/world-main/objectives',
        body: {
          agentId: 'agent-1',
          objectiveId: 'objective-study',
          statement: 'Study until education improves.',
          priority: 3,
          affinityTags: ['study'],
          issuedAt: 100,
          expectedVersion: 7,
        },
      }),
    ).resolves.toMatchObject({
      status: 202,
      body: {
        command: {
          type: 'SetLongHorizonObjective',
        },
        result: { accepted: true },
      },
    });
    await expect(
      handler({
        method: 'POST',
        path: '/simulations/sim-1/partitions/world-main/reactive-commands',
        body: {
          agentId: 'agent-1',
          reactiveCommandId: 'reactive-buy-food',
          summary: 'buy food now',
          tags: ['food'],
          issuedAt: 120,
        },
      }),
    ).resolves.toMatchObject({
      status: 202,
      body: {
        command: {
          type: 'IssueReactiveCommand',
        },
        result: { accepted: true },
      },
    });
    await expect(
      handler({
        method: 'POST',
        path: '/simulations/sim-1/partitions/world-main/start',
        body: { requestedAt: 150, scenarioPresetId: 'default-100' },
      }),
    ).resolves.toEqual({
      status: 202,
      headers: { 'content-type': 'application/json' },
      body: { status: 'started', requestedAt: 150 },
    });
    await expect(
      handler({
        method: 'POST',
        path: '/simulations/sim-1/partitions/world-main/replay',
        body: { requestedAt: 200, fromSequence: 10, toSequence: 20 },
      }),
    ).resolves.toEqual({
      status: 202,
      headers: { 'content-type': 'application/json' },
      body: { status: 'replaying', requestedAt: 200 },
    });

    expect(calls).toEqual([
      {
        method: 'getProjection',
        request: { simulationId: 'sim-1', partitionKey: 'world-main' },
      },
      {
        method: 'getEvents',
        request: {
          simulationId: 'sim-1',
          partitionKey: 'world-main',
          afterSequence: 2,
          limit: 3,
        },
      },
      {
        method: 'getSync',
        request: {
          simulationId: 'sim-1',
          partitionKey: 'world-main',
          afterSequence: 2,
          limit: 3,
        },
      },
      {
        method: 'queryExperimentValidationReports',
        request: {
          simulationId: 'sim-1',
          partitionKey: 'world-main',
          fromGeneratedAt: 100,
          toGeneratedAt: 200,
          limit: 2,
        },
      },
      {
        method: 'getExperimentValidationReport',
        request: {
          simulationId: 'sim-1',
          partitionKey: 'world-main',
          runId: 'validation-2',
        },
      },
      {
        method: 'submitLongHorizonObjective',
        request: {
          simulationId: 'sim-1',
          partitionKey: 'world-main',
          agentId: 'agent-1',
          objectiveId: 'objective-study',
          statement: 'Study until education improves.',
          priority: 3,
          affinityTags: ['study'],
          issuedAt: 100,
          expectedVersion: 7,
        },
      },
      {
        method: 'submitReactiveCommand',
        request: {
          simulationId: 'sim-1',
          partitionKey: 'world-main',
          agentId: 'agent-1',
          reactiveCommandId: 'reactive-buy-food',
          summary: 'buy food now',
          tags: ['food'],
          issuedAt: 120,
        },
      },
      {
        method: 'startSimulation',
        request: {
          simulationId: 'sim-1',
          partitionKey: 'world-main',
          requestedAt: 150,
          scenarioPresetId: 'default-100',
        },
      },
      {
        method: 'replaySimulation',
        request: {
          simulationId: 'sim-1',
          partitionKey: 'world-main',
          requestedAt: 200,
          fromSequence: 10,
          toSequence: 20,
        },
      },
    ]);
  });

  test('routes runtime supervisor requests to the runtime service', async () => {
    const calls: unknown[] = [];
    const handler = createTownHttpApiHandler({
      simulation: createSimulationService(calls),
      runtimeSupervisor: createRuntimeSupervisorService(calls),
      runtimeRunQueue: createRuntimeRunQueueService(calls),
      runtimeRunQueueWorker: createRuntimeRunQueueWorkerService(calls),
    });

    await expect(handler({ method: 'GET', path: '/runtime/status' })).resolves.toEqual({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { manifestId: 'town-runtime' },
    });
    await expect(
      handler({
        method: 'POST',
        path: '/runtime/start',
        body: { operationId: 'op-start-100', requestedAt: 100 },
      }),
    ).resolves.toEqual({
      status: 202,
      headers: { 'content-type': 'application/json' },
      body: { traceId: 'op-start-100', requestedAt: 100 },
    });
    await expect(
      handler({
        method: 'GET',
        path: '/runtime/operation-traces/op-start-100',
      }),
    ).resolves.toEqual({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { traceId: 'op-start-100', command: 'start-all' },
    });
    await expect(
      handler({
        method: 'GET',
        path: '/runtime/run-sessions/op-run-200',
      }),
    ).resolves.toEqual({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: {
        traceId: 'op-run-200',
        status: 'completed',
        completedCycleCount: 2,
      },
    });
    await expect(
      handler({
        method: 'POST',
        path: '/runtime/run-sessions/op-run-200/stop',
        body: { requestedAt: 260 },
      }),
    ).resolves.toEqual({
      status: 202,
      headers: { 'content-type': 'application/json' },
      body: {
        traceId: 'op-run-200',
        status: 'running',
        completedCycleCount: 2,
        stopRequestedAt: 260,
      },
    });
    await expect(
      handler({
        method: 'POST',
        path: '/runtime/run',
        body: {
          operationId: 'op-run-200',
          requestedAt: 200,
          cycleCount: 2,
          cycleIntervalMs: 50,
        },
      }),
    ).resolves.toEqual({
      status: 202,
      headers: { 'content-type': 'application/json' },
      body: { traceId: 'op-run-200', requestedAt: 200, completedCycleCount: 2 },
    });
    await expect(
      handler({
        method: 'GET',
        path: '/runtime/operation-traces',
        query: {
          manifestId: 'town-runtime',
          command: 'start-all',
          fromRequestedAt: '50',
          toRequestedAt: '150',
          limit: '5',
        },
      }),
    ).resolves.toEqual({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: [{ traceId: 'op-start-100', command: 'start-all' }],
    });

    expect(calls).toEqual([
      { method: 'getRuntimeStatus' },
      { method: 'startRuntime', request: { operationId: 'op-start-100', requestedAt: 100 } },
      { method: 'getRuntimeOperationTrace', request: { traceId: 'op-start-100' } },
      { method: 'getRuntimeRunSession', request: { traceId: 'op-run-200' } },
      {
        method: 'stopRuntimeRunSession',
        request: { traceId: 'op-run-200', requestedAt: 260 },
      },
      {
        method: 'runRuntime',
        request: {
          operationId: 'op-run-200',
          requestedAt: 200,
          cycleCount: 2,
          cycleIntervalMs: 50,
        },
      },
      {
        method: 'queryRuntimeOperationTraces',
        query: {
          manifestId: 'town-runtime',
          command: 'start-all',
          fromRequestedAt: 50,
          toRequestedAt: 150,
          limit: 5,
        },
      },
    ]);
  });

  test('routes async runtime run jobs to the queue service', async () => {
    const calls: unknown[] = [];
    const handler = createTownHttpApiHandler({
      simulation: createSimulationService(calls),
      runtimeSupervisor: createRuntimeSupervisorService(calls),
      runtimeRunQueue: createRuntimeRunQueueService(calls),
      runtimeRunQueueWorker: createRuntimeRunQueueWorkerService(calls),
    });

    await expect(
      handler({
        method: 'POST',
        path: '/runtime/run-jobs',
        body: {
          jobId: 'job-run-200',
          operationId: 'op-run-200',
          enqueuedAt: 190,
          requestedAt: 200,
          cycleCount: 2,
          cycleIntervalMs: 50,
          stopOnAttention: true,
        },
      }),
    ).resolves.toEqual({
      status: 202,
      headers: { 'content-type': 'application/json' },
      body: {
        jobId: 'job-run-200',
        status: 'queued',
        enqueuedAt: 190,
        runRequest: {
          operationId: 'op-run-200',
          requestedAt: 200,
          cycleCount: 2,
          cycleIntervalMs: 50,
          stopOnAttention: true,
        },
      },
    });
    await expect(
      handler({
        method: 'GET',
        path: '/runtime/run-jobs/job-run-200',
      }),
    ).resolves.toEqual({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: {
        jobId: 'job-run-200',
        status: 'queued',
        enqueuedAt: 190,
        runRequest: {
          operationId: 'op-run-200',
          requestedAt: 200,
          cycleCount: 2,
          cycleIntervalMs: 50,
          stopOnAttention: true,
        },
      },
    });
    await expect(
      handler({
        method: 'GET',
        path: '/runtime/run-jobs',
        query: { status: 'dead-lettered', manifestId: 'town-runtime', limit: '2' },
      }),
    ).resolves.toEqual({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: [
        {
          jobId: 'job-dead-200',
          status: 'dead-lettered',
          enqueuedAt: 190,
          deadLetteredAt: 250,
          runRequest: {
            operationId: 'op-run-200',
            requestedAt: 200,
            cycleCount: 2,
          },
        },
      ],
    });
    await expect(
      handler({
        method: 'POST',
        path: '/runtime/run-jobs/job-dead-200/replay',
        body: { replayedAt: 300, maxAttempts: 3 },
      }),
    ).resolves.toEqual({
      status: 202,
      headers: { 'content-type': 'application/json' },
      body: {
        jobId: 'job-dead-200',
        status: 'queued',
        enqueuedAt: 190,
        replayCount: 1,
        runRequest: {
          operationId: 'op-run-200',
          requestedAt: 200,
          cycleCount: 2,
        },
      },
    });

    expect(calls).toEqual([
      {
        method: 'enqueueRuntimeRun',
        request: {
          jobId: 'job-run-200',
          operationId: 'op-run-200',
          enqueuedAt: 190,
          requestedAt: 200,
          cycleCount: 2,
          cycleIntervalMs: 50,
          stopOnAttention: true,
        },
      },
      {
        method: 'getRuntimeRunJob',
        request: { jobId: 'job-run-200' },
      },
      {
        method: 'queryRuntimeRunJobs',
        request: { status: 'dead-lettered', manifestId: 'town-runtime', limit: 2 },
      },
      {
        method: 'replayRuntimeRunJob',
        request: { jobId: 'job-dead-200', replayedAt: 300, maxAttempts: 3 },
      },
    ]);
  });

  test('routes runtime run queue worker control requests to the worker service', async () => {
    const calls: unknown[] = [];
    const handler = createTownHttpApiHandler({
      simulation: createSimulationService(calls),
      runtimeSupervisor: createRuntimeSupervisorService(calls),
      runtimeRunQueue: createRuntimeRunQueueService(calls),
      runtimeRunQueueWorker: createRuntimeRunQueueWorkerService(calls),
    });

    await expect(
      handler({ method: 'GET', path: '/runtime/run-queue-worker/status' }),
    ).resolves.toEqual({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { running: false, inFlight: false, processedJobCount: 0 },
    });
    await expect(
      handler({ method: 'POST', path: '/runtime/run-queue-worker/start', body: {} }),
    ).resolves.toEqual({
      status: 202,
      headers: { 'content-type': 'application/json' },
      body: { running: true, inFlight: false, processedJobCount: 0 },
    });
    await expect(
      handler({
        method: 'POST',
        path: '/runtime/run-queue-worker/drain',
        body: { maxJobs: 2 },
      }),
    ).resolves.toEqual({
      status: 202,
      headers: { 'content-type': 'application/json' },
      body: {
        processedJobCount: 2,
        completedJobCount: 2,
        failedJobCount: 0,
        idle: false,
      },
    });
    await expect(
      handler({ method: 'POST', path: '/runtime/run-queue-worker/stop', body: {} }),
    ).resolves.toEqual({
      status: 202,
      headers: { 'content-type': 'application/json' },
      body: { running: false, inFlight: false, processedJobCount: 2 },
    });

    expect(calls).toEqual([
      { method: 'getRuntimeRunQueueWorkerStatus' },
      { method: 'startRuntimeRunQueueWorker' },
      { method: 'drainRuntimeRunQueueWorker', request: { maxJobs: 2 } },
      { method: 'stopRuntimeRunQueueWorker' },
    ]);
  });

  test('returns structured errors for unknown routes, wrong methods, and invalid bodies', async () => {
    const calls: unknown[] = [];
    const handler = createTownHttpApiHandler({
      simulation: createSimulationService(calls),
      runtimeSupervisor: createRuntimeSupervisorService(calls),
      runtimeRunQueue: createRuntimeRunQueueService(calls),
      runtimeRunQueueWorker: createRuntimeRunQueueWorkerService(calls),
    });

    await expect(handler({ method: 'GET', path: '/missing' })).resolves.toEqual({
      status: 404,
      headers: { 'content-type': 'application/json' },
      body: { error: { code: 'not_found', message: 'route not found' } },
    });
    await expect(handler({ method: 'DELETE', path: '/runtime/status' })).resolves.toEqual({
      status: 405,
      headers: { 'content-type': 'application/json' },
      body: { error: { code: 'method_not_allowed', message: 'method not allowed' } },
    });
    await expect(
      handler({
        method: 'POST',
        path: '/runtime/start',
        body: { requestedAt: 'later' },
      }),
    ).resolves.toEqual({
      status: 400,
      headers: { 'content-type': 'application/json' },
      body: { error: { code: 'bad_request', message: 'requestedAt must be a number' } },
    });
    await expect(
      handler({
        method: 'POST',
        path: '/runtime/run',
        body: { requestedAt: 100, cycleCount: 0 },
      }),
    ).resolves.toEqual({
      status: 400,
      headers: { 'content-type': 'application/json' },
      body: { error: { code: 'bad_request', message: 'cycleCount must be a positive integer' } },
    });
    await expect(
      handler({
        method: 'POST',
        path: '/runtime/run-jobs',
        body: { enqueuedAt: 90, requestedAt: 100, cycleCount: 1 },
      }),
    ).resolves.toEqual({
      status: 400,
      headers: { 'content-type': 'application/json' },
      body: { error: { code: 'bad_request', message: 'jobId must be a non-empty string' } },
    });
    await expect(
      handler({
        method: 'POST',
        path: '/runtime/run-jobs',
        body: { jobId: 'job-run-invalid', enqueuedAt: -1, requestedAt: 100, cycleCount: 1 },
      }),
    ).resolves.toEqual({
      status: 400,
      headers: { 'content-type': 'application/json' },
      body: {
        error: {
          code: 'bad_request',
          message: 'enqueuedAt must be a non-negative finite number',
        },
      },
    });
    await expect(
      handler({
        method: 'POST',
        path: '/runtime/run-queue-worker/drain',
        body: { maxJobs: 0 },
      }),
    ).resolves.toEqual({
      status: 400,
      headers: { 'content-type': 'application/json' },
      body: { error: { code: 'bad_request', message: 'maxJobs must be a positive integer' } },
    });
    await expect(
      handler({
        method: 'GET',
        path: '/runtime/run-jobs',
        query: { status: 'missing' },
      }),
    ).resolves.toEqual({
      status: 400,
      headers: { 'content-type': 'application/json' },
      body: {
        error: { code: 'bad_request', message: 'status must be a known run queue job status' },
      },
    });
    await expect(
      handler({
        method: 'POST',
        path: '/runtime/run-jobs/job-dead/replay',
        body: { replayedAt: -1 },
      }),
    ).resolves.toEqual({
      status: 400,
      headers: { 'content-type': 'application/json' },
      body: {
        error: { code: 'bad_request', message: 'replayedAt must be a non-negative finite number' },
      },
    });
    await expect(
      handler({
        method: 'GET',
        path: '/simulations/sim-1/partitions/world-main/events',
        query: { afterSequence: '1.5' },
      }),
    ).resolves.toEqual({
      status: 400,
      headers: { 'content-type': 'application/json' },
      body: {
        error: { code: 'bad_request', message: 'afterSequence must be a non-negative integer' },
      },
    });
    await expect(
      handler({
        method: 'GET',
        path: '/simulations/sim-1/partitions/world-main/events',
        query: { limit: '0' },
      }),
    ).resolves.toEqual({
      status: 400,
      headers: { 'content-type': 'application/json' },
      body: { error: { code: 'bad_request', message: 'limit must be a positive integer' } },
    });
    await expect(
      handler({
        method: 'GET',
        path: '/simulations/sim-1/partitions/world-main/sync',
        query: { afterSequence: '-1' },
      }),
    ).resolves.toEqual({
      status: 400,
      headers: { 'content-type': 'application/json' },
      body: {
        error: { code: 'bad_request', message: 'afterSequence must be a non-negative integer' },
      },
    });
    await expect(
      handler({
        method: 'GET',
        path: '/simulations/sim-1/partitions/world-main/sync',
        query: { limit: '0' },
      }),
    ).resolves.toEqual({
      status: 400,
      headers: { 'content-type': 'application/json' },
      body: { error: { code: 'bad_request', message: 'limit must be a positive integer' } },
    });
    await expect(
      handler({
        method: 'GET',
        path: '/simulations/sim-1/partitions/world-main/validation-reports',
        query: { limit: '0' },
      }),
    ).resolves.toEqual({
      status: 400,
      headers: { 'content-type': 'application/json' },
      body: { error: { code: 'bad_request', message: 'limit must be a positive integer' } },
    });
    expect(calls).toEqual([]);
  });
});

function createSimulationService(
  calls: unknown[],
): SimulationApiService<
  TestProjection,
  TestSteeringResult,
  TestLifecycleResult,
  TestEventFeed,
  TestSyncEnvelope,
  TestValidationReport
> {
  return {
    getProjection: (request) => {
      calls.push({ method: 'getProjection', request });
      return Promise.resolve({ agents: 80 });
    },
    getEvents: (request) => {
      calls.push({ method: 'getEvents', request });
      return Promise.resolve({
        streamVersion: 5,
        nextAfterSequence: 5,
        events: [
          { sequence: 3, type: 'SimulationTimeAdvanced' },
          { sequence: 4, type: 'EducationChanged' },
          { sequence: 5, type: 'ShortTermMemoryRecorded' },
        ],
      });
    },
    getSync: (request) => {
      calls.push({ method: 'getSync', request });
      return Promise.resolve({
        streamVersion: 5,
        projectionSequence: 5,
        nextAfterSequence: 5,
        hasMoreEvents: false,
        projection: { agents: 80 },
        events: [
          { sequence: 3, type: 'SimulationTimeAdvanced' },
          { sequence: 4, type: 'EducationChanged' },
          { sequence: 5, type: 'ShortTermMemoryRecorded' },
        ],
      });
    },
    queryExperimentValidationReports: (request) => {
      calls.push({ method: 'queryExperimentValidationReports', request });
      return Promise.resolve([{ run: { runId: request.runId ?? 'validation-2' } }]);
    },
    getExperimentValidationReport: (request) => {
      calls.push({ method: 'getExperimentValidationReport', request });
      return Promise.resolve({ run: { runId: request.runId } });
    },
    submitLongHorizonObjective: (request) => {
      calls.push({ method: 'submitLongHorizonObjective', request });
      return Promise.resolve({
        command: createCommandEnvelope({
          id: 'command-objective',
          simulationId: request.simulationId,
          actorId: request.agentId,
          source: 'human',
          type: 'SetLongHorizonObjective',
          payload: {},
          issuedAt: request.issuedAt,
        }),
        result: { accepted: true },
      });
    },
    submitReactiveCommand: (request) => {
      calls.push({ method: 'submitReactiveCommand', request });
      return Promise.resolve({
        command: createCommandEnvelope({
          id: 'command-reactive',
          simulationId: request.simulationId,
          actorId: request.agentId,
          source: 'human',
          type: 'IssueReactiveCommand',
          payload: {},
          issuedAt: request.issuedAt,
        }),
        result: { accepted: true },
      });
    },
    startSimulation: (request) => {
      calls.push({ method: 'startSimulation', request });
      return Promise.resolve({ status: 'started', requestedAt: request.requestedAt });
    },
    pauseSimulation: (request) => {
      calls.push({ method: 'pauseSimulation', request });
      return Promise.resolve({ status: 'paused', requestedAt: request.requestedAt });
    },
    resetSimulation: (request) => {
      calls.push({ method: 'resetSimulation', request });
      return Promise.resolve({ status: 'reset', requestedAt: request.requestedAt });
    },
    replaySimulation: (request) => {
      calls.push({ method: 'replaySimulation', request });
      return Promise.resolve({ status: 'replaying', requestedAt: request.requestedAt });
    },
  };
}

function createRuntimeSupervisorService(
  calls: unknown[],
): RuntimeSupervisorApiService<
  TestRuntimeStatus,
  TestRuntimeCommandResult,
  TestRuntimeCommandResult,
  TestRuntimeCommandResult,
  TestRuntimeTrace,
  'start-all' | 'pause-all' | 'run-cycles',
  TestRuntimeRunSession
> {
  return {
    getRuntimeStatus: () => {
      calls.push({ method: 'getRuntimeStatus' });
      return Promise.resolve({ manifestId: 'town-runtime' });
    },
    startRuntime: (request) => {
      calls.push({ method: 'startRuntime', request });
      return Promise.resolve({
        traceId: request.operationId ?? 'generated-start',
        requestedAt: request.requestedAt,
      });
    },
    pauseRuntime: (request) => {
      calls.push({ method: 'pauseRuntime', request });
      return Promise.resolve({
        traceId: request.operationId ?? 'generated-pause',
        requestedAt: request.requestedAt,
      });
    },
    runRuntime: (request) => {
      calls.push({ method: 'runRuntime', request });
      return Promise.resolve({
        traceId: request.operationId ?? 'generated-run',
        requestedAt: request.requestedAt,
        completedCycleCount: request.cycleCount,
      });
    },
    getRuntimeOperationTrace: (request) => {
      calls.push({ method: 'getRuntimeOperationTrace', request });
      return Promise.resolve({ traceId: request.traceId, command: 'start-all' });
    },
    getRuntimeRunSession: (request) => {
      calls.push({ method: 'getRuntimeRunSession', request });
      return Promise.resolve({
        traceId: request.traceId,
        status: 'completed',
        completedCycleCount: 2,
      });
    },
    stopRuntimeRunSession: (request) => {
      calls.push({ method: 'stopRuntimeRunSession', request });
      return Promise.resolve({
        traceId: request.traceId,
        status: 'running',
        completedCycleCount: 2,
        stopRequestedAt: request.requestedAt,
      });
    },
    queryRuntimeOperationTraces: (query) => {
      calls.push({ method: 'queryRuntimeOperationTraces', query });
      return Promise.resolve([{ traceId: 'op-start-100', command: 'start-all' }]);
    },
  };
}

function createRuntimeRunQueueService(
  calls: unknown[],
): RuntimeRunQueueApiService<TestRuntimeRunQueueJob> {
  return {
    enqueueRuntimeRun: (request) => {
      calls.push({ method: 'enqueueRuntimeRun', request });
      return Promise.resolve({
        jobId: request.jobId,
        status: 'queued',
        enqueuedAt: request.enqueuedAt,
        runRequest: {
          ...(request.operationId === undefined ? {} : { operationId: request.operationId }),
          requestedAt: request.requestedAt,
          cycleCount: request.cycleCount,
          ...(request.cycleIntervalMs === undefined
            ? {}
            : { cycleIntervalMs: request.cycleIntervalMs }),
          ...(request.stopOnAttention === undefined
            ? {}
            : { stopOnAttention: request.stopOnAttention }),
        },
      });
    },
    getRuntimeRunJob: (request) => {
      calls.push({ method: 'getRuntimeRunJob', request });
      return Promise.resolve({
        jobId: request.jobId,
        status: 'queued',
        enqueuedAt: 190,
        runRequest: {
          operationId: 'op-run-200',
          requestedAt: 200,
          cycleCount: 2,
          cycleIntervalMs: 50,
          stopOnAttention: true,
        },
      });
    },
    queryRuntimeRunJobs: (request) => {
      calls.push({ method: 'queryRuntimeRunJobs', request });
      return Promise.resolve([
        {
          jobId: 'job-dead-200',
          status: 'dead-lettered',
          enqueuedAt: 190,
          deadLetteredAt: 250,
          runRequest: {
            operationId: 'op-run-200',
            requestedAt: 200,
            cycleCount: 2,
          },
        },
      ]);
    },
    replayRuntimeRunJob: (request) => {
      calls.push({ method: 'replayRuntimeRunJob', request });
      return Promise.resolve({
        jobId: request.jobId,
        status: 'queued',
        enqueuedAt: 190,
        replayCount: 1,
        runRequest: {
          operationId: 'op-run-200',
          requestedAt: 200,
          cycleCount: 2,
        },
      });
    },
  };
}

function createRuntimeRunQueueWorkerService(
  calls: unknown[],
): RuntimeRunQueueWorkerApiService<
  TestRuntimeRunQueueWorkerStatus,
  TestRuntimeRunQueueWorkerDrainResult
> {
  return {
    getRuntimeRunQueueWorkerStatus: () => {
      calls.push({ method: 'getRuntimeRunQueueWorkerStatus' });
      return Promise.resolve({ running: false, inFlight: false, processedJobCount: 0 });
    },
    startRuntimeRunQueueWorker: () => {
      calls.push({ method: 'startRuntimeRunQueueWorker' });
      return Promise.resolve({ running: true, inFlight: false, processedJobCount: 0 });
    },
    stopRuntimeRunQueueWorker: () => {
      calls.push({ method: 'stopRuntimeRunQueueWorker' });
      return Promise.resolve({ running: false, inFlight: false, processedJobCount: 2 });
    },
    drainRuntimeRunQueueWorker: (request) => {
      calls.push({ method: 'drainRuntimeRunQueueWorker', request });
      return Promise.resolve({
        processedJobCount: request.maxJobs ?? 1,
        completedJobCount: request.maxJobs ?? 1,
        failedJobCount: 0,
        idle: false,
      });
    },
  };
}
