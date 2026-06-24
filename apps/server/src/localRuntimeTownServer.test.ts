import { afterEach, describe, expect, test } from 'vitest';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ScenarioPreset } from '@aivilization/content';
import { asAgentId, asLocationId, type AgentId } from '@aivilization/sim-core';
import { type WorldCommandPolicies } from '@aivilization/world';
import { createLocalRuntimeTownNodeHttpServer } from './index';
import type { LocalSimulationRuntimeManifest } from '@aivilization/worker';

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

    const trace = await fetchJson(`${server.baseUrl}/runtime/operation-traces/op-start-all-200`);
    expect(trace).toMatchObject({
      traceId: 'op-start-all-200',
      manifestId: 'town-runtime',
      command: 'start-all',
      outcome: 'succeeded',
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
