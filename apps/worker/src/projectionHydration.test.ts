import {
  InMemoryEventStore,
  asAgentId,
  createEventEnvelope,
  createSimulationPartition,
} from '@aivilization/sim-core';
import {
  createWorldProjection,
  type WorldEvent,
  type WorldProjection,
} from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import { hydrateWorldProjectionFromEventStream } from './index';

const partition = createSimulationPartition({
  simulationId: 'sim-1',
  partitionKey: 'world-main',
});

function createProjection(): WorldProjection {
  return createWorldProjection({
    agents: [
      {
        agentId: asAgentId('agent-1'),
        physiology: { energy: 100, satiety: 80, health: 100 },
        educationScore: 10,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
    ],
  });
}

function createTimeEvent(sequence: number): WorldEvent {
  return createEventEnvelope({
    id: `event-${sequence}`,
    simulationId: 'sim-1',
    commandId: 'command-time',
    type: 'SimulationTimeAdvanced',
    payload: {
      previous: { now: 0, tickDurationMs: 1000 },
      next: { now: 1000, tickDurationMs: 1000 },
      deltaMs: 1000,
    },
    occurredAt: 100,
    sequence,
  });
}

function createEducationEvent(sequence: number): WorldEvent {
  return createEventEnvelope({
    id: `event-${sequence}`,
    simulationId: 'sim-1',
    commandId: 'command-study',
    type: 'EducationChanged',
    payload: {
      agentId: asAgentId('agent-1'),
      previousEducationScore: 10,
      nextEducationScore: 70,
      reason: 'study',
    },
    occurredAt: 100,
    sequence,
  });
}

describe('worker projection hydration', () => {
  test('hydrates a world projection from ordered events in an event stream', () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    eventStore.appendToStream({
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      events: [createTimeEvent(1), createEducationEvent(2)],
    });

    const result = hydrateWorldProjectionFromEventStream({
      initialProjection: createProjection(),
      eventStore,
      streamName: partition.eventStreamName,
    });

    expect(result.events.map((event) => [event.sequence, event.type])).toEqual([
      [1, 'SimulationTimeAdvanced'],
      [2, 'EducationChanged'],
    ]);
    expect(result.projection.clock).toEqual({ now: 1000, tickDurationMs: 1000 });
    expect(result.projection.agents['agent-1']?.educationScore).toBe(70);
    expect(result.lastAppliedSequence).toBe(2);
    expect(result.streamVersion).toBe(2);
  });

  test('hydrates only through the requested target sequence for idempotent retries', () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    eventStore.appendToStream({
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      events: [createTimeEvent(1), createEducationEvent(2)],
    });

    const result = hydrateWorldProjectionFromEventStream({
      initialProjection: createProjection(),
      eventStore,
      streamName: partition.eventStreamName,
      toSequence: 1,
    });

    expect(result.events.map((event) => event.sequence)).toEqual([1]);
    expect(result.projection.clock).toEqual({ now: 1000, tickDurationMs: 1000 });
    expect(result.projection.agents['agent-1']?.educationScore).toBe(10);
    expect(result.lastAppliedSequence).toBe(1);
    expect(result.streamVersion).toBe(2);
  });

  test('rejects invalid hydration bounds before replaying events', () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    expect(() =>
      hydrateWorldProjectionFromEventStream({
        initialProjection: createProjection(),
        eventStore,
        streamName: partition.eventStreamName,
        fromSequence: 2,
        toSequence: 1,
      }),
    ).toThrow('toSequence must be greater than or equal to fromSequence');
  });
});
