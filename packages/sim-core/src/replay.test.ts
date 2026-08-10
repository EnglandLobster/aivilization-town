import { describe, expect, test } from 'vitest';
import {
  createCommandEnvelope,
  createEventEnvelope,
  createSimulationPartition,
  createSnapshotReference,
  replayEvents,
} from './index';

describe('replayEvents', () => {
  test('replays ordered event envelopes into a deterministic projection', () => {
    const command = createCommandEnvelope({
      id: 'cmd-1',
      simulationId: 'sim-1',
      actorId: 'agent-1',
      type: 'AdvanceSimulationTime',
      payload: { deltaMs: 1000 },
      issuedAt: 0,
    });
    const partition = createSimulationPartition({
      simulationId: command.simulationId,
      partitionKey: 'world-main',
    });

    const event = createEventEnvelope({
      id: 'evt-1',
      simulationId: command.simulationId,
      commandId: command.id,
      type: 'SimulationTimeAdvanced',
      payload: { now: 1000 },
      occurredAt: 1000,
      sequence: 1,
    });
    const snapshot = createSnapshotReference({
      simulationId: command.simulationId,
      partitionKey: partition.partitionKey,
      sequence: 1,
      uri: 'file://snapshots/sim-1/world-main/1.json',
      createdAt: 1000,
    });

    const first = replayEvents(
      { now: 0, appliedEventIds: [] as string[] },
      [event],
      (projection, current) => ({
        now: current.payload.now,
        appliedEventIds: [...projection.appliedEventIds, current.id],
      }),
    );
    const second = replayEvents(
      { now: 0, appliedEventIds: [] as string[] },
      [event],
      (projection, current) => ({
        now: current.payload.now,
        appliedEventIds: [...projection.appliedEventIds, current.id],
      }),
    );

    expect(command.idempotencyKey).toBe('cmd-1');
    expect(partition.eventStreamName).toBe('simulation/sim-1/partition/world-main/events');
    expect(snapshot.sequence).toBe(1);
    expect(second).toEqual(first);
    expect(first).toEqual({ now: 1000, appliedEventIds: ['evt-1'] });
  });
});
