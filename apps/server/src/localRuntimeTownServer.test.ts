import { afterEach, describe, expect, test } from 'vitest';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ScenarioPreset } from '@aivilization/content';
import { createExperimentValidationReport } from '@aivilization/observability';
import { asAgentId, asLocationId, type AgentId } from '@aivilization/sim-core';
import { type WorldCommandPolicies } from '@aivilization/world';
import { createLocalRuntimeTownNodeHttpServer } from './index';
import {
  FileLocalSimulationRuntimeRunQueueRepository,
  FileLocalSimulationRuntimeRunSessionRepository,
  type LocalSimulationRuntimeManifest,
  type LocalSimulationRuntimeSupervisorStartAllResult,
} from '@aivilization/worker';

const agentOne = asAgentId('agent-1');
const agentTwo = asAgentId('agent-2');
const mainSquare = asLocationId('main-square');
const tmpRoots: string[] = [];
const servers: Server[] = [];

const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 10,
  laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
  criticalThresholds: { energy: 1, health: 1 },
};

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (server !== undefined) {
      await closeServer(server);
    }
  }
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('local runtime town HTTP gateway', () => {
  test('serves supervisor and projection routes from a manifest-bootstrapped local runtime', async () => {
    const runtime = await createLocalRuntimeTownNodeHttpServer({
      rootDir: createRootDir(),
      bootstrappedAt: 100,
      manifest: createManifest(),
      scenarioPresets: createScenarioPresets(),
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
    });
    const server = await listen(runtime.server);

    const status = await fetchJson(`${server.baseUrl}/runtime/status`);
    expect(status).toMatchObject({
      manifestId: 'town-runtime',
      partitionCount: 2,
      healthyPartitionCount: 2,
      partitions: [
        {
          simulationId: 'sim-1',
          partitionKey: 'world-main',
          scenarioPresetId: 'scenario-main',
          status: 'bootstrapped',
        },
        {
          simulationId: 'sim-1',
          partitionKey: 'world-east',
          scenarioPresetId: 'scenario-east',
          status: 'bootstrapped',
        },
      ],
    });

    const projection = await fetchJson(
      `${server.baseUrl}/simulations/sim-1/partitions/world-main/projection`,
    );
    expect(projection).toMatchObject({
      projection: {
        agents: {
          'agent-1': {
            educationScore: 10,
          },
        },
      },
    });

    const start = await fetchJson(`${server.baseUrl}/runtime/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operationId: 'op-start-all-200', requestedAt: 200 }),
    });
    expect(start).toMatchObject({
      traceId: 'op-start-all-200',
      outcome: 'succeeded',
      succeededPartitionCount: 2,
      failedPartitionCount: 0,
    });

    const eventFeed = requireEventFeed(
      await fetchJson(
        `${server.baseUrl}/simulations/sim-1/partitions/world-main/events?afterSequence=0&limit=5`,
      ),
    );
    expect(eventFeed).toMatchObject({
      streamName: 'simulation/sim-1/partition/world-main/events',
      streamVersion: 1,
      nextAfterSequence: 1,
    });
    expect(eventFeed.events.map((event) => [event.sequence, event.type])).toEqual([
      [1, 'SimulationTimeAdvanced'],
    ]);

    const sync = requireSyncEnvelope(
      await fetchJson(
        `${server.baseUrl}/simulations/sim-1/partitions/world-main/sync?afterSequence=0&limit=1`,
      ),
    );
    expect(sync).toMatchObject({
      streamName: 'simulation/sim-1/partition/world-main/events',
      streamVersion: 1,
      projectionSequence: 1,
      nextAfterSequence: 1,
      hasMoreEvents: false,
    });
    expect(sync.projection.agents['agent-1']?.educationScore).toBe(10);
    expect(sync.events.map((event) => [event.sequence, event.type])).toEqual([
      [1, 'SimulationTimeAdvanced'],
    ]);

    const syncEvent = await fetchFirstSseEvent(
      `${server.baseUrl}/simulations/sim-1/partitions/world-main/sync-stream?afterSequence=0&limit=1`,
    );
    expect(syncEvent).toContain('id: 1\n');
    expect(syncEvent).toContain('event: sync\n');
    expect(syncEvent).toContain('"streamName":"simulation/sim-1/partition/world-main/events"');
    expect(syncEvent).toContain('"nextAfterSequence":1');
    expect(syncEvent).toContain('"type":"SimulationTimeAdvanced"');

    const validationReport = createValidationReport();
    await runtime.host.registry
      .getBackend({ simulationId: 'sim-1', partitionKey: 'world-main' })
      .storage.experimentValidationReportRepository.record(validationReport);
    const validationReports = await fetchJson(
      `${server.baseUrl}/simulations/sim-1/partitions/world-main/validation-reports?limit=1`,
    );
    expect(validationReports).toMatchObject([
      {
        run: {
          runId: 'validation-server-1',
          simulationId: 'sim-1',
        },
      },
    ]);

    const trace = await fetchJson(`${server.baseUrl}/runtime/operation-traces/op-start-all-200`);
    expect(trace).toMatchObject({
      traceId: 'op-start-all-200',
      manifestId: 'town-runtime',
      command: 'start-all',
      outcome: 'succeeded',
    });

    const run = await fetchJson(`${server.baseUrl}/runtime/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operationId: 'op-run-cycles-400',
        requestedAt: 400,
        cycleCount: 2,
        cycleIntervalMs: 100,
      }),
    });
    expect(run).toMatchObject({
      traceId: 'op-run-cycles-400',
      outcome: 'succeeded',
      requestedCycleCount: 2,
      completedCycleCount: 2,
      stopReason: 'cycle-count-completed',
      cycles: [
        {
          traceId: 'op-run-cycles-400:cycle:1',
          requestedAt: 400,
          outcome: 'succeeded',
        },
        {
          traceId: 'op-run-cycles-400:cycle:2',
          requestedAt: 500,
          outcome: 'succeeded',
        },
      ],
    });

    const queuedRun = await fetchJson(`${server.baseUrl}/runtime/run-jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jobId: 'job-run-async-600',
        operationId: 'op-run-async-600',
        enqueuedAt: 590,
        requestedAt: 600,
        cycleCount: 3,
        cycleIntervalMs: 75,
        stopOnAttention: true,
      }),
    });
    expect(queuedRun).toMatchObject({
      jobId: 'job-run-async-600',
      manifestId: 'town-runtime',
      status: 'queued',
      enqueuedAt: 590,
      updatedAt: 590,
      runRequest: {
        operationId: 'op-run-async-600',
        requestedAt: 600,
        cycleCount: 3,
        cycleIntervalMs: 75,
        stopOnAttention: true,
      },
    });
    await expect(
      fetchJson(`${server.baseUrl}/runtime/run-jobs/job-run-async-600`),
    ).resolves.toMatchObject({
      jobId: 'job-run-async-600',
      manifestId: 'town-runtime',
      status: 'queued',
      enqueuedAt: 590,
      runRequest: {
        operationId: 'op-run-async-600',
        requestedAt: 600,
        cycleCount: 3,
      },
    });
    await expect(
      fetchJson(`${server.baseUrl}/runtime/run-queue-worker/status`),
    ).resolves.toMatchObject({
      running: false,
      inFlight: false,
      processedJobCount: 0,
    });
    await expect(
      fetchJson(`${server.baseUrl}/runtime/run-queue-worker/drain`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ maxJobs: 1 }),
      }),
    ).resolves.toMatchObject({
      processedJobCount: 1,
      completedJobCount: 1,
      failedJobCount: 0,
      results: [{ status: 'completed', job: { jobId: 'job-run-async-600' } }],
    });
    await expect(
      fetchJson(`${server.baseUrl}/runtime/run-queue-worker/status`),
    ).resolves.toMatchObject({
      running: false,
      inFlight: false,
      processedJobCount: 1,
      completedJobCount: 1,
      failedJobCount: 0,
    });
    await expect(
      fetchJson(`${server.baseUrl}/runtime/run-jobs/job-run-async-600`),
    ).resolves.toMatchObject({
      jobId: 'job-run-async-600',
      manifestId: 'town-runtime',
      status: 'completed',
      resultTraceId: 'op-run-async-600',
    });
    await expect(
      fetchJson(`${server.baseUrl}/runtime/run-sessions/op-run-async-600`),
    ).resolves.toMatchObject({
      traceId: 'op-run-async-600',
      manifestId: 'town-runtime',
      status: 'completed',
      completedCycleCount: 3,
      stopReason: 'cycle-count-completed',
    });

    const runQueueRepository = new FileLocalSimulationRuntimeRunQueueRepository({
      rootDir: join(runtime.host.rootDir, 'operations'),
    });
    await runQueueRepository.enqueue({
      jobId: 'job-dead-server-1',
      manifestId: 'town-runtime',
      enqueuedAt: 800,
      runRequest: {
        operationId: 'op-run-dead-server-1',
        requestedAt: 810,
        cycleCount: 1,
      },
    });
    await runQueueRepository.claimNext({
      workerId: 'worker-dead',
      claimedAt: 820,
      leaseDurationMs: 100,
    });
    await runQueueRepository.fail({
      jobId: 'job-dead-server-1',
      failedAt: 830,
      maxAttempts: 1,
      error: { name: 'Error', message: 'server-side failure' },
    });
    await expect(
      fetchJson(
        `${server.baseUrl}/runtime/run-jobs?status=dead-lettered&manifestId=town-runtime&limit=1`,
      ),
    ).resolves.toMatchObject([
      {
        jobId: 'job-dead-server-1',
        manifestId: 'town-runtime',
        status: 'dead-lettered',
        deadLetteredAt: 830,
      },
    ]);
    await expect(
      fetchJson(`${server.baseUrl}/runtime/run-jobs/job-dead-server-1/replay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ replayedAt: 900 }),
      }),
    ).resolves.toMatchObject({
      jobId: 'job-dead-server-1',
      manifestId: 'town-runtime',
      status: 'queued',
      nextAttemptAt: 900,
      replayCount: 1,
      lastReplayedAt: 900,
    });
    await expect(
      fetchJson(`${server.baseUrl}/runtime/run-jobs/job-dead-server-1`),
    ).resolves.toMatchObject({
      jobId: 'job-dead-server-1',
      status: 'queued',
      maxAttempts: 2,
    });
    await expect(
      fetchJson(`${server.baseUrl}/runtime/run-jobs/stats?observedAt=910&manifestId=town-runtime`),
    ).resolves.toMatchObject({
      observedAt: 910,
      manifestId: 'town-runtime',
      totalJobCount: 2,
      statusCounts: {
        queued: 1,
        leased: 0,
        completed: 1,
        failed: 0,
        'dead-lettered': 0,
      },
      readyQueueCount: 1,
      delayedQueueCount: 0,
      activeLeaseCount: 0,
      expiredLeaseCount: 0,
      failedAttemptCount: 1,
      replayCount: 1,
      oldestQueuedAt: 800,
      oldestReadyJobEnqueuedAt: 800,
    });

    const runSession = await fetchJson(`${server.baseUrl}/runtime/run-sessions/op-run-cycles-400`);
    expect(runSession).toMatchObject({
      traceId: 'op-run-cycles-400',
      manifestId: 'town-runtime',
      status: 'completed',
      outcome: 'succeeded',
      requestedCycleCount: 2,
      completedCycleCount: 2,
      stopReason: 'cycle-count-completed',
      cycles: [
        {
          cycleIndex: 1,
          traceId: 'op-run-cycles-400:cycle:1',
          requestedAt: 400,
        },
        {
          cycleIndex: 2,
          traceId: 'op-run-cycles-400:cycle:2',
          requestedAt: 500,
        },
      ],
    });

    const stopFirstCycle = await runtime.supervisor.startAll({
      operationId: 'op-run-stop-700:cycle:1',
      requestedAt: 700,
    });
    const runSessionRepository = new FileLocalSimulationRuntimeRunSessionRepository({
      rootDir: join(runtime.host.rootDir, 'operations'),
    });
    await runSessionRepository.save({
      traceId: 'op-run-stop-700',
      manifestId: 'town-runtime',
      requestedAt: 700,
      requestedCycleCount: 3,
      cycleIntervalMs: 50,
      stopOnAttention: true,
      status: 'running',
      completedCycleCount: 1,
      cycles: [createRunCycleSummary(1, 700, stopFirstCycle)],
      statusSnapshot: stopFirstCycle.status,
      updatedAt: 700,
    });
    const stopRequest = await fetchJson(
      `${server.baseUrl}/runtime/run-sessions/op-run-stop-700/stop`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestedAt: 725 }),
      },
    );
    expect(stopRequest).toMatchObject({
      traceId: 'op-run-stop-700',
      status: 'running',
      stopRequestedAt: 725,
    });

    const stoppedRun = await fetchJson(`${server.baseUrl}/runtime/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operationId: 'op-run-stop-700',
        requestedAt: 700,
        cycleCount: 3,
        cycleIntervalMs: 50,
      }),
    });
    expect(stoppedRun).toMatchObject({
      traceId: 'op-run-stop-700',
      completedCycleCount: 2,
      stopReason: 'stop-requested',
      cycles: [
        { cycleIndex: 1, traceId: 'op-run-stop-700:cycle:1', requestedAt: 700 },
        { cycleIndex: 2, traceId: 'op-run-stop-700:cycle:2', requestedAt: 750 },
      ],
    });
    const stoppedSession = await fetchJson(
      `${server.baseUrl}/runtime/run-sessions/op-run-stop-700`,
    );
    expect(stoppedSession).toMatchObject({
      traceId: 'op-run-stop-700',
      status: 'stopped',
      stopReason: 'stop-requested',
      stopRequestedAt: 725,
      completedCycleCount: 2,
    });

    const runTrace = await fetchJson(
      `${server.baseUrl}/runtime/operation-traces/op-run-cycles-400`,
    );
    expect(runTrace).toMatchObject({
      traceId: 'op-run-cycles-400',
      manifestId: 'town-runtime',
      command: 'run-cycles',
      outcome: 'succeeded',
      cycles: [
        {
          cycleIndex: 1,
          traceId: 'op-run-cycles-400:cycle:1',
          requestedAt: 400,
        },
        {
          cycleIndex: 2,
          traceId: 'op-run-cycles-400:cycle:2',
          requestedAt: 500,
        },
      ],
    });
  });
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-local-server-'));
  tmpRoots.push(root);
  return root;
}

function createManifest(): LocalSimulationRuntimeManifest {
  return {
    id: 'town-runtime',
    defaults: {
      tickBatchSize: 1,
      tickIntervalMs: 100,
      commandConsumerIdPrefix: 'worker',
    },
    partitions: [
      {
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        scenarioPresetId: 'scenario-main',
      },
      {
        simulationId: 'sim-1',
        partitionKey: 'world-east',
        scenarioPresetId: 'scenario-east',
      },
    ],
  };
}

function createScenarioPresets(): readonly ScenarioPreset[] {
  return [
    createScenarioPreset({
      id: 'scenario-main',
      agentId: agentOne,
      educationScore: 10,
    }),
    createScenarioPreset({
      id: 'scenario-east',
      agentId: agentTwo,
      educationScore: 20,
    }),
  ];
}

function createScenarioPreset(input: {
  readonly id: string;
  readonly agentId: AgentId;
  readonly educationScore: number;
}): ScenarioPreset {
  return {
    id: input.id,
    name: input.id,
    description: `${input.id} test scenario`,
    clock: { now: 0, tickDurationMs: 1000 },
    timeScale: 35,
    locations: [
      {
        locationId: mainSquare,
        name: 'Main Square',
        kind: 'social',
        activityAffinities: ['study'],
        capacity: null,
        source: 'test',
      },
    ],
    agentSeeds: [
      {
        agentId: input.agentId,
        displayName: input.agentId,
        profile: { personality: { mbti: 'INTJ' }, source: 'test' },
        physiology: { energy: 50, satiety: 80, health: 100 },
        educationScore: input.educationScore,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
        locationId: mainSquare,
        source: 'test',
        tags: ['test'],
      },
    ],
    source: 'test',
  };
}

function createRunCycleSummary(
  cycleIndex: number,
  requestedAt: number,
  result: LocalSimulationRuntimeSupervisorStartAllResult,
) {
  return {
    cycleIndex,
    traceId: result.traceId,
    requestedAt,
    outcome: result.outcome,
    succeededPartitionCount: result.succeededPartitionCount,
    failedPartitionCount: result.failedPartitionCount,
    attentionPartitionCount: result.status.attentionPartitionCount,
  };
}

function createValidationReport() {
  return createExperimentValidationReport({
    run: {
      runId: 'validation-server-1',
      simulationId: 'sim-1',
      generatedAt: 500,
    },
    priceSeries: [
      { commodityId: 'Fish', observedAt: 0, closePrice: 100 },
      { commodityId: 'Fish', observedAt: 1, closePrice: 101 },
    ],
    wealthSnapshot: [
      { agentId: 'agent-1', educationScore: 10, netWorth: 100 },
      { agentId: 'agent-2', educationScore: 20, netWorth: 120 },
    ],
    plannerRuns: [
      {
        taskId: 'task-1',
        variant: 'default',
        metrics: [{ metricId: 'net-worth', value: 100, higherIsBetter: true }],
      },
      {
        taskId: 'task-1',
        variant: 'without-branch',
        metrics: [{ metricId: 'net-worth', value: 80, higherIsBetter: true }],
      },
    ],
    expectedTrajectoryAgentIds: ['agent-1'],
    trajectories: [{ agentId: 'agent-1', stepCount: 1 }],
    thresholds: {
      heavyTailReturns: { minimumExcessKurtosis: -2 },
    },
  });
}

async function listen(server: Server): Promise<{ readonly baseUrl: string }> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  servers.push(server);
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('expected TCP server address');
  }
  return { baseUrl: `http://127.0.0.1:${address.port}` };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }
      reject(error);
    });
  });
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  expect(response.status).toBeGreaterThanOrEqual(200);
  expect(response.status).toBeLessThan(300);
  return response.json() as Promise<unknown>;
}

