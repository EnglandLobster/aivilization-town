import {
  FileProjectionSnapshotStore,
  InMemoryEventStore,
  InMemoryProjectionCheckpointStore,
  asAgentId,
  createProjectionCheckpoint,
  createEventEnvelope,
  createSimulationPartition,
} from '@aivilization/sim-core';
import { createWorldProjection, type WorldEvent, type WorldProjection } from '@aivilization/world';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import { hydrateWorldProjectionFromEventStream } from './index';

const partition = createSimulationPartition({
  simulationId: 'sim-1',
  partitionKey: 'world-main',
});

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-worker-hydration-'));
  tmpRoots.push(root);
  return root;
}

function createProjection(
  input: { readonly now?: number; readonly educationScore?: number } = {},
): WorldProjection {
  return createWorldProjection({
    clock: { now: input.now ?? 0, tickDurationMs: 1000 },
    agents: [
      {
        agentId: asAgentId('agent-1'),
        physiology: { energy: 100, satiety: 80, health: 100 },
        educationScore: input.educationScore ?? 10,
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

function createEducationEvent(
  sequence: number,
  input: { readonly previousEducationScore?: number; readonly nextEducationScore?: number } = {},
): WorldEvent {
  return createEventEnvelope({
    id: `event-${sequence}`,
    simulationId: 'sim-1',
    commandId: 'command-study',
    type: 'EducationChanged',
    payload: {
      agentId: asAgentId('agent-1'),
      previousEducationScore: input.previousEducationScore ?? 10,
      nextEducationScore: input.nextEducationScore ?? 70,
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

  test('starts from a checkpoint snapshot and only replays newer events', () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    eventStore.appendToStream({
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      events: [
        createTimeEvent(1),
        createEducationEvent(2),
        createEducationEvent(3, { previousEducationScore: 70, nextEducationScore: 90 }),
      ],
    });
    const checkpointStore = new InMemoryProjectionCheckpointStore();
    const snapshotStore = new FileProjectionSnapshotStore<WorldProjection>({
      rootDir: createRootDir(),
    });
    const snapshot = snapshotStore.saveSnapshot({
      simulationId: partition.simulationId,
      partitionKey: partition.partitionKey,
      sequence: 2,
      createdAt: 200,
      projection: createProjection({ now: 1000, educationScore: 70 }),
    });
    const checkpoint = checkpointStore.saveCheckpoint(
      createProjectionCheckpoint({
        simulationId: partition.simulationId,
        partitionKey: partition.partitionKey,
        lastAppliedSequence: 2,
        snapshot,
      }),
    );

    const result = hydrateWorldProjectionFromEventStream({
      initialProjection: createProjection(),
      eventStore,
      streamName: partition.eventStreamName,
      checkpoint: {
        checkpointStore,
        snapshotStore,
        lookup: {
          simulationId: partition.simulationId,
          partitionKey: partition.partitionKey,
        },
      },
    });

    expect(result.events.map((event) => event.sequence)).toEqual([3]);
    expect(result.replayFromSequence).toBe(2);
    expect(result.checkpoint).toEqual(checkpoint);
    expect(result.snapshot).toEqual(snapshot);
    expect(result.projection.clock).toEqual({ now: 1000, tickDurationMs: 1000 });
    expect(result.projection.agents['agent-1']?.educationScore).toBe(90);
    expect(result.lastAppliedSequence).toBe(3);
    expect(result.streamVersion).toBe(3);
  });

  test('rejects a checkpoint whose snapshot blob is missing', () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    eventStore.appendToStream({
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      events: [createTimeEvent(1), createEducationEvent(2)],
    });
    const checkpointStore = new InMemoryProjectionCheckpointStore();
    const snapshotStore = new FileProjectionSnapshotStore<WorldProjection>({
      rootDir: createRootDir(),
    });
    const snapshot = snapshotStore.saveSnapshot({
      simulationId: partition.simulationId,
      partitionKey: partition.partitionKey,
      sequence: 2,
      createdAt: 200,
      projection: createProjection({ now: 1000, educationScore: 70 }),
    });
    rmSync(fileURLToPath(snapshot.uri));
    checkpointStore.saveCheckpoint(
      createProjectionCheckpoint({
        simulationId: partition.simulationId,
        partitionKey: partition.partitionKey,
        lastAppliedSequence: 2,
        snapshot,
      }),
    );

    expect(() =>
      hydrateWorldProjectionFromEventStream({
        initialProjection: createProjection(),
        eventStore,
        streamName: partition.eventStreamName,
        checkpoint: {
          checkpointStore,
          snapshotStore,
          lookup: {
            simulationId: partition.simulationId,
            partitionKey: partition.partitionKey,
          },
        },
      }),
    ).toThrow('checkpoint snapshot is missing');
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
