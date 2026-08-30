import {
  FileProjectionSnapshotStore,
  InMemoryEventStore,
  InMemoryProjectionCheckpointStore,
  asAgentId,
  createProjectionCheckpoint,
  createCommandEnvelope,
  createEventEnvelope,
  createSimulationPartition,
} from '@aivilization/sim-core';
import { createShortTermMemoryRecord } from '@aivilization/memory';
import {
  createWorldProjection,
  dispatchWorldCommand,
  type WorldEvent,
  type WorldProjection,
} from '@aivilization/world';
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

function createTravelStartedEvent(sequence: number): WorldEvent {
  return createEventEnvelope({
    id: `event-${sequence}`,
    simulationId: 'sim-1',
    commandId: 'command-travel',
    type: 'AgentTravelStarted',
    payload: {
      agentId: asAgentId('agent-1'),
      fromLocationId: 'home',
      toLocationId: 'school',
      routeLocationIds: ['home', 'school'],
      spatialPolicyVersion: 'test-spatial-v1',
      baseTravelDurationSeconds: 10,
      congestionMultiplier: 1,
      travelDurationSeconds: 10,
      departedAt: 1_000,
      arrivesAt: 11_000,
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

  test('rebuilds from the authoritative stream when a legacy checkpoint contains an off-stream fact', () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const travel = createTravelStartedEvent(2);
    eventStore.appendToStream({
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      events: [createTimeEvent(1), travel],
    });
    const checkpointStore = new InMemoryProjectionCheckpointStore();
    const snapshotStore = new FileProjectionSnapshotStore<WorldProjection>({
      rootDir: createRootDir(),
    });
    const snapshotProjection = createProjection({ now: 1_000 });
    const corruptedProjection: WorldProjection = {
      ...snapshotProjection,
      agents: {
        ...snapshotProjection.agents,
        'agent-1': { ...snapshotProjection.agents['agent-1']!, locationId: 'home' },
      },
      transitByAgent: {
        'agent-1': { ...travel.payload },
      },
    };
    const snapshot = snapshotStore.saveSnapshot({
      simulationId: partition.simulationId,
      partitionKey: partition.partitionKey,
      sequence: 1,
      createdAt: 100,
      projection: corruptedProjection,
    });
    checkpointStore.saveCheckpoint(
      createProjectionCheckpoint({
        simulationId: partition.simulationId,
        partitionKey: partition.partitionKey,
        lastAppliedSequence: 1,
        snapshot,
      }),
    );
    const initialProjection = createProjection();
    const initialAgent = initialProjection.agents['agent-1'];
    if (initialAgent === undefined) {
      throw new Error('expected test Agent');
    }

    const result = hydrateWorldProjectionFromEventStream({
      initialProjection: {
        ...initialProjection,
        agents: { ...initialProjection.agents, 'agent-1': { ...initialAgent, locationId: 'home' } },
      },
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

    expect(result.replayFromSequence).toBe(0);
    expect(result.checkpoint).toBeUndefined();
    expect(result.events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(result.projection.transitByAgent['agent-1']).toEqual(travel.payload);
  });

  test('bounds legacy snapshot memory history before replay', () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    eventStore.appendToStream({
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      events: [createTimeEvent(1)],
    });
    const checkpointStore = new InMemoryProjectionCheckpointStore();
    const snapshotStore = new FileProjectionSnapshotStore<WorldProjection>({
      rootDir: createRootDir(),
    });
    const legacyProjection: WorldProjection = {
      ...createProjection({ now: 1_000 }),
      memoryRecords: Array.from({ length: 300 }, (_, index) =>
        createShortTermMemoryRecord({
          id: `legacy-memory-${index}`,
          agentId: asAgentId('agent-1'),
          kind: 'action',
          status: 'succeeded',
          summary: `legacy memory ${index}`,
          occurredAt: index,
          importanceScore: 0.5,
          source: { eventIds: [] },
        }),
      ),
    };
    const snapshot = snapshotStore.saveSnapshot({
      simulationId: partition.simulationId,
      partitionKey: partition.partitionKey,
      sequence: 1,
      createdAt: 100,
      projection: legacyProjection,
    });
    checkpointStore.saveCheckpoint(
      createProjectionCheckpoint({
        simulationId: partition.simulationId,
        partitionKey: partition.partitionKey,
        lastAppliedSequence: 1,
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

    expect(result.events).toEqual([]);
    expect(result.projection.memoryRecords).toHaveLength(256);
    expect(result.projection.memoryRecords[0]?.id).toBe('legacy-memory-44');
    expect(result.projection.memoryRecords.at(-1)?.id).toBe('legacy-memory-299');
  });

  test('normalizes a legacy snapshot without education-exam arrays and settles an exam cycle', () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    eventStore.appendToStream({
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      events: [createTimeEvent(1)],
    });
    const checkpointStore = new InMemoryProjectionCheckpointStore();
    const snapshotStore = new FileProjectionSnapshotStore<WorldProjection>({
      rootDir: createRootDir(),
    });
    // Legacy snapshots predate education-system-v2 and lack the exam arrays;
    // the JSON round-trip mirrors the store's deserialization boundary.
    const legacySnapshotPayload = JSON.parse(
      JSON.stringify(createProjection({ now: 1_000 })),
    ) as WorldProjection;
    Reflect.deleteProperty(legacySnapshotPayload, 'educationExamApplications');
    Reflect.deleteProperty(legacySnapshotPayload, 'educationExamCycles');
    const snapshot = snapshotStore.saveSnapshot({
      simulationId: partition.simulationId,
      partitionKey: partition.partitionKey,
      sequence: 1,
      createdAt: 100,
      projection: legacySnapshotPayload,
    });
    checkpointStore.saveCheckpoint(
      createProjectionCheckpoint({
        simulationId: partition.simulationId,
        partitionKey: partition.partitionKey,
        lastAppliedSequence: 1,
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

    expect(result.projection.educationExamApplications).toEqual([]);
    expect(result.projection.educationExamCycles).toEqual([]);

    // With the education-system policy enabled, a 放榜 cycle boundary settles
    // on the hydrated legacy projection without crashing on the exam arrays.
    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-advance-exam-cycle',
        simulationId: 'sim-1',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 1_000 },
        issuedAt: 1_000,
      }),
      projection: result.projection,
      policies: {
        satietyRecoveryByCommodity: {},
        maxSatiety: 100,
        wageCalculator: () => 0,
        laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
        criticalThresholds: { energy: 0, health: 0 },
        educationSystem: {
          policyVersion: 'education-system-v2',
          enabled: true,
          levelScoreThresholds: [20, 70, 180, 320, 450],
          compulsoryLevels: [1, 2],
          levelTuitionPerHour: { 0: 20, 1: 20, 2: 20, 3: 25, 4: 30, 5: 40 },
          employedStudyEfficiencyRatio: 0.3,
          examCycleDurationMs: 1_000,
          admissionQuotaByLevel: { 3: 0.5, 4: 0.25, 5: 0.1 },
          vocationalTrackShare: 0.5,
          source: 'test-education-system',
        },
      },
      nextSequence: 10,
    });
    expect(events.map((event) => event.type)).toContain('EducationExamCycleCompleted');
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