async function fetchFirstSseEvent(url: string): Promise<string> {
  const abort = new AbortController();
  const response = await fetch(url, {
    headers: { accept: 'text/event-stream' },
    signal: abort.signal,
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new Error('expected response body reader');
  }
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (!buffer.includes('\n\n')) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    abort.abort();
    await reader.cancel().catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        throw error;
      }
    });
  }
  return buffer.slice(0, buffer.indexOf('\n\n') + 2);
}

function requireEventFeed(value: unknown): {
  readonly streamName: string;
  readonly streamVersion: number;
  readonly nextAfterSequence: number;
  readonly events: readonly { readonly sequence: number; readonly type: string }[];
} {
  if (value === null || typeof value !== 'object' || !('events' in value)) {
    throw new Error('expected event feed response');
  }
  return value as {
    readonly streamName: string;
    readonly streamVersion: number;
    readonly nextAfterSequence: number;
    readonly events: readonly { readonly sequence: number; readonly type: string }[];
  };
}

function requireSyncEnvelope(value: unknown): {
  readonly streamName: string;
  readonly streamVersion: number;
  readonly projectionSequence: number;
  readonly nextAfterSequence: number;
  readonly hasMoreEvents: boolean;
  readonly projection: {
    readonly agents: Readonly<Record<string, { readonly educationScore: number }>>;
  };
  readonly events: readonly { readonly sequence: number; readonly type: string }[];
} {
  if (value === null || typeof value !== 'object' || !('projection' in value)) {
    throw new Error('expected sync envelope response');
  }
  return value as {
    readonly streamName: string;
    readonly streamVersion: number;
    readonly projectionSequence: number;
    readonly nextAfterSequence: number;
    readonly hasMoreEvents: boolean;
    readonly projection: {
      readonly agents: Readonly<Record<string, { readonly educationScore: number }>>;
    };
    readonly events: readonly { readonly sequence: number; readonly type: string }[];
  };
}
