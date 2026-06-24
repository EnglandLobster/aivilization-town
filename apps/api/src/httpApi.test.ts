import { describe, expect, test } from 'vitest';
import { createCommandEnvelope } from '@aivilization/sim-core';
import { createTownHttpApiHandler } from './index';
import type { SimulationApiService } from './simulationApi';
import type { RuntimeSupervisorApiService } from './runtimeSupervisorApi';

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

type TestRuntimeStatus = {
  readonly manifestId: string;
};

type TestRuntimeCommandResult = {
  readonly traceId: string;
  readonly requestedAt: number;
};

type TestRuntimeTrace = {
  readonly traceId: string;
  readonly command: 'start-all' | 'pause-all';
};

describe('town HTTP API router', () => {
  test('routes projection, steering, and lifecycle requests to the simulation service', async () => {
    const calls: unknown[] = [];
    const handler = createTownHttpApiHandler({
      simulation: createSimulationService(calls),
      runtimeSupervisor: createRuntimeSupervisorService(calls),
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

  test('returns structured errors for unknown routes, wrong methods, and invalid bodies', async () => {
    const calls: unknown[] = [];
    const handler = createTownHttpApiHandler({
      simulation: createSimulationService(calls),
      runtimeSupervisor: createRuntimeSupervisorService(calls),
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
    expect(calls).toEqual([]);
  });
});

function createSimulationService(
  calls: unknown[],
): SimulationApiService<TestProjection, TestSteeringResult, TestLifecycleResult> {
  return {
    getProjection: (request) => {
      calls.push({ method: 'getProjection', request });
      return Promise.resolve({ agents: 80 });
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
  TestRuntimeTrace,
  'start-all' | 'pause-all'
> {
  return {
    getRuntimeStatus: () => {
      calls.push({ method: 'getRuntimeStatus' });
      return Promise.resolve({ manifestId: 'town-runtime' });
    },
    startRuntime: (request) => {
      calls.push({ method: 'startRuntime', request });
      return Promise.resolve({ traceId: request.operationId ?? 'generated-start', requestedAt: request.requestedAt });
    },
    pauseRuntime: (request) => {
      calls.push({ method: 'pauseRuntime', request });
      return Promise.resolve({ traceId: request.operationId ?? 'generated-pause', requestedAt: request.requestedAt });
    },
    getRuntimeOperationTrace: (request) => {
      calls.push({ method: 'getRuntimeOperationTrace', request });
      return Promise.resolve({ traceId: request.traceId, command: 'start-all' });
    },
    queryRuntimeOperationTraces: (query) => {
      calls.push({ method: 'queryRuntimeOperationTraces', query });
      return Promise.resolve([{ traceId: 'op-start-100', command: 'start-all' }]);
    },
  };
}
